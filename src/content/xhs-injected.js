/**
 * 注入到页面 main world 的脚本。
 *
 * 拦截到数据后通过 window.postMessage 发给 content script 桥接层，
 * 同时附带上下文页面 URL，让 service worker 能判断来源场景。
 *
 * 关键设计：contextUrl 追踪
 * 小红书是 SPA，用户在博主主页点击笔记后 URL 会通过 pushState 变为
 * /explore/{note_id}，但用户的逻辑上下文仍然是"在看这个博主"。
 * 所以我们记住进入 user/profile 时的 URL 作为 contextUrl，
 * 直到用户真正离开（导航到非笔记详情的页面）。
 */

(function () {
  "use strict";

  var API_PATTERNS = {
    feed: "/api/sns/web/v1/feed",
    comment: "/api/sns/web/v2/comment/page",
    user_posted: "/api/sns/web/v1/user_posted",
  };

  // ── 上下文 URL 追踪 ──

  var contextUrl = window.location.href;

  function isUserProfileUrl(url) {
    return /\/user\/profile\/[a-f0-9]+/.test(url);
  }

  function isNoteDetailUrl(url) {
    return /\/explore\/[a-f0-9]+/.test(url);
  }

  function updateContext() {
    var currentUrl = window.location.href;

    if (isUserProfileUrl(currentUrl)) {
      // 进入博主主页，记住上下文
      contextUrl = currentUrl;
    } else if (isNoteDetailUrl(currentUrl) && isUserProfileUrl(contextUrl)) {
      // 从博主主页点进笔记详情，保持博主上下文不变
      // contextUrl 不更新
    } else {
      // 其他情况（发现页、搜索页等），更新为当前 URL
      contextUrl = currentUrl;
    }
  }

  // 监听 SPA 路由变化
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
    for (var key in API_PATTERNS) {
      if (url.includes(API_PATTERNS[key])) return key;
    }
    return null;
  }

  function forward(source, payload, apiUrl) {
    window.postMessage(
      {
        type: "XHS_SNIFFER_DATA",
        source: source,
        payload: payload,
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
            console.log("[SM Sniffer] fetch 拦截:", source, url, "context:", contextUrl);
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
          console.log("[SM Sniffer] XHR 拦截:", source, url, "context:", contextUrl);
          forward(source, json, url);
        }
      }
    });
    return originalXhrSend.apply(this, arguments);
  };

  // 初始化上下文
  updateContext();

  console.log("[SM Sniffer] main world 被动嗅探已注入 ✓ (context tracking enabled)");
})();
