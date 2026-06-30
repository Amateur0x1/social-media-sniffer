---
name: social-media-content-analyzer
description: 社交媒体内容深度分析工具。从 JSON 数据文件中读取笔记/帖子信息，对视频类内容自动下载并截取关键帧、提取音频转文字（语音文案），对图文类内容下载图片进行视觉分析。最终输出内容策略洞察报告。当用户提到"分析这个账号的内容""帮我看看这些视频""提取视频文案""分析竞品视频""截取视频关键帧""分析帖子图片风格""看看这些笔记的视觉策略"，或者提供了 sniffer 抓取的 JSON 数据文件想要深度分析时使用。
---

# 社交媒体内容深度分析工具

## 能力概述

这个 Skill 让你能对社交媒体内容（视频 + 图文）做深度分析，不只是看文字数据，还能：

- 从视频中截取关键帧，分析视觉风格和内容编排
- 从视频中提取音频，用 whisper 转成文字，得到完整文案
- 下载图文笔记的配图，分析视觉策略（配色、排版、信息密度等）

## 前置依赖

- `ffmpeg`：视频处理（截帧、提取音频）
- `whisper`：语音转文字（openai-whisper CLI）
- 图片分析能力：通过读取本地图片文件实现

运行前先确认环境：
```bash
which ffmpeg && which whisper
```

## 工作目录

从 `~/.social-media-sniffer/config.json`（Windows: `%USERPROFILE%\.social-media-sniffer\config.json`）读取 `workspace` 字段获取工作目录路径。如果配置不存在，提示用户先运行 init Skill。

以下所有 `<workspace>` 均指该路径。

## 多账号支持

用户可能同时运营多个账号，也可能要分析多个不同竞品的内容。分析时需要明确两件事：

1. **分析的是谁的内容**：是竞品的？还是用户自己某个号的？
2. **分析结果服务于哪个账号**：如果是竞品分析，最终是给用户的哪个号提供参考？

如果用户有多个账号画像（`<workspace>/profiles/`），分析开始前确认当前工作账号，这样分析报告里的建议才能对症下药。

## 默认输出路径

分析产出按「被分析对象」组织目录：

```
<workspace>/
├── analysis/
│   ├── 竞品-cato/                    # 竞品分析
│   │   └── 2026-06-29/
│   │       ├── videos/
│   │       ├── images/
│   │       └── report.md
│   ├── 竞品-xxx/                     # 另一个竞品
│   │   └── ...
│   ├── 煮理人/                        # 用户自己账号的内容分析
│   │   └── 2026-07-01/
│   │       └── ...
│   └── 个人技术号/                    # 用户另一个号
│       └── ...
```

路径规则：
- 竞品分析：`<workspace>/analysis/竞品-<名称>/<日期>/`
- 自己账号：`<workspace>/analysis/<账号名>/<日期>/`

脚本中的 `<output_dir>` 参数，默认传：
```
<workspace>/analysis/<对象名>/<日期>/videos/<note_id>
```

如果用户指定了别的路径，以用户为准。

## 任务状态与断点续传

分析任务可能耗时较长（视频下载、截帧、whisper 转写），过程中可能被中断（对话断开、用户离开、进入新上下文等）。通过 `status.json` 记录进度，支持下次进来时从断点继续。

### status.json 位置

每个分析任务目录下都有一个：

```
<workspace>/analysis/<对象名>/<日期>/status.json
```

### status.json 格式

```json
{
  "task_id": "竞品-cato/2026-06-29",
  "source_file": "/Users/xxx/Downloads/xhs-user-2026-06-29.json",
  "target_account": "煮理人",
  "status": "in_progress",
  "started_at": "2026-06-29T10:00:00Z",
  "updated_at": "2026-06-29T10:15:00Z",
  "total_notes": 45,
  "progress": {
    "videos": {
      "total": 3,
      "completed": ["68e8c1cb000000000703393c", "67dc1521000000001d0396ae"],
      "failed": [],
      "pending": ["66e59ef5000000001e01baf4"]
    },
    "images": {
      "total": 42,
      "completed": 32,
      "failed": 0,
      "pending": 10
    },
    "report": "not_started"
  },
  "error_log": []
}
```

字段说明：
- `status`：`in_progress` | `completed` | `failed` | `paused`
- `target_account`：分析结果服务于哪个账号（可为空，表示通用分析）
- `progress.videos.completed`：已完成的 note_id 列表
- `progress.videos.failed`：失败的 note_id 列表（URL 过期等）
- `progress.images.completed`：已下载的图文笔记数量
- `progress.report`：`not_started` | `in_progress` | `completed`
- `error_log`：记录失败原因，方便排查

### 工作流程中的状态管理

**启动分析时**：
1. 检查目标目录下是否已有 `status.json`
2. 如果有且 `status` 为 `in_progress` → 问用户「上次分析还没完成，要继续吗？」
   - 用户说继续 → 从 `pending` 列表继续处理
   - 用户说重新来 → 清空目录，重新开始
3. 如果没有 → 创建新的 `status.json`，开始任务

**处理每个笔记后**：
- 更新 `status.json` 中对应的 completed/failed 列表
- 更新 `updated_at` 时间戳
- 这样即使中途断开，下次进来也知道做到哪了

**单个笔记处理失败时**：
- 将该 note_id 移入 `failed` 列表
- 在 `error_log` 中记录失败原因（如 URL 过期、网络超时）
- 继续处理下一个，不要因为一个失败而中断整个任务

**全部完成时**：
- 将 `status` 改为 `completed`
- 如果有 failed 的笔记，提示用户哪些没成功、可能的原因

### 进入新上下文时的恢复流程

当用户在新对话中触发 content-analyzer Skill 时：

1. 扫描 `<workspace>/analysis/` 下所有目录的 `status.json`
2. 如果发现有 `status: "in_progress"` 的任务：
   ```
   我发现你之前有一个未完成的分析任务：
   - 对象：竞品-cato
   - 进度：视频 2/3 完成，图片 32/42 完成
   - 上次更新：2026-06-29 10:15
   
   要继续这个任务，还是开始新的分析？
   ```
3. 用户选择继续 → 从断点恢复
4. 用户选择放弃 → 将 status 标记为 `paused`，开始新任务

### 注意事项

- status.json 更新要及时，每处理完一个笔记就写一次，不要攒到最后批量写
- 如果 source_file（原始 JSON）的路径已经不存在了（比如用户删了），从 status.json 中无法恢复原始数据，需要提示用户重新提供
- 视频 URL 有时效性，如果中断时间太长（超过几小时），pending 中的视频 URL 可能已过期，需要用户重新抓取数据

## 工作流程

### Step 1：读取 JSON 数据

用户会提供一个 JSON 文件（通常来自 social-media-sniffer 浏览器扩展抓取）。文件结构：

```json
{
  "notes": [
    {
      "title": "...",
      "desc": "...",
      "type": "normal" | "video",
      "images": ["url1", "url2", ...],
      "video": {              // 仅 type=video 时存在
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

读取后，先给用户一个数据总览：有多少篇笔记、多少视频/图文、整体数据分布。

### Step 2：确认分析范围

问用户想分析什么：
- 全部内容概览分析？
- 只看视频类？只看图文类？
- 只看 TOP N 高流量的？
- 只看某个特定帖子？

### Step 3：视频分析流程

对于视频类内容，使用 `scripts/analyze_video.sh` 脚本：

```bash
bash scripts/analyze_video.sh <video_url> <output_dir> [note_id]
```

脚本会自动：
1. 下载视频到临时目录
2. 截取关键帧（封面帧 + 等距 5 帧）
3. 提取音频并用 whisper 转文字
4. 将结果输出到指定目录

目录结构：
```
output_dir/
├── video.mp4          # 下载的视频
├── frames/            # 截取的关键帧
│   ├── frame_001.jpg  # 第1秒（通常是封面/开头）
│   ├── frame_002.jpg  # 等距帧
│   └── ...
├── audio.wav          # 提取的音频
└── transcript.txt     # whisper 转写的文字
```

拿到结果后：
1. 用 read_file 或 image_read 查看关键帧图片，分析视觉风格
2. 读取 transcript.txt，分析文案结构和话术
3. 结合帖子的点赞/收藏/分享数据，给出洞察

### Step 4：图文分析流程

对于图文类内容，使用 `scripts/download_images.sh` 脚本：

```bash
bash scripts/download_images.sh <output_dir> <url1> <url2> ...
```

下载后用图片分析能力查看：
- 配色风格（暖色系？冷色系？对比强烈？）
- 信息密度（纯图？图文混排？文字多还是少？）
- 排版结构（标题在哪？正文布局？CTA 位置？）
- 是否有统一的视觉模板

### Step 5：输出分析报告

根据分析深度，输出报告应包含：

**视频内容洞察**：
- 开头 hook 策略（前 3 秒做了什么）
- 文案结构（是否有叙事弧线、痛点→方案→体验）
- 语速和节奏
- 视觉风格（真人出镜？动画？文字卡片？）
- 字幕/标注使用方式

**图文内容洞察**：
- 封面图策略（第一张图是什么风格）
- 图片数量与信息密度
- 配色和排版规律
- 产品截图展示方式

**数据交叉分析**：
- 视频 vs 图文的流量表现对比
- 哪种视觉风格对应更高的数据
- 高互动内容的共同视觉特征

## 注意事项

- 视频下载和 whisper 转写需要时间，尤其是长视频。处理前告知用户预计耗时。
- whisper 默认使用 `base` 模型，如果用户需要更精确的转写可以切换到 `medium` 或 `large`，但耗时会增加。
- 下载的视频和图片在分析完成后，询问用户是否保留。如果不需要，清理临时文件。
- 视频 URL 可能有时效性（签名过期），如果下载失败，告知用户需要重新获取数据。

## 使用示例

用户说："帮我分析一下这个 JSON 里视频内容的文案风格"

你应该：
1. 读取 JSON，筛选出 type=video 的笔记
2. 按点赞排序，选 TOP 3-5 个
3. 逐个执行视频分析流程
4. 读取 transcript.txt，分析文案结构
5. 查看关键帧，分析视觉配合
6. 输出综合洞察
