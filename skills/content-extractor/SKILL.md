---
name: content-extractor
description: 社交媒体内容数据提取工具。从 JSON 数据文件中读取笔记/帖子信息，对视频类内容自动下载、每秒截帧、提取音频并用 whisper 转为文字，对图文类内容批量下载配图。只负责数据提取和结构化存储，不做内容分析和策略判断。当用户提到"提取内容""下载视频""截帧""提取文案""下载图片""处理这个JSON""把数据拉下来"，或者提供了 sniffer 抓取的 JSON 数据文件需要提取素材时使用。
---

# 社交媒体内容数据提取工具

## 定位

这个 Skill 是一个**纯数据提取工具**，只干一件事：把线上的内容素材（视频、图片、文案）拉到本地，结构化存好。

它**不负责**：
- 内容策略分析
- 风格总结
- 竞品洞察
- 选题建议

这些分析工作由其他 Skill 或用户在后续流程中完成。本 Skill 只确保素材齐全、结构清晰、随时可用。

## 前置依赖

- `Python 3.8+`：所有脚本均为 Python，跨平台运行
- `ffmpeg`：视频处理（截帧、提取音频）
- `whisper`：语音转文字（openai-whisper CLI）

### 环境预检

首次使用时运行预检脚本，自动检测依赖是否就绪：

```bash
python scripts/preflight.py
```

如果有缺失，加 `--install` 尝试自动安装：

```bash
python scripts/preflight.py --install
```

预检脚本会：
1. 检测当前平台（macOS / Linux / Windows）
2. 检查 ffmpeg 和 whisper 是否可用
3. 如果缺失且使用了 `--install`，尝试自动安装：
   - macOS: `brew install ffmpeg` + `pip install openai-whisper`
   - Windows: `winget install ffmpeg` 或 `choco install ffmpeg` + `pip install openai-whisper`
   - Linux: `apt-get install ffmpeg` + `pip install openai-whisper`
4. 安装失败则给出手动安装指引

## 工作目录

从 `~/.social-media-sniffer/config.json`（Windows: `%USERPROFILE%\.social-media-sniffer\config.json`）读取 `workspace` 字段获取工作目录路径。如果配置不存在，提示用户先运行 init Skill。

以下所有 `<workspace>` 均指该路径。

## 输出路径

```
<workspace>/analysis/<对象名>/<日期>/
├── status.json              # 任务进度
├── videos/
│   └── <note_id>/
│       ├── video.mp4        # 原始视频
│       ├── frames/          # 每秒截帧
│       │   ├── frame_001.jpg
│       │   ├── frame_002.jpg
│       │   └── ...
│       ├── audio.wav        # 提取的音频
│       └── transcript.txt   # whisper 转写文字
└── images/
    └── <note_id>/
        ├── img_01.webp
        ├── img_02.webp
        └── ...
```

对象名规则：
- 竞品内容：`竞品-<名称>`（如 `竞品-cato`）
- 自己账号：`<账号名>`（如 `煮理人`）

## 工作流程

### Step 1：读取 JSON 数据

用户提供一个 JSON 文件（来自 social-media-sniffer 浏览器扩展）。文件结构：

```json
{
  "notes": [
    {
      "title": "...",
      "desc": "...",
      "type": "normal" | "video",
      "note_id": "...",
      "images": ["url1", "url2", ...],
      "video": {
        "video_url": "...",
        "video_urls": [...],
        "duration": 83,
        "width": 720,
        "height": 900
      },
      "like_count": 100,
      "collect_count": 50,
      "share_count": 20,
      "comment_count": 10,
      "tags": [...]
    }
  ]
}
```

读取后告诉用户：总共多少篇笔记、多少视频、多少图文。

### Step 2：确认提取范围

问用户：
- 全部提取？
- 只要视频？只要图文？
- 只要 TOP N（按点赞排序）？
- 只要某几篇特定的？

### Step 3：创建任务目录和 status.json

确认后：
1. 创建输出目录
2. 初始化 `status.json`
3. 开始逐个处理

### Step 4：视频提取

对每个视频笔记：

1. 下载视频（优先用 video_url，失败则尝试 video_urls 中的备用地址）
2. 每秒截取一帧（`ffmpeg -vf fps=1`）
3. 提取音频（`ffmpeg -vn -acodec pcm_s16le -ar 16000 -ac 1`）
4. whisper 转写音频为文字
5. 更新 status.json

使用脚本：
```bash
python scripts/extract_video.py <video_url> <output_dir> --note-id <note_id>
```

### Step 5：图文提取

对每个图文笔记：

1. 创建 `images/<note_id>/` 目录
2. 逐张下载配图
3. 更新 status.json

使用脚本：
```bash
python scripts/download_images.py <output_dir> <url1> <url2> ...
```

### Step 6：完成

全部处理完后：
- 更新 status.json 为 `completed`
- 告诉用户：处理了多少视频、多少图文、总共多少文件、占用多少空间
- 如果有失败的，列出失败项和原因

## 任务状态与断点续传

### status.json 格式

```json
{
  "task_id": "竞品-cato/2026-06-29",
  "source_file": "/path/to/xhs-user-2026-06-29.json",
  "status": "in_progress",
  "started_at": "2026-06-29T10:00:00Z",
  "updated_at": "2026-06-29T10:15:00Z",
  "total_notes": 45,
  "progress": {
    "videos": {
      "total": 3,
      "completed": ["68e8c1cb000000000703393c"],
      "failed": [],
      "pending": ["67dc1521000000001d0396ae", "66e59ef5000000001e01baf4"]
    },
    "images": {
      "total": 42,
      "completed": 32,
      "failed": 0,
      "pending": 10
    }
  },
  "error_log": []
}
```

### 断点恢复逻辑

启动时检查目标目录是否有 `status.json`：
- `status: "in_progress"` → 问用户要不要继续
- `status: "completed"` → 告诉用户已经提取过了，问是否重新提取
- 不存在 → 新任务

处理规则：
- 每处理完一个笔记立即更新 status.json
- 单个失败不阻塞整体，记录到 error_log 继续下一个
- URL 过期导致下载失败时，提示用户需要重新用插件抓取数据

## 注意事项

- 视频下载和 whisper 转写耗时较长，处理前告知用户预计时间
- whisper 默认用 `base` 模型（速度快），用户需要更准确可切 `medium` 或 `large`
- 视频 URL 有时效签名，过期后无法下载，需用户重新抓取
- 所有脚本均为 Python，macOS/Linux/Windows 通用，无需额外适配
- 首次使用务必先运行 `python scripts/preflight.py` 预检环境
