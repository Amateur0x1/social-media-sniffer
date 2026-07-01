# Social Media Sniffer - Agent 指南

## 这是什么

这是一个社交媒体内容运营工作流工具集。它有两条核心链路：

- **链路 1：信息采集**——抓数据、建画像、出选题（"做什么内容"）
- **链路 2：质量校准**——打分、预测、复盘、进化（"怎么让内容越来越好"）

两条链路配合使用：链路 1 帮你决定做什么，链路 2 帮你每一次都做得比上一次好。

读到这个文件的你（AI），需要了解以下内容来正确引导用户。

## 项目结构

```
social-media-sniffer/
├── agent.md                          ← 你正在读的文件（入口）
├── extension/                        # 浏览器扩展（抓取小红书等平台数据）
├── rubrics/                          # 评分规则文件
│   └── xhs-image-text-zero.md       # 小红书图文 v0 rubric（7 维度打分）
└── skills/                           # AI Skill 集合
    │
    │── ── 链路 1：信息采集 ──
    ├── content-extractor/            # 数据提取（视频截帧、转写、图片下载）
    ├── creator-profile/              # 用户画像（我是谁）
    ├── social-media-topic-creator/   # 选题生产
    │
    │── ── 链路 2：质量校准 ──
    ├── benchmark-import/             # 对标账号 → 7 维锚点
    ├── draft-score/                  # 发前体检（7 维打分）
    ├── blind-predict/                # 正式盲预测（锁定判断）
    ├── post-retro/                   # 发后复盘（数据归因）
    ├── rubric-evolve/                # 公式升级（权重迭代）
    │
    │── ── 辅助 ──
    ├── trend-scout/                  # 热点探测 + 选题补货
    └── audience-lens/                # 真实受众画像（谁在看我）
```

## 配置系统

### 多 Workspace 架构

每个内容账号拥有独立的 workspace。不同账号的 rubric、预测、复盘数据完全隔离——因为不同方向的内容不能共用同一套打分公式。

### 配置文件位置

```
~/.social-media-sniffer/config.json
```

Windows: `%USERPROFILE%\.social-media-sniffer\config.json`

### 配置内容

```json
{
  "workspaces": {
    "白日梦想猪": "/Users/xxx/Documents/白日梦想猪",
    "煮理人": "/Users/xxx/Documents/煮理人"
  },
  "active": "白日梦想猪",
  "created_at": "2026-06-30T10:00:00Z",
  "version": "2.0"
}
```

- `workspaces`：所有已注册的 workspace，key 是账号名，value 是路径
- `active`：当前激活的 workspace。所有 Skill 默认操作 active workspace
- 切换账号 = 切换 active（用户说"切到煮理人"即可）

### 单个 Workspace 的目录结构

每个 workspace 是一个完全独立的数据空间：

```
<workspace>/
├── profiles/                    # 账号画像
│   └── <账号名>.md              # creator-profile 维护
├── analysis/                    # 对标分析
│   └── benchmarks/              # benchmark-import 产出
│       └── <对标账号名>.md
├── topics/                      # 选题 + 候选池
│   ├── candidates.md            # 选题池（trend-scout / topic-creator 写入）
│   └── <日期>-选题.md
├── predictions/                 # 盲预测 + 复盘日志
│   └── <日期>_<短标题>.md
├── rubric-observations/         # 复盘观察记录（rubric-evolve 的种子）
│   └── observations.md
├── audience/                    # 受众画像（audience-lens 维护）
│   └── audience.md
└── data/                        # 原始 JSON 数据
```

注意：workspace 内不再有账号名子目录——因为一个 workspace 就是一个账号。

## 两条链路详解

### 链路 1：信息采集（做什么内容）

```
浏览器插件抓数据 (JSON)
        ↓
content-extractor（提取素材）
        ↓
creator-profile（建立/更新"我是谁"）
        ↓
social-media-topic-creator（出选题规划）
```

这条链路负责回答"我该做什么内容"——从数据采集到画像建立到选题产出。

### 链路 2：质量校准（让内容越来越好）

```
用户写完稿子
    ↓
draft-score（7 维体检：哪里强哪里弱）
    ↓
blind-predict（正式预测：会有多少互动）
    ↓
发布
    ↓
post-retro（T+3d 复盘：预测对了还是错了，为什么）
    ↓
rubric-evolve（积累 5+ 条后升级打分公式）
    ↓
下一篇打分更准 → 循环
```

这条链路的核心思想是：**打分 → 盲预测 → 发布 → 复盘 → 进化公式**。每跑一圈，你对"什么样的内容在我的账号上表现好"的判断就更准一分。前 5 条是数据采集，之后 rubric 才开始真正有预测力。

### 辅助 Skill

**benchmark-import**：冷启动时做一次。把对标账号的高/中/低表现样本映射到 7 维度，给 rubric 一个初始锚点。

**trend-scout**：日常补货。帮你从热点中筛选"跟你方向有交叉"的话题，粗打分后推荐。

**audience-lens**：积累复盘数据后使用。从评论里派生"谁真的在看你"的画像，跟 creator-profile（你对自己的定义）做交叉验证。

## 7 维度打分体系

这是贯穿链路 2 所有 Skill 的核心评估框架。详见 `rubrics/xhs-image-text-zero.md`。

| 维度 | 全称 | 一句话 |
|---|---|---|
| ER | Emotional Resonance | 能不能让人产生具体的情感共鸣 |
| HP | Hook Potential | 封面+标题+第一张能不能让拇指停下来 |
| QL | Quotable Lines | 有没有能被单独截图传播的金句 |
| NA | Narrativity | 多张卡片之间有没有翻到最后的动力 |
| AB | Audience Breadth | 潜在受众有多广 |
| SR | Social Resonance | 有没有触及当下的集体情绪/社会结构 |
| SAT | Satire Depth | 语调有没有自嘲/反讽/装置感 |

每个维度 0-5 整数分，按公式算出 composite 综合分（0-10）。

## 每次打开项目时：进度探测协议

**AI 必须在每次会话开始时自动执行以下检测，判断用户处于哪个阶段，然后直接告知"你现在在这里，下一步建议做这个"。不要把整个系统介绍一遍再问用户想干嘛。**

### 检测步骤

```
1. 检查 ~/.social-media-sniffer/config.json 是否存在
   - 不存在 → 阶段 0（未初始化）
   - 存在 → 读 config，继续

2. 读 config.workspaces 和 config.active
   - workspaces 为空 → 阶段 0.5（已有 config 但无 workspace）
   - 有 active workspace → 进入该 workspace，继续检测
   - 有多个 workspace → 告知用户当前 active 是哪个，问要不要切换

3. 检查 <active_workspace>/profiles/ 下有没有 .md 文件
   - 没有 → 阶段 1（未建画像）
   - 有 → 继续

4. 检查 <active_workspace>/analysis/benchmarks/ 下有没有文件
   - 没有 → 阶段 2（未导对标）
   - 有 → 继续

5. 检查 <active_workspace>/predictions/ 下有多少预测文件
   - 0 个 → 阶段 3（未开始校准循环）
   - 有预测文件 → 检查有多少包含 ## 复盘 段的文件
     - 复盘数 < 预测数 → 阶段 4（有待复盘的内容）
     - 复盘数 ≥ 5 → 阶段 6（可升级 rubric）
     - 复盘数 1-4 → 阶段 5（校准中，继续跑闭环）

6. 检查项目 rubrics/ 下是否有 v1+ 版本的 rubric
   - 只有 v0 → 未升级
   - 有 v1+ → 阶段 7（已进入成熟期）
```

### 各阶段的用户体验

**阶段 0 — 未初始化**：
```
你还没初始化过这个项目。我来帮你设置——
你的第一个内容账号叫什么名字？数据想存在哪个目录下？（推荐 ~/Documents/<账号名>）
```

**阶段 0.5 — 已有 config 但要新建 workspace**：
```
你已有 N 个 workspace：[列出名字]
要新建一个吗？告诉我新账号的名字。
```

**阶段 1 — 未建画像**：
```
当前 workspace：「<账号名>」
画像还没建好。告诉我这个号的基本情况，我帮你建立画像。
```

**阶段 2 — 未导对标**：
```
当前 workspace：「<账号名>」，画像已建好。
建议下一步：导入 1-2 个对标账号，给 rubric 建立初始锚点。
你有没有看好的对标博主？（也可以跳过，直接开始写内容。）
```

**阶段 3 — 未开始校准循环**：
```
当前 workspace：「<账号名>」，已有画像 + 对标锚点。
你现在有写好的稿子吗？我可以帮你：
- 打分体检（draft-score）看看哪里强哪里弱
- 或者先出选题（topic-creator）
```

**阶段 4 — 有待复盘的内容**：
```
当前 workspace：「<账号名>」
你有 N 篇已预测但未复盘的内容。
建议先复盘——用插件重新抓一次数据导出 JSON 给我，我帮你跑 post-retro。
待复盘：[列出标题和发布日期]
```

**阶段 5 — 校准中（1-4 条复盘）**：
```
当前 workspace：「<账号名>」
你已完成 N/5 条闭环。再跑 M 条就能升级 rubric 了。
现在可以：继续写下一篇 → draft-score → predict → 发 → retro
```

**阶段 6 — 可升级 rubric**：
```
当前 workspace：「<账号名>」
你已有 N 条复盘数据，可以升级 rubric 了！
说"升级 rubric"我来分析你的偏差模式，提出新公式。
```

**阶段 7 — 成熟期**：
```
当前 workspace：「<账号名>」（rubric vN，M 条校准数据）
今天想做什么？写新内容 / 找热点 / 复盘 / 更新受众画像？
```

### 初始化详细步骤（阶段 0 时执行）

1. 问用户第一个账号名 + 数据存放目录（推荐 ~/Documents/<账号名>）
2. 创建目录结构：
   ```bash
   mkdir -p "<目录>"/{profiles,analysis/benchmarks,topics,predictions,rubric-observations,audience,data}
   mkdir -p ~/.social-media-sniffer
   ```
3. 写入 config.json（version 2.0 格式）
4. 自动进入阶段 1（建画像）

### 新增 workspace（用户说"我要加一个号"时执行）

1. 问新账号名 + 数据存放目录
2. 创建同样的目录结构
3. 在 config.json 的 workspaces 中追加新条目
4. 问用户要不要切换到新 workspace

### 切换 workspace

用户说"切到 X"/"给 X 做内容"时：
1. 检查 config.workspaces 中有没有 X
2. 有 → 修改 config.active = X，告知切换成功，重新走进度探测
3. 没有 → 问用户是不是要新建

## 各 Skill 说明

### 链路 1

#### content-extractor（数据提取）

**职责**：把线上内容素材拉到本地，结构化存储。纯提取，不做分析。

**能力**：视频下载→截帧→转写；图文→批量下载配图。

**触发词**：提取内容、下载视频、截帧、提取文案、下载图片、处理 JSON

**前置**：需要 ffmpeg + whisper

#### creator-profile（用户画像）

**职责**：通过对话了解用户是谁，维护"我是谁"的画像文档。支持多账号。

**核心逻辑**：问用户的产品、目标人群、内容平台、人设、能力边界。画像是后续所有 Skill 的基础。

**触发词**：建画像、我要开始做内容、更新信息、新建账号、我是谁

#### social-media-topic-creator（选题引擎）

**职责**：对话式选题搭档。自动读取画像、受众、rubric、历史表现，帮你把一个模糊想法收敛成一个可执行的选题。

**核心逻辑**：自动加载 context → 识别模式（用户带主题/给方向/没想法）→ 对话深挖 → rubric 粗打分验证 → 落盘到 candidates.md。默认一次一个选题，对话式收敛。

**触发词**：帮我想选题、我想做一条关于X的、下一篇发什么、没灵感、内容规划

**与旧版的区别**：不再从零问产品/竞品/目标人群（这些都在画像和 benchmark 里了），直接从"你今天想做什么"开始。

### 链路 2

#### benchmark-import（对标导入）

**职责**：把对标账号的样本映射到 7 维度打分，形成锚点。冷启动信号源。

**核心逻辑**：收集对标样本 → 用户标注高/中/低 → AI 拆 pattern + 7 维打分 → 写入 benchmark 文件。

**触发词**：学这个账号、拆对标、导入对标、对标分析、benchmark

**时机**：冷启动时做一次；之后可追加新对标。

#### draft-score（发前体检）

**职责**：给稿子做 7 维度打分，告诉你哪里强哪里弱。不写文件、不做预测。

**核心逻辑**：读稿子 → 读 rubric → 逐维度打分 + 理由 → 算 composite → 输出诊断建议。

**触发词**：打分这篇、给这篇打个分、score、体检一下

**特点**：可反复打、无副作用。是 blind-predict 的前置探索。

#### blind-predict（盲预测）

**职责**：给最终稿写一份不可修改的正式预测（bucket + 概率分布）。

**核心逻辑**：blind check → 7 维打分 → 锚点对比 → bucket 概率分布 → 反事实场景 → 落盘。

**触发词**：启动预测、正式预测、predict、我要发了先预测

**核心约束**：预测段一旦写完不可修改。看到数据后不能补预测。

#### post-retro（发后复盘）

**职责**：T+3 天后用真实数据对比预测，结构化归因。

**核心逻辑**：读预测 + 读真实数据 → 对比 bucket → 逐维度归因 → 提炼观察 → 追加复盘段。

**触发词**：复盘、retro、数据来了、分析表现

**核心约束**：只追加复盘段，绝不修改预测段。

#### rubric-evolve（公式升级）

**职责**：积累 5+ 条复盘后，升级 rubric 公式——调权重、加减维度。

**核心逻辑**：分析偏差模式 → 提出新公式 → 回测验证 → 用户确认 → 落盘新版本 rubric。

**触发词**：升级 rubric、调整权重、更新公式、evolve

**前置**：≥ 5 条完整闭环。

### 辅助

#### trend-scout（热点探测）

**职责**：从热点源筛选"跟你方向有交叉"的话题，粗打分后推荐。

**核心逻辑**：抓热点 → 与用户方向交叉过滤 → 粗打分 → 推荐 top 3-5。

**触发词**：抓热点、今天有什么可做的、trending、找灵感

#### audience-lens（受众画像）

**职责**：从复盘评论数据派生"谁真的在看你"，跟 creator-profile 做交叉验证。

**核心逻辑**：评论聚类（身份/情绪/反驳/语言）→ 写入受众画像 → 标出与 profile 的 gap。

**触发词**：更新受众画像、我的观众是谁、audience、分析评论

**前置**：≥ 3 篇有评论的复盘数据。

## 完整协作关系

```
┌─────────────────────────────────────────────────────────────────┐
│                        链路 1：做什么内容                          │
│                                                                   │
│  插件抓数据 → content-extractor → creator-profile → topic-creator │
│                                                         ↑         │
│                                              trend-scout 补选题    │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │ 用户写稿
                                       ↓
┌─────────────────────────────────────────────────────────────────┐
│                     链路 2：让内容越来越好                         │
│                                                                   │
│  draft-score → blind-predict → 发布 → post-retro → rubric-evolve │
│       ↑                                    │              │       │
│  benchmark-import                    audience-lens    更新 rubric  │
│  （冷启动锚点）                    （真实受众）    （权重进化）   │
└─────────────────────────────────────────────────────────────────┘
```

## 典型使用流程

### 冷启动期（前 5 篇）

1. 初始化 → 建画像（creator-profile）
2. 导入对标（benchmark-import）→ 获得初始锚点
3. 出选题（topic-creator）→ 写稿
4. 体检（draft-score）→ 知道哪里弱 → 改稿
5. 预测（blind-predict）→ 锁定判断
6. 发布
7. T+3d 复盘（post-retro）→ 记录观察
8. 重复 3-7 五次 → 积累校准数据

### 进入校准期（5 篇之后）

1. 升级 rubric（rubric-evolve）→ 公式贴合你的受众
2. 更新受众画像（audience-lens）→ 知道谁在看你
3. 日常：trend-scout 找灵感 → topic-creator 规划 → 写稿 → draft-score → predict → 发 → retro
4. 每 5-10 篇再跑一次 rubric-evolve

### 日常快速流程

- 「帮我想选题」→ topic-creator
- 「打分这篇」→ draft-score
- 「启动预测」→ blind-predict
- 「复盘」→ post-retro
- 「抓热点」→ trend-scout

## 引导用户的原则

- 不要一上来就问一堆问题，先判断用户是什么阶段
- 如果是第一次用，走初始化流程
- 如果画像已存在，直接问「今天想做什么」
- 如果有多个账号，先确认「给哪个号做」
- 用户说的话模糊时，追问具体，但一次只问 1-2 个问题
- 长流程拆步骤，每步做完告诉用户进展
- **校准循环的纪律**：不要跳步骤。发了就要复盘，复盘了才能升级。

## 多 Workspace 核心规则

- 每个账号 = 一个独立 workspace，数据完全隔离
- rubric 独立进化——煮理人的权重可能是 HP>AB>ER，白日梦想猪可能是 ER>QL>SR
- 切换账号 = 切换 active workspace，所有 Skill 自动指向新 workspace
- 不同 workspace 之间不共享 predictions / rubric-observations / audience 数据
- benchmarks 可以手动复制到其他 workspace（比如同一个对标账号对两个号都有参考价值）
- 用户说"切到 X"/"给 X 做内容"/"X 号"时，AI 切换 config.active 并重新探测进度

## 校准循环的核心理念

**内容表现不是玄学，是可以被拆解为维度、逐条校准的。**

一条内容能不能火，取决于 7 个维度的组合。而每个账号的受众对这 7 个维度的"买账程度"是不同的。你需要通过实验（发布 → 复盘）找到**你自己的权重**。

前 5 条是数据采集——精度约 ±50%，这是数学事实。但每跑完一次闭环，你的判断就更准一分。到 20 条时，rubric 真正成为预测工具。

**不复盘的预测等于占星。不升级的 rubric 等于自欺。**
