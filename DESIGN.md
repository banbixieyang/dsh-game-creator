# 「游戏制作模式」变更设计稿

日期：2026-10-25
目标：在 DSH 0.2.1-rc.2 的 `desktop` profile 中新增一个 Agent 预设「游戏制作模式」，通过 Godot AI MCP 驱动 Godot 4.7.2 编辑器做游戏。

## 1. 取证结论

| 项 | 实测值 | 结论 |
|---|---|---|
| DSH 版本 | `0.2.1-rc.2`（`resources/app.asar/dsh/package.json`） | ≥ 0.1.7-rc.2，使用 **Cordis 声明行** `@deepseek-ai/dsh-agent-preset`，不建 `.agent-presets/` 旧目录 |
| Profile | `desktop`（`$DSH_PROFILE_DIR=C:\Users\Lenovo\.dsh\profiles\desktop`） | 改动只作用于该 profile |
| preset 契约 | `Config.listConfigs(entry=include:preset-standard)` → `PresetDefinition { id, name, description, order, plugins }` | 字段已确认，不凭记忆写 |
| 已有 preset | standard(1) / ptc(2) / minimal(3) / cordis(4) | 新预设 `order: 5` |
| Node.js | v24.20.0 | 满足 `^22.19.0 || >=24`，非 23 |
| uvx | `C:\Users\lenovo\.local\bin\uvx.exe` | 可用（Godot AI 后端依赖 uv） |
| Godot | `Godot_v4.7.2-stable_mono_win64` 压缩包已解压，`--version` = `4.7.2.stable.mono.official` | 满足 Godot AI v4 的 4.7+ 要求 |
| Godot AI Addon | `~/Downloads/godot-ai-plugin.zip` 内的 `godot-ai-v4-plugin.zip`（plugin.cfg `4.2.3`） | 可离线安装到项目 |
| MCP 端点 | Godot AI Addon `client_configurator.gd::http_url()` = `http://127.0.0.1:8000/mcp`（streamable-http） | DSH 侧用 `@deepseek-ai/dsh-mcp-client` + `transport: streamable-http` |

## 2. 声明方式

- **选定：Cordis 声明行**（bundle patch 内 `insert` 一个 `preset-game-creator` 行）。
- 不新增 `$DSH_HOME/.agent-presets/game-creator/` 目录，不混用两种格式。
- 安装方式：`plugin_manager install_bundle`，不手工改 profile 的 `package.json` / `cordis.patch.yml`。

## 3. Bundle 设计

- 包名：`@local/dsh-game-creator-preset`
- 目录：`default-workspace/game-creator/`
- 文件：`package.json`（`dsh.bundle.patch` 指向 patch）、`cordis.patch.yml`、`README.md`、`DESIGN.md`
- Loader 行 id：`preset-game-creator`；preset id：`game-creator`；显示名：`游戏制作模式`

### 挂载的子插件

| 行 id | 包 | 作用 |
|---|---|---|
| `persona` | `@deepseek-ai/dsh-persona` | 游戏制作行为指引（中文） |
| `agent-instructions` | `@deepseek-ai/dsh-agent-instructions` | 读取项目 AGENTS.md |
| `time-context` | `@deepseek-ai/dsh-time-context` | 时间上下文 |
| `tool-pwsh` / `tool-bash` | `@deepseek-ai/dsh-tool-pwsh` / `-bash` | 平台二选一 |
| `tool-fs` / `tool-fs-search` | `@deepseek-ai/dsh-tool-fs`、`-fs-search` | 读写 Godot 项目文件 |
| `tool-jobs` | `@deepseek-ai/dsh-tool-jobs` | 后台任务 |
| `tool-todo` | `@deepseek-ai/dsh-tool-todo` | 多步任务跟踪 |
| `tool-web` | `@deepseek-ai/dsh-tool-web` | 查 Godot 文档 |
| `compaction` 组 | `dsh-compaction-basic` + `dsh-command-compact` + `dsh-compaction-tool-result-pruner` | MCP 工具输出很大，必须裁剪 |
| **`godot-mcp`** | **`@deepseek-ai/dsh-mcp-client`** | **唯一 Godot 能力来源**，`serverName: godot`；`transport: stdio`，命令为 `uvx --from godot-ai==4.2.3 godot-ai attach --port 8000 --ws-port 9500` |

> 为什么用 stdio 而不是直接连 `http://127.0.0.1:8000/mcp`：HTTP 端点要求 `Authorization: Bearer <每次启动随机生成的 capability>`，静态配置无法跨后端重启携带；`godot-ai attach` 这个 stdio 桥会自己读取 capability 记录并转发，DSH 侧只需要一条静态命令。

### 权限边界

- Godot MCP 客户端**只出现在 preset 的 `plugins` 列表里**，不进 profile patch、不进 Host 配置。
- preset 是 Cordis 作用域，MCP 工具注册在选中该 preset 的 Agent 作用域内；其它 preset（standard/ptc/minimal/cordis）不加载该行，因此完全看不到 `mcp__godot__*`。
- profile patch 里原有的 `mcp-godot`（`@letsagents/godot-mcp`）不是本方案的一部分；实测该行没有成为 Loader 条目（`list_plugins` 无 `include:mcp-godot`），属于失效的遗留行，不产生全局工具。
- 文件/Shell 工具只在该 preset 内挂载，权限仍受会话的 sandbox policy 约束。

## 4. 持久化

- 源码：`default-workspace/game-creator/`（可重复安装/升级）
- 安装结果：`$DSH_PROFILE_DIR`（由 `plugin_manager` 维护，不手写）

## 5. 连接与失败处理

- Godot 侧：项目内 `addons/godot_ai`（v4.2.3），Project Settings → Plugins 启用；插件拉起 `uvx` 后端并监听 `127.0.0.1:8000/mcp`（MCP）+ `9500`（编辑器 WebSocket）。
- DSH 侧：`failOnStartupError: false` —— Godot 未打开时 preset 仍可正常使用（只是没有 Godot 工具），不让整个模式变 `broken`。
- 自动重连：`reconnect.maxAttempts: 60`、`maxDelayMs: 30000`，覆盖“先开模式、后开 Godot”的常见顺序。
- 回退：若 Godot AI MCP 不可用（Addon 起不来 / 端口冲突 / 版本不兼容），回退到 `dsh-godot-tool` 的 TCP JSON-lines 方案（Godot 侧 `addons/agent_rpc/`，DSH 侧 27 个 `godot_*` 工具，`127.0.0.1:8765`）。**注意：本次取证时 npm 上不存在 `dsh-godot-tool` 包（404）**，若走回退需要自行实现 Godot 侧 addon + DSH 侧插件，报告里会标注这一点。

## 5.1 本机环境发现（已实测）

Godot 4.7.2 进程及其子进程运行在 **Windows Low 完整性级别**（子进程 `whoami /all` 报告 `Mandatory Label\Low`），因此它无法在 `%LOCALAPPDATA%` / `%APPDATA%` 下写文件：

- `DirAccess.make_dir_recursive_absolute("…/godot-ai/capabilities")` → `Can't create`
- `FileAccess.open("…/Godot/resthumb-*.png", WRITE)` → `Can't save PNG`
- 由编辑器拉起的 `godot-ai` 后端同样 Low，写不了 capability 记录 → 启动即退出

绕行办法（已验证可行）：**在普通（Medium）进程里手动启动后端**，编辑器会以 “adopted external server” 方式接上去：

```powershell
.\start-godot-ai-server.bat
```

随后打开项目，日志应出现：

```
MCP | Probing the configured server endpoint.
MCP | adopted external server
MCP | connected to server; authenticating
MCP | authenticated with server
```

DSH 侧的 stdio 桥连的是同一个后端，因此不受影响。

根因大概率是本机安全软件/系统策略把 Godot 放进低完整性沙箱；彻底修复需要在安全软件里信任 Godot 可执行文件，或换一个不会被降权的启动方式。详见 `REPORT.md`。

## 6. 验收

1. `plugin_manager list_plugins` 出现 `include:preset-game-creator`，`fiberPhase: active`。
2. `agentPresets.list` 名单里出现 `game-creator`，无 `broken`。
3. standard 会话工具列表无 `mcp__godot__*`。
4. 游戏制作模式会话工具列表出现 `mcp__godot__*`。
5. Godot 4.7.2 打开空项目 + 启用 Addon，MCP 端点 200。
6. 冒烟：创建 Node2D 场景 + Sprite2D 子节点 + 移动脚本，回读确认。
