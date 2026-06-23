/**
 * 前台被动嗅探 content script — 桥接层。
 *
 * 1. 注入 main world 脚本
 * 2. 监听 postMessage（含 pageUrl），转发给 service worker
 */

/// <reference types="chrome" />

import type { SniffMessage } from "../types/xhs-api";

// ── 注入 main world 脚本 ──

function injectMainWorldScript(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/content/xhs-injected.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

injectMainWorldScript();

// ── 监听 main world 的 postMessage，转发给 service worker ──

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "XHS_SNIFFER_DATA") return;

  const { source, payload, url, pageUrl } = event.data;

  const msg: SniffMessage = {
    type: "SNIFFER_DATA",
    source,
    payload,
    url,
    pageUrl: pageUrl || window.location.href,
    timestamp: Date.now(),
  };

  try {
    chrome.runtime.sendMessage(msg);
  } catch {
    // extension context 被销毁时静默忽略
  }
});

console.log("[SM Sniffer] content script 桥接层已就绪 ✓");
