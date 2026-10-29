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
│   └── src/
│       ├── content/    # Content-script bridges + main-world interceptors
│       ├── store/      # Sharded storage layer
│       ├── types/      # Shared message protocol
│       ├── service_worker.ts
│       └── App.tsx     # Side panel UI
├── rubrics/            # Scoring rubrics (7 dimensions)
├── skills/             # CatDesk / Claude skills for the content workflow
└── output/             # Local extracted media (gitignored)
```

### Currently Supported

**Xiaohongshu / RedNote (xiaohongshu.com)**

- Explore feed notes
- Blogger profile pages (auto-grouped by blogger, with per-user selection & export)
- Note detail pages (images + video)
- Comments

**Bilibili (bilibili.com)**

- Home recommendation feed, popular ranking, video detail
- Creator space pages (`space.bilibili.com/{mid}`, `www.bilibili.com/space/{mid}`)
- Comments, plus play URLs (DASH video/audio) for downloads

**Douyin (douyin.com)**

- Recommend feed, video / note detail
- Creator profiles and their post lists (API + SSR `RENDER_DATA`)
- Comments and profile stats (followers, likes, signature)

### Safety Principles

The core design constraint is "read-only":

- No reverse-engineering of any signature algorithms (X-s, X-t, wbi, etc.)
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
    ↓ chrome.storage.local (sharded)
Side panel UI (React)
```

Storage is sharded per note so a single intercepted response never rewrites the
whole dataset:

```
sms:<platform>:meta               { stats, userProfiles }
sms:<platform>:cards              NoteCard[]
sms:<platform>:note:<note_id>     NoteEntry
sms:<platform>:comment:<note_id>  CommentEntry[]
```

The service worker keeps an in-process cache and writes only the shards that
actually changed. Data created by v0.3.x (single key per platform) is migrated
automatically on first read.

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

- [ ] Second-level comments (Bilibili nested replies, XHS sub-comments)
- [ ] More export formats (CSV, Excel)
- [ ] Data analytics dashboard
- [ ] macOS desktop app for real-time persistence

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
│   └── src/
│       ├── content/    # content script 桥接层 + main world 拦截脚本
│       ├── store/      # 分片存储层
│       ├── types/      # 跨平台消息协议
│       ├── service_worker.ts
│       └── App.tsx     # 侧边栏 UI
├── rubrics/            # 评分规则（7 维度）
├── skills/             # 内容运营工作流 Skill
└── output/             # 本地提取的素材（已 gitignore）
```

### 目前支持

**小红书 (xiaohongshu.com)**

- 发现页 feed 流笔记
- 博主主页笔记列表（自动按博主分组，支持按博主勾选和导出）
- 笔记详情页（图文 + 视频）
- 评论数据

**B站 (bilibili.com)**

- 首页推荐流、热门排行榜、视频详情
- 博主空间页（`space.bilibili.com/{mid}` 与 `www.bilibili.com/space/{mid}` 两种形态）
- 评论数据，以及用于下载的 DASH 音视频直链

**抖音 (douyin.com)**

- 推荐流、视频/图文详情
- 博主主页与其作品列表（API + 首屏 SSR `RENDER_DATA`）
- 评论数据与主页画像字段（粉丝数、获赞数、签名等）

### 安全原则

这个工具集的核心设计约束是"只读"：

- 不逆向任何签名算法（X-s、X-t、wbi 等）
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
    ↓ chrome.storage.local（分片）
side panel UI (React)
```

存储按笔记分片，单条响应不会触发整库重写：

```
sms:<platform>:meta               { stats, userProfiles }
sms:<platform>:cards              NoteCard[]
sms:<platform>:note:<note_id>     NoteEntry
sms:<platform>:comment:<note_id>  CommentEntry[]
```

service worker 持有进程内缓存，只回写真正变化的分片。v0.3.x 的单 key 数据会在首次读取时自动迁移。

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

- [ ] 二级评论采集（B站楼中楼、小红书子评论）
- [ ] 更多导出格式（CSV、Excel）
- [ ] 数据统计面板
- [ ] macOS 桌面应用实时落盘

### License

MIT
