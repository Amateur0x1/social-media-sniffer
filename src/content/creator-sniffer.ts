/**
 * 创作者中心被动嗅探 content script — 桥接层。
 */

/// <reference types="chrome" />

import type { SniffMessage } from "../types/xhs-api";

function injectMainWorldScript(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/content/creator-injected.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

injectMainWorldScript();

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
  } catch {}
});

console.log("[SM Sniffer] 创作者中心 content script 桥接层已就绪 ✓");
