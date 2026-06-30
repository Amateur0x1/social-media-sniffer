---
name: init
description: 社交媒体内容工作流初始化工具。引导用户完成首次设置：选择工作目录、创建目录结构、生成配置文件。所有其他 Skill（creator-profile、content-analyzer、topic-creator）依赖此初始化后的配置。当用户首次使用、说"初始化""init""开始设置""我要开始用"，或者其他 Skill 检测到配置文件不存在时触发。
---

# 社交媒体内容工作流 - 初始化

## 这个 Skill 做什么

引导用户完成首次环境设置：

1. 让用户选择一个工作目录（存放所有产出数据的地方）
2. 在该目录下创建标准目录结构
3. 将配置写入 `~/.social-media-sniffer/config.json`
4. 介绍整个工作流和可用的 Skill

## 配置文件

```
~/.social-media-sniffer/config.json
```

跨平台路径：
- macOS/Linux: `~/.social-media-sniffer/config.json`
- Windows: `%USERPROFILE%\.social-media-sniffer\config.json`

配置文件格式：

```json
{
  "workspace": "/Users/xxx/Documents/social-media-output",
  "created_at": "2026-06-30T10:00:00Z",
  "version": "1.0"
}
```

`workspace` 就是用户指定的目录 + `/social-media-output`。所有其他 Skill 读这个字段来确定产出位置。

## 工作目录结构

init 会在用户指定的目录下创建：

```
<用户指定的目录>/social-media-output/
├── profiles/          # 账号画像（每个账号一个 .md）
├── analysis/          # 内容分析产出（截帧、转写、报告）
├── topics/            # 选题产出（按账号分目录）
└── data/              # 原始数据（JSON 等）
```

## 初始化流程

### Step 1：检查是否已初始化

读取配置文件 `~/.social-media-sniffer/config.json`：
- 如果存在且 workspace 路径有效 → 告诉用户已经初始化过了，问是否要重新设置
- 如果不存在 → 进入首次初始化

### Step 2：引导用户选择工作目录

问用户：「你想把内容数据存在哪里？给我一个目录路径，我会在里面创建 `social-media-output` 文件夹。」

给出建议（根据平台）：
- macOS: `~/Documents` 或 `~/Desktop`
- Windows: `C:\Users\你的用户名\Documents` 或 `D:\`
- Linux: `~/Documents` 或 `~`

如果用户不确定，默认推荐 `~/Documents`。

**路径处理注意事项**：
- 支持 `~` 展开（macOS/Linux）和 `%USERPROFILE%` 展开（Windows）
- 路径中的 `\` 和 `/` 都要能处理
- 如果用户给的路径不存在，询问是否创建

### Step 3：创建目录结构

```bash
# macOS/Linux
mkdir -p "<workspace>/profiles"
mkdir -p "<workspace>/analysis"
mkdir -p "<workspace>/topics"
mkdir -p "<workspace>/data"
mkdir -p ~/.social-media-sniffer
```

```powershell
# Windows
New-Item -ItemType Directory -Force -Path "<workspace>\profiles"
New-Item -ItemType Directory -Force -Path "<workspace>\analysis"
New-Item -ItemType Directory -Force -Path "<workspace>\topics"
New-Item -ItemType Directory -Force -Path "<workspace>\data"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.social-media-sniffer"
```

### Step 4：写入配置文件

将 workspace 路径写入 `~/.social-media-sniffer/config.json`。

### Step 5：介绍工作流

初始化完成后，向用户简要介绍可用的 Skill 和使用流程：

```
✓ 初始化完成！

你的工作目录在：<workspace 路径>

接下来你可以：

1. 建立你的账号画像 → 告诉我你的产品和账号信息
2. 分析竞品内容 → 用浏览器扩展抓取竞品数据，然后让我分析
3. 生成选题 → 基于画像和竞品分析，为你产出选题

建议先从「建立画像」开始，这样后续做选题时我就不用反复问你基本信息了。
```

## 其他 Skill 如何读取配置

所有 Skill 在启动时应该：

1. 读取 `~/.social-media-sniffer/config.json`（Windows: `%USERPROFILE%\.social-media-sniffer\config.json`）
2. 从中取 `workspace` 字段作为工作目录根路径
3. 如果配置文件不存在 → 提示用户先运行 init

读取配置的伪代码：

```python
import os, json

def get_workspace():
    home = os.path.expanduser("~")
    config_path = os.path.join(home, ".social-media-sniffer", "config.json")
    
    if not os.path.exists(config_path):
        return None  # 未初始化，需要先 init
    
    with open(config_path) as f:
        config = json.load(f)
    
    return config.get("workspace")
```

```bash
# shell 版本
CONFIG_FILE="$HOME/.social-media-sniffer/config.json"
if [ -f "$CONFIG_FILE" ]; then
    WORKSPACE=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['workspace'])")
fi
```

## 重新初始化

如果用户说「我想换个目录」「重新初始化」：

1. 读取旧配置，告知用户当前工作目录
2. 问用户新目录路径
3. 询问是否要迁移已有数据到新目录（可选）
4. 更新 config.json

## Windows 兼容注意事项

- 路径分隔符：所有路径存储时统一用正斜杠 `/`，实际使用时由各平台自行处理
- Home 目录：macOS/Linux 用 `~`，Windows 用 `%USERPROFILE%` 或 `$env:HOME`
- 配置文件位置固定在用户 home 下的 `.social-media-sniffer/`
- 创建目录时：macOS/Linux 用 `mkdir -p`，Windows 用 `New-Item -ItemType Directory -Force`
- 脚本调用：shell 脚本仅适用于 macOS/Linux，Windows 环境需要用 Python 脚本替代（所有核心逻辑都可以用 Python 跨平台实现）
