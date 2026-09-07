/**
 * 注入到 B站 main world 的脚本。
 *
 * 拦截 B站 API 响应后通过 window.postMessage 发给 content script 桥接层。
 *
 * 重要：B站 API 响应中单个视频对象也有不少冗余字段，
 * 在 forward 之前做裁剪，只保留核心字段。
 */

(function () {
  "use strict";

  // B站 API 路径列表（注意带 wbi/ 前缀的是签名版接口）
  var API_PATTERNS = [
    { key: "bili_rcmd", path: "/x/web-interface/wbi/index/top/feed/rcmd" },
    { key: "bili_popular", path: "/x/web-interface/popular" },
    { key: "bili_video_detail", path: "/x/web-interface/wbi/view/detail" },
    { key: "bili_video_detail", path: "/x/web-interface/view/detail" },
    { key: "bili_reply", path: "/x/v2/reply/wbi/main" },
    { key: "bili_reply", path: "/x/v2/reply/main" },
    { key: "bili_user_video", path: "/x/space/wbi/arc/search" },
    { key: "bili_user_video", path: "/x/space/arc/search" },
  ];

  // ── 数据裁剪 ──

  function trimBiliVideo(raw) {
    if (!raw || !raw.bvid) return null;
    var owner = raw.owner || {};
    var stat = raw.stat || {};
    return {
      bvid: raw.bvid,
      aid: raw.aid,
      title: raw.title || "",
      pic: raw.pic || "",
      desc: raw.desc || "",
      duration: raw.duration || 0,
      pubdate: raw.pubdate || 0,
      tname: raw.tname || "",
      videos: raw.videos || 1,
      owner: {
        mid: owner.mid,
        name: owner.name || "",
        face: owner.face || "",
      },
      stat: {
        view: stat.view || 0,
        danmaku: stat.danmaku || 0,
        reply: stat.reply || 0,
        favorite: stat.favorite || 0,
        coin: stat.coin || 0,
        share: stat.share || 0,
        like: stat.like || 0,
      },
    };
  }

  function trimBiliReply(raw) {
    if (!raw || !raw.rpid) return null;
    var content = raw.content || {};
    var member = raw.member || {};
    var replyControl = raw.reply_control || {};
    return {
      rpid: raw.rpid,
      oid: raw.oid,
      mid: raw.mid,
      ctime: raw.ctime || 0,
      like: raw.like || 0,
      rcount: raw.rcount || 0,
      content: { message: content.message || "" },
      member: {
        mid: member.mid || "",
        uname: member.uname || "",
        avatar: member.avatar || "",
      },
      reply_control: {
        location: replyControl.location || "",
      },
    };
  }

  function trimBiliUserVideoItem(raw) {
    if (!raw || !raw.bvid) return null;
    return {
      bvid: raw.bvid,
      aid: raw.aid,
      title: raw.title || "",
      pic: raw.pic || "",
      description: raw.description || "",
      play: raw.play || 0,
      comment: raw.comment || 0,
      favorites: raw.favorites || 0,
      created: raw.created || 0,
      length: raw.length || "",
      author: raw.author || "",
      mid: raw.mid,
    };
  }

  function trimPayload(source, raw) {
    if (!raw || raw.code !== 0) return raw;

    switch (source) {
      case "bili_rcmd": {
        var items = raw.data && raw.data.item;
        if (!Array.isArray(items)) return raw;
        return {
          code: 0,
          data: {
            item: items.map(trimBiliVideo).filter(Boolean),
          },
        };
      }
      case "bili_popular": {
        var list = raw.data && raw.data.list;
        if (!Array.isArray(list)) return raw;
        return {
          code: 0,
          data: {
            list: list.map(trimBiliVideo).filter(Boolean),
            no_more: raw.data.no_more,
          },
        };
      }
      case "bili_video_detail": {
        var dataObj = raw.data;
        if (!dataObj) return raw;
        // wbi/view/detail 聚合接口：视频信息在 data.View 中
        var view = dataObj.View || dataObj;
        return {
          code: 0,
          data: {
            View: trimBiliVideo(view),
          },
        };
      }
      case "bili_reply": {
        var replyData = raw.data;
        if (!replyData) return raw;
        var replies = replyData.replies;
        return {
          code: 0,
          data: {
            replies: Array.isArray(replies) ? replies.map(trimBiliReply).filter(Boolean) : null,
            cursor: replyData.cursor,
            upper: replyData.upper,
          },
        };
      }
      case "bili_user_video": {
        var spaceData = raw.data;
        if (!spaceData || !spaceData.list) return raw;
        var vlist = spaceData.list.vlist;
        return {
          code: 0,
          data: {
            list: {
              vlist: Array.isArray(vlist) ? vlist.map(trimBiliUserVideoItem).filter(Boolean) : [],
            },
            page: spaceData.page,
          },
        };
      }
      default:
        return raw;
    }
  }

  // ── 上下文 URL 追踪 ──

  var contextUrl = window.location.href;

  function isUserSpaceUrl(url) {
    return /\/space\/\d+/.test(url);
  }

  function isVideoDetailUrl(url) {
    return /\/video\/BV[\w]+/i.test(url);
  }

  function updateContext() {
    var currentUrl = window.location.href;

    if (isUserSpaceUrl(currentUrl)) {
      contextUrl = currentUrl;
    } else if (isVideoDetailUrl(currentUrl) && isUserSpaceUrl(contextUrl)) {
      // 从用户空间点进视频详情，保持用户空间上下文
    } else {
      contextUrl = currentUrl;
    }
  }

  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;

  history.pushState = function () {
    var result = originalPushState.apply(this, arguments);
    updateContext();
    return result;
  };

  history.replaceState = function () {
    var result = originalReplaceState.apply(this, arguments);
    updateContext();
    return result;
  };

  window.addEventListener("popstate", function () {
    updateContext();
  });

  // ── API 拦截 ──

  function matchApi(url) {
    for (var i = 0; i < API_PATTERNS.length; i++) {
      if (url.includes(API_PATTERNS[i].path)) return API_PATTERNS[i].key;
    }
    return null;
  }

  function forward(source, payload, apiUrl) {
    var trimmed = trimPayload(source, payload);
    window.postMessage(
      {
        type: "BILI_SNIFFER_DATA",
        source: source,
        payload: trimmed,
        url: apiUrl,
        pageUrl: contextUrl,
      },
      "*"
    );
  }

  function safeParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // ── Monkey-patch fetch ──

  var originalFetch = window.fetch;

  window.fetch = async function () {
    var args = arguments;
    var response = await originalFetch.apply(this, args);

    var url =
      typeof args[0] === "string"
        ? args[0]
        : args[0] instanceof Request
          ? args[0].url
          : "";

    var source = matchApi(url);
    if (source && response.ok) {
      response
        .clone()
        .text()
        .then(function (text) {
          var json = safeParse(text);
          if (json && json.code === 0) {
            console.log("[SM Sniffer] B站 fetch 拦截:", source, url.split("?")[0]);
            forward(source, json, url);
          }
        })
        .catch(function () {});
    }

    return response;
  };

  // ── Monkey-patch XMLHttpRequest ──

  var originalXhrOpen = XMLHttpRequest.prototype.open;
  var originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._sniffUrl = String(url);
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      var url = this._sniffUrl;
      if (!url) return;
      var source = matchApi(url);
      if (source && this.status >= 200 && this.status < 300) {
        var json = safeParse(this.responseText);
        if (json && json.code === 0) {
          console.log("[SM Sniffer] B站 XHR 拦截:", source, url.split("?")[0]);
          forward(source, json, url);
        }
      }
    });
    return originalXhrSend.apply(this, arguments);
  };

  // 初始化上下文
  updateContext();

  console.log("[SM Sniffer] B站 main world 被动嗅探已注入 ✓");
})();
