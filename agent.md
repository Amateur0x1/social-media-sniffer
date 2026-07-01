# Social Media Sniffer - Agent 指南

## 这是什么

社交媒体内容运营工作流工具集，两条核心链路：

- **链路 1：信息采集**——抓数据、建画像、出选题（"做什么内容"）
- **链路 2：质量校准**——打分、预测、复盘、进化（"让内容越来越好"）

链路 1 帮你决定做什么，链路 2 帮你每一次都做得比上一次好。

## 项目结构

```
social-media-sniffer/
├── agent.md                          ← 你正在读的文件
├── extension/                        # 浏览器扩展（抓取平台数据）
├── rubrics/                          # 评分规则
│   └── xhs-image-text-zero.md       # 小红书图文 v0（7 维度）
└── skills/
    ├── content-extractor/            # 数据提取（视频截帧、转写、图片下载）
    ├── creator-profile/              # 账号画像（自定义面 + 数据面）
    ├── social-media-topic-creator/   # 选题引擎
    ├── benchmark-import/             # 对标导入 → 7 维锚点
    ├── draft-score/                  # 发前体检（7 维打分）
    ├── blind-predict/                # 盲预测（immutable）
    ├── post-retro/                   # 发后复盘（数据归因）
    ├── rubric-evolve/                # 公式升级
    ├── trend-scout/                  # 热点探测 + 选题补货
    └── xhs-algorithm/                # 小红书推荐算法知识库
```

## 多 Workspace 配置

每个账号 = 一个独立 workspace，数据完全隔离。

```
~/.social-media-sniffer/config.json
```

```json
{
  "workspaces": {
    "我的个人号": "/Users/xxx/Documents/我的个人号",
    "产品营销号": "/Users/xxx/Documents/产品营销号"
  },
  "active": "我的个人号",
  "version": "2.0"
}
```

切换账号 = 修改 active。用户说"切到 X 号"即可。

单个 workspace 目录结构：

```
<workspace>/
├── profiles/<账号名>.md         # 自定义面画像
├── audience/audience.md         # 数据面画像（评论聚类派生）
├── analysis/benchmarks/         # 对标分析
├── topics/candidates.md         # 选题池
├── predictions/                 # 盲预测 + 复盘日志
├── rubric-observations/         # 复盘观察记录
└── data/                        # 原始 JSON
```

## 7 维度打分体系

贯穿链路 2 所有 Skill 的核心框架。详见 `rubrics/xhs-image-text-zero.md`。

| 维度 | 全称 | 一句话 |
|---|---|---|
| ER | Emotional Resonance | 能不能让人产生具体的情感共鸣 |
| HP | Hook Potential | 封面+标题能不能让拇指停下来 |
| QL | Quotable Lines | 有没有能被截图传播的金句 |
| NA | Narrativity | 多张卡片有没有翻到最后的动力 |
| AB | Audience Breadth | 潜在受众有多广 |
| SR | Social Resonance | 有没有触及当下的集体情绪 |
| SAT | Satire Depth | 有没有自嘲/反讽/装置感 |

每维度 0-5 整数分，composite 综合分 0-10。

## 进度探测协议

**每次会话开始时自动检测用户阶段，直接告知"你在这里，建议下一步做这个"。不要介绍整个系统。**

检测逻辑：

```
config.json 不存在         → 阶段 0：引导初始化（问账号名+目录）
profiles/ 为空             → 阶段 1：引导建画像
benchmarks/ 为空           → 阶段 2：建议导对标（可跳过）
predictions/ 为空          → 阶段 3：建议开始写内容 → draft-score
有预测但复盘数 < 预测数    → 阶段 4：提醒复盘待处理的内容
复盘数 1-4                 → 阶段 5：继续跑闭环（还差 N 条升级）
复盘数 ≥ 5 且 rubric 仍 v0 → 阶段 6：可以升级 rubric 了
rubric 有 v1+              → 阶段 7：成熟期，问今天想做什么
```

每个阶段一句话提示即可，不需要大段解释。有多个 workspace 时先告知当前 active 是哪个。

### Workspace 操作

- **初始化**：问账号名 + 目录 → 创建目录结构 → 写 config.json → 进阶段 1
- **新增**：问新账号名 + 目录 → 创建 → 追加到 config → 问是否切换
- **切换**：修改 config.active → 重新探测进度

## Skill 一览

### 链路 1：做什么内容

| Skill | 职责 | 触发词 |
|-------|------|--------|
| content-extractor | 视频截帧+转写，图文批量下载。纯提取不分析 | 提取内容、下载视频、截帧 |
| creator-profile | 账号画像（自定义面：你的设定；数据面：评论聚类的真相）| 建画像、我是谁、我的观众是谁、分析评论 |
| topic-creator | 对话式选题。自动读画像+rubric+历史，帮你收敛一个选题 | 帮我想选题、下一篇发什么、没灵感 |

### 链路 2：让内容越来越好

| Skill | 职责 | 触发词 |
|-------|------|--------|
| benchmark-import | 对标账号样本 → 7维锚点（冷启动做一次）| 拆对标、导入对标 |
| draft-score | 7维体检，告诉你哪里强哪里弱（无副作用，可反复打）| 打分、体检一下 |
| blind-predict | 正式盲预测，bucket + 概率分布（写完不可改）| 启动预测、predict |
| post-retro | T+3d 数据 vs 预测对比，逐维度归因 | 复盘、数据来了 |
| rubric-evolve | 积累 ≥5 条闭环后升级公式（调权重/加减维度）| 升级 rubric、evolve |

### 辅助

| Skill | 职责 | 触发词 |
|-------|------|--------|
| trend-scout | 热点×你的方向交叉过滤，粗打分推荐 | 抓热点、今天做什么 |
| xhs-algorithm | 小红书算法知识库（CES、流量池、长尾）。纯参考不产出文件 | 算法怎么运作、为什么没流量 |

## 协作流程

```
插件抓数据 → content-extractor → creator-profile → topic-creator
                                 (自定义面+数据面)       ↑
                                                 trend-scout
                                                        │
                                                   用户写稿
                                                        ↓
benchmark-import → draft-score → blind-predict → 发布 → post-retro → rubric-evolve
 (冷启动锚点)     (体检改稿)    (锁定判断)            (归因)       (升级公式)
                                                        │
                                                 评论回流到 creator-profile 数据面
```

**冷启动（前5篇）**：建画像 → 导对标 → 出选题 → 写稿 → 体检 → 预测 → 发布 → 复盘 → 重复5次

**校准期（5篇后）**：升级 rubric + 刷新数据面 → 日常闭环继续跑 → 每5-10篇再升级

## 核心原则

- **不复盘的预测等于占星**——发了就要复盘，复盘了才能升级
- **前 5 条是数据采集**——精度 ±50% 是数学事实，不是系统的问题
- **rubric 是你的，不是通用的**——每个账号的受众对 7 维度的买账程度不同
- **一次问一个问题**——不要一口气抛 3 个问题让用户喘不过气
- **先判断阶段再行动**——不要默认用户是新手，也不要默认用户什么都知道
