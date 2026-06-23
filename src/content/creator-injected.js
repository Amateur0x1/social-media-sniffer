/**
 * 注入到创作者中心 main world 的脚本。
 *
 * 拦截 creator.xiaohongshu.com 的 galaxy API 响应，
 * 通过 postMessage 发给 content script 桥接层。
 */

(function () {
  "use strict";

  var GALAXY_PATTERNS = [
    "/creator/note/user/posted",
    "/creator/data/note_stats",
    "/creator/data/note_detail",
  ];

  function isGalaxyApi(url) {
    return GALAXY_PATTERNS.some(function (p) {
      return url.includes(p);
    });
  }

  function forward(payload, apiUrl) {
    window.postMessage(
      {
        type: "XHS_SNIFFER_DATA",
        source: "galaxy",
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

    if (isGalaxyApi(url) && response.ok) {
      response
        .clone()
        .text()
        .then(function (text) {
          var json = safeParse(text);
          if (json) {
            console.log("[SM Sniffer] Galaxy API 拦截:", url);
            forward(json, url);
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
      if (isGalaxyApi(url) && this.status >= 200 && this.status < 300) {
        var json = safeParse(this.responseText);
        if (json) {
          console.log("[SM Sniffer] Galaxy XHR 拦截:", url);
          forward(json, url);
        }
      }
    });
    return originalXhrSend.apply(this, arguments);
  };

  console.log("[SM Sniffer] 创作者中心 main world 嗅探已注入 ✓");
})();
