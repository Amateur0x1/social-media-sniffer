# Social Media Sniffer

[English](#english) | [中文](#中文)

---

## English

A passive data collection Chrome extension for social media platforms.

While you browse social media normally, the extension silently intercepts API responses from the page itself and parses them into structured data — **no signature forgery, no extra requests, no login simulation**. Pure passive listening.

### Currently Supported

**Xiaohongshu / RedNote (xiaohongshu.com)**

- Explore feed notes
- Blogger profile pages (auto-grouped by blogger)
- Note detail pages (images + video)
- Comments
- Creator center (creator.xiaohongshu.com) personal note data

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

Why main world injection? Chrome extension content scripts run in an isolated world and cannot intercept the page's own fetch/XHR calls. So we inject an interception script into the main world via a `<script>` tag, then relay data back to the content script bridge through `postMessage`.

### Usage

#### Build from Source

```bash
git clone https://github.com/Amateur0x1/social-media-sniffer.git
cd social-media-sniffer
npm install
npm run build
```

#### Load into Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `dist/` directory
4. Browse Xiaohongshu normally, click the extension icon to open the side panel

#### Side Panel

The side panel has three tabs:

- **Explore** — Notes collected while browsing the explore/discover feed
- **Bloggers** — Data collected from blogger profile pages, grouped by blogger with drill-down
- **My Notes** — Your own note data collected from the creator center

Each note has a checkbox. Use the "Export Selected" button at the bottom to export chosen notes and comments as a JSON file.

### Tech Stack

- Chrome MV3 Extension
- React 19
- TypeScript
- Vite + [@crxjs/vite-plugin](https://github.com/nicedoc/crxjs)

### Roadmap

- [ ] Bilibili (bilibili.com) support
- [ ] Local daemon for real-time file persistence (WebSocket / Native Messaging)
- [ ] More export formats (CSV, Excel)
- [ ] Data analytics dashboard

### License

MIT

---

## 中文

社交媒体数据被动采集 Chrome 扩展。

正常浏览社交媒体时，扩展在后台拦截页面自身的 API 响应并解析存储——**不伪造签名、不发额外请求、不模拟登录**，纯被动监听。

### 目前支持

**小红书 (xiaohongshu.com)**

- 发现页 feed 流笔记
- 博主主页笔记列表（自动按博主分组）
- 笔记详情页（图文 + 视频）
- 评论数据
- 创作者中心（creator.xiaohongshu.com）自有笔记数据

### 安全原则

这个扩展的核心设计约束是"只读"：

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

为什么需要 main world 注入？Chrome 扩展的 content script 运行在 isolated world，无法拦截页面自身的 fetch/XHR。所以通过 `<script>` 标签将拦截脚本注入到 main world，再通过 `postMessage` 把数据传回 content script 桥接层。

### 使用

#### 从源码构建

```bash
git clone https://github.com/Amateur0x1/social-media-sniffer.git
cd social-media-sniffer
npm install
npm run build
```

#### 加载到 Chrome

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目的 `dist/` 目录
4. 正常浏览小红书，点击扩展图标打开侧边栏查看采集到的数据

#### 侧边栏功能

侧边栏分三个 tab：

- **发现** — 浏览发现页时自动采集到的笔记
- **博主** — 浏览博主主页时采集的数据，按博主分组，点击可展开查看该博主下的所有笔记
- **我的** — 在创作者中心采集到的自己的笔记数据

每条笔记可以勾选，底部「导出选中」按钮将选中的笔记和评论导出为 JSON 文件。

### 技术栈

- Chrome MV3 Extension
- React 19
- TypeScript
- Vite + [@crxjs/vite-plugin](https://github.com/nicedoc/crxjs)

### Roadmap

- [ ] B 站 (bilibili.com) 支持
- [ ] 本地 daemon 实时落盘（WebSocket / Native Messaging）
- [ ] 更多导出格式（CSV、Excel）
- [ ] 数据统计面板

### License

MIT
