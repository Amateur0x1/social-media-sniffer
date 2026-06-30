# Social Media Sniffer - Agent 指南

## 这是什么

这是一个社交媒体内容运营工作流工具集，包含浏览器扩展（抓取数据）和一组 AI Skill（处理数据、建立画像、生产选题）。

读到这个文件的你（AI），需要了解以下内容来正确引导用户。

## 项目结构

```
social-media-sniffer/
├── agent.md                 ← 你正在读的文件（入口）
├── extension/               # 浏览器扩展（抓取小红书等平台数据）
└── skills/                  # AI Skill 集合
    ├── content-extractor/   # 数据提取（视频截帧、转写、图片下载）
    ├── creator-profile/     # 用户画像建立与维护
    └── social-media-topic-creator/  # 选题生产
```

## 配置系统

### 配置文件位置

```
~/.social-media-sniffer/config.json
```

Windows: `%USERPROFILE%\.social-media-sniffer\config.json`

### 配置内容

```json
{
  "workspace": "/path/to/social-media-output",
  "created_at": "2026-06-30T10:00:00Z",
  "version": "1.0"
}
```

`workspace` 是用户所有产出数据的根目录。所有 Skill 都从这里读取路径。

### 工作目录结构（workspace）

```
<workspace>/
├── profiles/          # 账号画像（每个账号一个 .md 文件）
│   ├── _index.md      # 账号索引
│   └── <账号名>.md
├── analysis/          # 提取的素材（视频帧、转写文案、图片）
│   ├── 竞品-<名称>/<日期>/
│   └── <自己账号>/<日期>/
├── topics/            # 选题产出（按账号分目录）
│   └── <账号名>/<日期>-选题.md
└── data/              # 原始 JSON 数据
```

## 初始化流程

**每次打开这个项目时，先检查 `~/.social-media-sniffer/config.json` 是否存在。**

### 如果不存在（首次使用）

引导用户完成初始化：

1. 介绍这个工具集能做什么
2. 问用户：「你想把内容数据存在哪个目录下？我会在里面创建一个 `social-media-output` 文件夹。」
   - 推荐：macOS 用 `~/Documents`，Windows 用 `文档` 文件夹
   - 用户不确定就用默认
3. 创建目录结构：
   ```bash
   # macOS/Linux
   mkdir -p "<用户指定的目录>/social-media-output"/{profiles,analysis,topics,data}
   mkdir -p ~/.social-media-sniffer
   ```
   ```powershell
   # Windows
   New-Item -ItemType Directory -Force -Path "<目录>\social-media-output\profiles"
   New-Item -ItemType Directory -Force -Path "<目录>\social-media-output\analysis"
   New-Item -ItemType Directory -Force -Path "<目录>\social-media-output\topics"
   New-Item -ItemType Directory -Force -Path "<目录>\social-media-output\data"
   New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.social-media-sniffer"
   ```
4. 写入 config.json
5. 运行 `python skills/content-extractor/scripts/preflight.py` 检查依赖
6. 引导用户进入下一步（建立画像）

### 如果已存在（老用户）

1. 读取 config.json 获取 workspace 路径
2. 检查 `<workspace>/profiles/` 下有没有画像文件
3. 根据用户意图引导到对应 Skill

## Skill 说明

### content-extractor（数据提取）

**职责**：把线上内容素材拉到本地，结构化存储。纯提取，不做分析。

**能力**：
- 视频：下载 → 每秒截帧 → 提取音频 → whisper 语音转文字
- 图文：批量下载配图

**触发词**：提取内容、下载视频、截帧、提取文案、下载图片、处理 JSON

**前置**：需要 ffmpeg + whisper，首次运行 `python scripts/preflight.py --install` 预检安装

### creator-profile（用户画像）

**职责**：通过对话了解用户是谁，维护持久化的画像文档。支持多账号，每个账号独立画像。

**核心逻辑**：
- 问用户的产品、目标人群、内容平台、人设、能力边界
- 如果用户有已发布内容，引导用 sniffer 插件抓取数据交给 content-extractor 提取，再总结写入画像
- 画像文件是后续选题的基础，其他 Skill 会读取

**触发词**：建画像、我要开始做内容、更新信息、新建账号、我是谁

**重要**：一个人可能运营多个不同账号，每个账号的需求完全不同，必须分开管理。

### social-media-topic-creator（选题生产）

**职责**：基于用户画像和竞品素材，通过多轮对话产出选题。

**核心逻辑**：
- 先确认为哪个账号做选题
- 读取该账号画像
- 如果有竞品分析素材，结合素材产出
- 不断向用户提问确认，充分了解后再输出
- 输出选题包含：标题、角度、目标人群、内容骨架、标签建议

**触发词**：帮我想选题、内容规划、我要发什么、下周发什么

**重要**：不同账号的选题策略完全不同，始终围绕当前账号画像做决策。

## Skill 协作关系

```
用户提供竞品数据 (JSON)
        ↓
content-extractor（提取素材：截帧、转写、下载图片）
        ↓
creator-profile（建立/更新用户画像）
        ↓
social-media-topic-creator（基于画像 + 素材产出选题）
```

典型使用流程：

1. **首次**：初始化 → 建立画像 → 用插件抓竞品数据 → 提取素材 → 产出选题
2. **日常**：直接说「帮我想选题」→ 读取画像 → 产出
3. **新竞品**：提供新 JSON → 提取 → 更新认知 → 产出新选题
4. **新账号**：建立新画像 → 走完整流程

## 引导用户的原则

- 不要一上来就问一堆问题，先判断用户是什么阶段
- 如果是第一次用，走初始化流程
- 如果画像已存在，直接问「今天想做什么」
- 如果有多个账号，先确认「给哪个号做」
- 用户说的话模糊时，追问具体，但一次只问 1-2 个问题
- 长流程拆步骤，每步做完告诉用户进展

## 多账号核心规则

- 每个账号独立画像、独立选题目录、独立分析目录
- 不同账号的风格、人设、受众可能完全不同，绝对不能混淆
- 每次操作前必须明确「当前在为哪个账号工作」
- 分析竞品时也要关联到目标账号（「这个竞品分析是给哪个号参考的」）
