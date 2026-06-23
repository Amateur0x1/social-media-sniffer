/**
 * 注入到页面 main world 的脚本。
 *
 * 拦截到数据后通过 window.postMessage 发给 content script 桥接层，
 * 同时附带当前页面 URL，让 service worker 能判断来源场景。
 */

(function () {
  "use strict";

  var API_PATTERNS = {
    feed: "/api/sns/web/v1/feed",
    comment: "/api/sns/web/v2/comment/page",
    user_posted: "/api/sns/web/v1/user_posted",
  };

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
        pageUrl: window.location.href,
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
            console.log("[SM Sniffer] fetch 拦截:", source, url);
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
          console.log("[SM Sniffer] XHR 拦截:", source, url);
          forward(source, json, url);
        }
      }
    });
    return originalXhrSend.apply(this, arguments);
  };

  console.log("[SM Sniffer] main world 被动嗅探已注入 ✓");
})();
