# dsh-game-creator

DeepSeek Harness 的「游戏制作模式」：一个 Agent 预设，用自然语言驱动 **Godot 4.7+** 编辑器做游戏。

选中该预设后，会话里会多出：

- **47 个 Godot 工具**（`mcp__godot__*`）——读场景树、建节点、改属性、写 GDScript、连信号、保存场景、运行/停止、读日志、截图、跑测试；
- **2 个项目工具**——`godot_new_project` 从零建项目（自动装好 Godot AI 插件并开编辑器），`godot_open_project` 打开已有项目。

切到其它预设（standard / PTC / minimal 等），这些工具**完全不可见**：Godot 客户端与项目工具都只声明在预设的插件列表里，没有进全局配置。

## 环境要求

| 依赖 | 版本 |
|---|---|
| DeepSeek Harness | `>=0.2.1-rc.2 <0.3.0` |
| Node.js | `^22.19.0` 或 `>=24`（不要 23） |
| [uv](https://docs.astral.sh/uv/) | 提供 `uvx`，用于拉起 Godot AI 后端 |
| Godot | 4.7 及以上（4.7.2 已验证） |

Godot AI 插件（v4.2.3）已随包内置在 `vendor/godot_ai`，不需要另外下载。

## 安装

### 通过插件市场

把下面这个索引地址加到 DSH 的插件市场（Discover 页 → 添加索引）：

```
https://raw.githubusercontent.com/banbixieyang/dsh-game-creator/main/market/index.json
```

然后在市场里安装 `dsh-game-creator`。

### 手动安装

```powershell
dsh plugin --profile <你的 profile> add github:banbixieyang/dsh-game-creator
```

或在 DSH 里让 Agent 执行 `plugin_manager install_bundle`，target 为
`github:banbixieyang/dsh-game-creator`。

安装后新开会话，在 Agent 预设里选「游戏制作模式」。

> 如果你之前用别的名字装过同一份 preset（`game-creator`），先卸载旧的，否则 preset id 冲突。

## 配置

插件会按顺序找 Godot 可执行文件：

1. 预设配置里的 `godotExe`；
2. 环境变量 `GODOT_BIN`；
3. `PATH` 上的 `godot` / `godot4`。

都找不到时，`godot_new_project` 会报错并说明怎么配。要显式指定，编辑 profile 的 patch 覆盖这一行：

```yaml
- id: game-creator-tools
  name: 'dsh-game-creator/tools'
  config:
    godotExe: D:\Godot\Godot_v4.7.2-stable_mono_win64.exe
    uvxPath: uvx        # 绝对路径或 PATH 上的命令
    httpPort: 8000
    wsPort: 9500
```

## 用法

新会话选「游戏制作模式」，直接说：

> 新建一个 480×720 的 2D 躲避游戏，玩家左右移动，碰到障碍重生，走到终点显示胜利。

模型会先 `godot_new_project` 搭项目并打开编辑器，再用 `mcp__godot__session_manage` 确认会话、`session_activate` 选中，然后建场景、写脚本、运行验证。

已有项目则说“打开 `D:\games\my-game`”，或直接让模型 `godot_open_project`。

## 工作原理

```
DSH 预设
 ├─ persona（中文游戏制作行为指引）
 ├─ 文件 / Shell / 搜索 / 任务工具
 ├─ godot-mcp      → @deepseek-ai/dsh-mcp-client (stdio)
 │                    └─ uvx --from godot-ai==4.2.3 godot-ai attach --port 8000 --ws-port 9500
 └─ game-creator-tools → 本包的 tools.js
                          └─ 建项目 / 开编辑器 / 确保后端在跑
```

Godot 侧由内置的 Godot AI Addon 提供 `127.0.0.1:8000/mcp`（MCP）与 `9500`（编辑器 WebSocket）。DSH 用 `godot-ai attach` 的 stdio 桥接上去，而不是直连 HTTP——HTTP 端点要求每次启动随机生成的 bearer capability，静态配置带不了。

## Windows 低完整性环境

部分机器（安全软件把 Godot 放进沙箱时）Godot 进程运行在 **Low 完整性级别**，写不了 `%LOCALAPPDATA%`，于是编辑器自己拉不起 Godot AI 后端，日志会显示 `server start blocked`。

`godot_new_project` / `godot_open_project` 会先检查 8000 端口，没起就在后台拉起后端（普通权限进程，能正常写 capability），编辑器随后以 `adopted external server` 接上去。手动流程则先运行：

```powershell
uvx --from godot-ai==4.2.3 godot-ai --transport streamable-http --port 8000 --ws-port 9500
```

彻底解决是把 Godot 可执行文件加入安全软件信任列表。

## 已知限制

- `godot_new_project` 返回 `editorPid` 但不等待编辑器注册会话，模型需要再查一次 `session_manage`。
- 一次只建议开一个目标项目会话；多项目同时打开时必须先 `session_activate`。
- 端口 8000 / 9500 被占用时连不上，可通过配置改端口。
- 不包含素材生成；只产出可运行的工程骨架与代码。

## 目录

```
tools.js           两个项目工具
cordis.patch.yml   preset 声明 + 插件行
vendor/godot_ai    Godot AI Addon v4.2.3（MIT）
market/index.json  插件市场索引
DESIGN.md          设计稿
```

## 许可

MIT。内置的 Godot AI Addon 亦为 MIT，见 `vendor/godot_ai/LICENSE`。
