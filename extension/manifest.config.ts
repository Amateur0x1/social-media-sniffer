import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "社媒数据助手 (被动采集)",
  short_name: "SM Sniffer",
  version: "0.3.1",
  description: "被动拦截社交媒体 API 响应，零风险采集内容数据。支持小红书、B站、抖音。",
  icons: {
    "16": "public/icon16.png",
    "48": "public/icon48.png",
    "128": "public/icon128.png",
  },
  action: {
    default_title: "打开社媒数据助手",
    default_icon: {
      "16": "public/icon16.png",
      "48": "public/icon48.png",
      "128": "public/icon128.png",
    },
  },
  side_panel: {
    default_path: "index.html",
  },
  permissions: ["sidePanel", "storage", "activeTab", "tabs"],
  background: {
    service_worker: "src/service_worker.ts",
  },
  content_scripts: [
    // 小红书
    {
      js: ["src/content/xhs-sniffer.ts"],
      matches: ["https://www.xiaohongshu.com/*"],
      run_at: "document_start",
    },
    // B站
    {
      js: ["src/content/bili-sniffer.ts"],
      matches: [
        "https://www.bilibili.com/*",
        "https://space.bilibili.com/*",
        "https://search.bilibili.com/*",
      ],
      run_at: "document_start",
    },
    // 抖音
    {
      js: ["src/content/dy-sniffer.ts"],
      matches: ["https://www.douyin.com/*"],
      run_at: "document_start",
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/content/xhs-injected.js"],
      matches: ["https://www.xiaohongshu.com/*"],
    },
    {
      resources: ["src/content/bili-injected.js"],
      matches: [
        "https://www.bilibili.com/*",
        "https://space.bilibili.com/*",
        "https://search.bilibili.com/*",
      ],
    },
    {
      resources: ["src/content/dy-injected.js"],
      matches: ["https://www.douyin.com/*"],
    },
  ],
});
