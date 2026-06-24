# Social Media Sniffer

[English](#english) | [中文](#中文)

---

## English

A passive data collection toolkit for social media platforms.

While you browse social media normally, the Chrome extension silently intercepts API responses from the page itself and parses them into structured data — **no signature forgery, no extra requests, no login simulation**. Pure passive listening.

### Project Structure

```
social-media-sniffer/
├── extension/          # Chrome extension (MV3 + React + TypeScript)
├── skill/              # CatDesk / Claude skill for data analysis (planned)
├── desktop/            # macOS desktop app (planned)
└── README.md
```

### Currently Supported

**Xiaohongshu / RedNote (xiaohongshu.com)**

- Explore feed notes
- Blogger profile pages (auto-grouped by blogger, with per-user selection & export)
- Note detail pages (images + video)
- Comments

### Safety Principles

The core design constraint is "read-only":

- No reverse-engineering of any signature algorithms (X-s, X-t, etc.)
- No API requests constructed or sent
- No cookies / tokens injected into requests
- 100% of data comes from responses to requests the browser itself made

It's essentially the same data you'd see in DevTools Network panel — just automatically parsed and organized.

### Architecture

```
Page main world (fetch/XHR monkey-patch)
    ↓ window.postMessage
Content script bridge (isolated world)
    ↓ chrome.runtime.sendMessage
Service worker (parse + merge into storage)
    ↓ chrome.storage.local
Side panel UI (React)
```

### Quick Start

```bash
git clone https://github.com/Amateur0x1/social-media-sniffer.git
cd social-media-sniffer/extension
npm install
npm run build
```

Then load the `extension/dist/` folder in `chrome://extensions` (Developer Mode → Load Unpacked).

### Tech Stack

- Chrome MV3 Extension
- React 19
- TypeScript
- Vite + [@crxjs/vite-plugin](https://github.com/nicedoc/crxjs)

### Roadmap

- [ ] Companion skill for data analysis (cheat-on-content integration)
- [ ] macOS desktop app for real-time data persistence
- [ ] Bilibili (bilibili.com) support
- [ ] More export formats (CSV, Excel)
- [ ] Data analytics dashboard

### License

MIT

---

## 中文

社交媒体数据被动采集工具集。

正常浏览社交媒体时，Chrome 扩展在后台拦截页面自身的 API 响应并解析存储——**不伪造签名、不发额外请求、不模拟登录**，纯被动监听。

### 项目结构

```
social-media-sniffer/
├── extension/          # Chrome 扩展 (MV3 + React + TypeScript)
├── skill/              # CatDesk / Claude 技能，用于数据分析 (计划中)
├── desktop/            # macOS 桌面应用 (计划中)
└── README.md
```

### 目前支持

**小红书 (xiaohongshu.com)**

- 发现页 feed 流笔记
- 博主主页笔记列表（自动按博主分组，支持按博主勾选和导出）
- 笔记详情页（图文 + 视频）
- 评论数据

### 安全原则

这个工具集的核心设计约束是"只读"：

- 不逆向任何签名算法（X-s, X-t 等）
- 不构造或发送任何 API 请求
- 不注入 cookie / token 到请求中
- 所有数据 100% 来自浏览器本身发出的请求的响应

本质上和你打开 DevTools Network 面板看到的数据一模一样，只是自动帮你解析和整理了。

### 架构

```
页面 main world (fetch/XHR monkey-patch)
    ↓ window.postMessage
content script 桥接层 (isolated world)
    ↓ chrome.runtime.sendMessage
service worker (数据解析 + 合并存储)
    ↓ chrome.storage.local
side panel UI (React)
```

### 快速开始

```bash
git clone https://github.com/Amateur0x1/social-media-sniffer.git
cd social-media-sniffer/extension
npm install
npm run build
```

然后在 `chrome://extensions` 中加载 `extension/dist/` 目录（开发者模式 → 加载已解压的扩展程序）。

### 技术栈

- Chrome MV3 Extension
- React 19
- TypeScript
- Vite + [@crxjs/vite-plugin](https://github.com/nicedoc/crxjs)

### Roadmap

- [ ] 配套 skill 做数据分析（对接 cheat-on-content）
- [ ] macOS 桌面应用实时落盘
- [ ] B 站 (bilibili.com) 支持
- [ ] 更多导出格式（CSV、Excel）
- [ ] 数据统计面板

### License

MIT
