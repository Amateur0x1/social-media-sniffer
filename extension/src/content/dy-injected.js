/**
 * 注入到抖音 Web 版 main world 的脚本。
 *
 * 拦截抖音 API 响应后通过 window.postMessage 发给 content script 桥接层。
 *
 * 重要：抖音单个 aweme 对象有 500+ 字段、~150KB，
 * 直接传整个 payload 会导致 chrome.runtime.sendMessage 序列化过慢甚至静默失败。
 * 因此在 forward 之前先裁剪到只保留核心字段（~2KB/条）。
 */

(function () {
  "use strict";

  // API 路径匹配（从最具体到最通用）
  var API_PATTERNS = [
    { key: "dy_recommend", path: "/aweme/v2/web/module/feed" },
    { key: "dy_recommend", path: "/aweme/v1/web/tab/feed" },
    { key: "dy_video_detail", path: "/aweme/v1/web/aweme/detail" },
    { key: "dy_comment", path: "/aweme/v1/web/comment/list" },
    { key: "dy_user_post", path: "/aweme/v1/web/aweme/post" },
    { key: "dy_user_profile", path: "/aweme/v1/web/user/profile/other" },
  ];

  // ── 数据裁剪：只保留我们需要的字段 ──

  function trimAweme(raw) {
    if (!raw || !raw.aweme_id) return null;
    var author = raw.author || {};
    var stats = raw.statistics || {};
    var video = raw.video || {};
    var cover = video.cover || {};
    var playAddr = video.play_addr || {};
    var textExtra = raw.text_extra;
    var images = raw.images;

    var result = {
      aweme_id: raw.aweme_id,
      desc: raw.desc || "",
      create_time: raw.create_time || 0,
      aweme_type: raw.aweme_type || 0,
      ip_label: raw.ip_label || "",
      author: {
        uid: author.uid || "",
        sec_uid: author.sec_uid || "",
        nickname: author.nickname || "",
        unique_id: author.unique_id || "",
      },
      statistics: {
        digg_count: stats.digg_count || 0,
        comment_count: stats.comment_count || 0,
        collect_count: stats.collect_count || 0,
        share_count: stats.share_count || 0,
        play_count: stats.play_count || 0,
      },
      video: {
        duration: video.duration || 0,
        width: video.width || 0,
        height: video.height || 0,
        cover: { url_list: cover.url_list ? [cover.url_list[0]] : [] },
        play_addr: { url_list: playAddr.url_list ? [playAddr.url_list[0]] : [] },
      },
    };

    // 话题标签
    if (Array.isArray(textExtra) && textExtra.length > 0) {
      result.text_extra = textExtra
        .filter(function (t) { return t && t.hashtag_name; })
        .map(function (t) { return { hashtag_name: t.hashtag_name }; });
    }

    // 图文笔记图片
    if (raw.aweme_type === 68 && Array.isArray(images) && images.length > 0) {
      result.images = images.map(function (img) {
        var urls = img.url_list || img.urlList || [];
        return { url_list: urls.length > 0 ? [urls[0]] : [] };
      });
    }

    return result;
  }

  function trimComment(raw) {
    if (!raw || !raw.cid) return null;
    var user = raw.user || {};
    return {
      cid: raw.cid,
      text: raw.text || "",
      create_time: raw.create_time || 0,
      digg_count: raw.digg_count || 0,
      reply_comment_total: raw.reply_comment_total || 0,
      ip_label: raw.ip_label || "",
      aweme_id: raw.aweme_id || "",
      user: {
        uid: user.uid || "",
        sec_uid: user.sec_uid || "",
        nickname: user.nickname || "",
        unique_id: user.unique_id || "",
      },
    };
  }

  /** 对不同类型的响应做裁剪 */
  function trimPayload(source, raw) {
    if (!raw) return raw;

    switch (source) {
      case "dy_recommend":
      case "dy_user_post": {
        var awemeList = raw.aweme_list;
        if (!Array.isArray(awemeList)) return raw;
        return {
          aweme_list: awemeList.map(trimAweme).filter(Boolean),
          has_more: raw.has_more,
          cursor: raw.cursor || raw.max_cursor,
          status_code: raw.status_code,
        };
      }
      case "dy_video_detail": {
        var detail = raw.aweme_detail;
        if (!detail) return raw;
        return {
          aweme_detail: trimAweme(detail),
          status_code: raw.status_code,
        };
      }
      case "dy_comment": {
        var comments = raw.comments;
        if (!Array.isArray(comments)) return raw;
        return {
          comments: comments.map(trimComment).filter(Boolean),
          has_more: raw.has_more,
          cursor: raw.cursor,
          total: raw.total,
          status_code: raw.status_code,
        };
      }
      case "dy_user_profile": {
        var user = raw.user;
        if (!user) return raw;
        return {
          user: {
            uid: user.uid || "",
            sec_uid: user.sec_uid || "",
            nickname: user.nickname || "",
            unique_id: user.unique_id || "",
            aweme_count: user.aweme_count || 0,
            follower_count: user.follower_count || 0,
            following_count: user.following_count || 0,
            total_favorited: user.total_favorited || 0,
            signature: user.signature || "",
          },
          status_code: raw.status_code,
        };
      }
      default:
        return raw;
    }
  }

  // ── 上下文 URL 追踪 ──

  // 从主页点进视频时，只让「第一条」视频继承主页上下文，避免推荐流串作者
  var contextUrl = window.location.href;
  var pendingUserContext = isUserPageUrl(contextUrl) ? contextUrl : null;

  function isUserPageUrl(url) {
    return /\/user\/[\w-]+/.test(url);
  }

  function isVideoDetailUrl(url) {
    return /\/(video|note)\/\d+/.test(url);
  }

  function updateContext() {
    var currentUrl = window.location.href;

    if (isUserPageUrl(currentUrl)) {
      contextUrl = currentUrl;
      pendingUserContext = currentUrl;
      return;
    }

    if (isVideoDetailUrl(currentUrl)) {
      if (pendingUserContext) {
        contextUrl = pendingUserContext;
        pendingUserContext = null; // 一次性消费
      } else {
        contextUrl = currentUrl;
      }
      return;
    }

    contextUrl = currentUrl;
    pendingUserContext = null;
  }

  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;

  history.pushState = function () {
    var result = originalPushState.apply(this, arguments);
    updateContext();
    tryExtractOnRouteChange();
    return result;
  };

  history.replaceState = function () {
    var result = originalReplaceState.apply(this, arguments);
    updateContext();
    tryExtractOnRouteChange();
    return result;
  };

  window.addEventListener("popstate", function () {
    updateContext();
    tryExtractOnRouteChange();
  });

  // ── API 拦截 ──

  function matchApi(url) {
    for (var i = 0; i < API_PATTERNS.length; i++) {
      if (url.includes(API_PATTERNS[i].path)) return API_PATTERNS[i].key;
    }
    return null;
  }

  function forward(source, payload, apiUrl) {
    // 裁剪后再发送，避免消息体过大
    var trimmed = trimPayload(source, payload);
    window.postMessage(
      {
        type: "DY_SNIFFER_DATA",
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
          if (json) {
            console.log("[SM Sniffer] 抖音 fetch 拦截:", source, url.split("?")[0]);
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
        if (json) {
          console.log("[SM Sniffer] 抖音 XHR 拦截:", source, url.split("?")[0]);
          forward(source, json, url);
        }
      }
    });
    return originalXhrSend.apply(this, arguments);
  };

  // ── SSR 数据提取（博主页面首屏数据） ──

  function extractSSRData() {
    var el = document.getElementById("RENDER_DATA");
    if (!el || !el.textContent) return;

    try {
      var decoded = decodeURIComponent(el.textContent);
      var renderData = JSON.parse(decoded);

      for (var routeKey in renderData) {
        var routeData = renderData[routeKey];
        if (!routeData || typeof routeData !== "object") continue;

        var user = routeData.user || (routeData.userInfo && routeData.userInfo.user);

        // 尝试从 loaderData 中找
        var loaderData = routeData.loaderData;
        if (loaderData) {
          for (var ldKey in loaderData) {
            var ld = loaderData[ldKey];
            if (ld && ld.userInfo) {
              user = ld.userInfo.user;
            }
            if (ld && ld.post && ld.post.data && Array.isArray(ld.post.data)) {
              console.log("[SM Sniffer] 抖音 SSR 提取用户作品:", ld.post.data.length, "条");
              forward("dy_user_post", {
                aweme_list: ld.post.data,
                has_more: ld.post.hasMore ? 1 : 0,
                status_code: 0,
              }, window.location.href);
            }
          }
        }

        // 尝试直接从 routeData.post 获取
        if (routeData.post && routeData.post.data && Array.isArray(routeData.post.data)) {
          console.log("[SM Sniffer] 抖音 SSR 提取用户作品(直接):", routeData.post.data.length, "条");
          forward("dy_user_post", {
            aweme_list: routeData.post.data,
            has_more: routeData.post.hasMore ? 1 : 0,
            status_code: 0,
          }, window.location.href);
        }

        // 尝试从 awemeList 字段获取
        var awemeData = routeData.awemeList || routeData.aweme_list;
        if (awemeData && Array.isArray(awemeData)) {
          console.log("[SM Sniffer] 抖音 SSR 提取推荐列表:", awemeData.length, "条");
          forward("dy_recommend", {
            aweme_list: awemeData,
            status_code: 0,
          }, window.location.href);
        }
      }
    } catch (e) {
      console.log("[SM Sniffer] 抖音 SSR 提取失败:", e.message);
    }
  }

  // DOM 加载完后提取 SSR 数据
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(extractSSRData, 300);
    });
  } else {
    setTimeout(extractSSRData, 300);
  }

  // SPA 路由切换后也尝试提取
  var lastExtractedUrl = "";
  function tryExtractOnRouteChange() {
    var currentUrl = window.location.href;
    if (currentUrl !== lastExtractedUrl && isUserPageUrl(currentUrl)) {
      lastExtractedUrl = currentUrl;
      setTimeout(extractSSRData, 800);
    }
  }

  // 初始化
  updateContext();

  console.log("[SM Sniffer] 抖音 main world 被动嗅探已注入 ✓");
})();
