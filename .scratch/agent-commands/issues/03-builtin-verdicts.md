# 每条内置命令放行、改走控件还是拦下

Type: grilling
Label: wayfinder:grilling
Status: resolved
Blocked by: 01

## Question

按 01 抓到的 Claude Code 与 Codex 内置命令清单，逐条归为三类：放行（展开成普通轮次，如 `/review`、`/init`）、改走 aibo 已有控件（`/model`、`/compact`、权限模式）、拦下并说明原因。Codex 的 app-server 不认任何内置命令，所以 Codex 这边要决定的是：哪些 TUI 命令要由适配器映射到 app-server 方法（`review/start`、`thread/fork` 等）。注意 `thread/shellCommand` 不受沙箱限制。Claude 的 `/model`、`/effort` 改了状态却没有结构化事件，会让 aibo 的控件与实际状态脱节。裁定的依据是地图注记里的原则：以 Agent 自己执行时的实际行为为准。`/clear` 已在 02 中定为上下文重置：Claude 原样执行，aibo 记下新的原生会话 ID；Codex 的 `/clear`、`/new` 由适配器调用 `thread/start`。说明 Agent 升级新增未裁定的内置命令时的默认处理。

## Answer

依据 [ADR 0007](../../../docs/adr/0007-agent-commands-behave-as-the-agent-does.md)：Agent 能自己执行的，原样交给它；只在 TUI 里有的，由适配器用协议方法复现；复现不了的，拦下。拦下的命令不出现在 `/` 面板里，手打时按“不是可用命令”提示（见 02）。

### 默认规则

- **白名单**：只有下表裁定过的内置命令（Claude 中带 `builtin: true` 的条目）才出现在面板里、才能调用。Agent 升级后新出现的内置命令默认拦下；契约测试发现新命令时报出来，提醒补上裁定。
- 非内置的命令，也就是自定义命令、skills、插件提供的条目，以及 Codex 的全部 skills，一律放行。
- 没测过的命令一律先拦下，等契约测试测过、补上裁定再放开。

### Claude Code

| 裁定 | 命令 | 理由 |
|---|---|---|
| 放行 | `init`、`code-review`（别名 `review`）、`security-review`、`simplify`、`debug`、`verify`、`batch`、`run`、`run-skill-generator`、`dataviz`、`claude-api`、`plugin-authoring`、`update-config`、`fewer-permission-prompts`、`auto-mode-setup`、`schedule`、`insights`、`team-onboarding` | 提示词型命令，展开后是一个普通轮次，需要审批的照常走审批 |
| 放行 | `context`、`usage`（别名 `cost`、`stats`）、`reload-skills`、`output-style` | 本地命令，只是查看信息，或者改动 aibo 不显示的状态。输出标为命令输出 |
| 改走 aibo 控件 | `model`、`effort` | Claude 执行时不发结构化事件。改由 aibo 调用 `SetModel`，Claude 会通过 `SettingsReported` 报回实际设置 |
| 改走 aibo 控件 | `compact` | 调用 `Compact` |
| 改走 aibo 控件 | `rename`（别名 `name`） | 调用 aibo 的 `Rename`，改的是 aibo 的会话标题 |
| 上下文重置 | `clear`（别名 `reset`、`new`） | 原样执行，aibo 记下新的原生会话 ID 并加重置标记（02） |
| 拦下 | `doctor`、`color`、`focus`、`reload-plugins` | Claude 自己列为终端专用（`terminal_slash_commands`） |
| 拦下 | `agents`、`extra-usage`、`__remote-workflow`、`workflow-launch-exec` | 已移除或改名，或者只供服务端使用 |
| 拦下 | `mcp` | 能断开或禁用 aibo 的 MCP 服务器，断开后会话引用就读不了 |
| 拦下 | `config` | 写用户全局的配置，能悄悄改掉模型或权限 |
| 拦下 | `loop`、`goal` | 会自己发起轮次，工作台还不支持 |
| 拦下（未测） | `autocompact`、`fast`、`heapdump`、`usage-credits`、`recap`、`list-agents` | 没测过 |

### Codex（app-server 不认内置命令，全部由适配器处理）

| 裁定 | 命令 | 做法 |
|---|---|---|
| 改走 aibo 控件 | `model` | 调用 `SetModel` |
| 改走 aibo 控件 | `permissions` | 调用 `SetMode` |
| 改走 aibo 控件 | `compact` | 调用 `Compact`（`thread/compact/start`） |
| 改走 aibo 控件 | `rename` | 调用 aibo 的 `Rename` |
| 上下文重置 | `clear`、`new` | 调用 `thread/start` 并加重置标记 |
| 映射，前提是契约测试先跑通 | `review` | 调用 `review/start`。实现时抓取审查模式的条目、加契约测试；测试过不了就拦下 |
| 拦下 | 其余全部，例如：`init`（没有协议方法，复现要复制 Codex 写死的提示词）、`fork`（aibo 没有分叉会话）、`archive`、`delete`、`resume`（用 aibo 自己的菜单）、`plan`（aibo 的权限模式里没有协作模式）、`status`、`usage`、`mcp`、`debug-config`（只返回数据，没有文字输出）、`goal`（会自己发起轮次）、`skills`（`/` 面板已替代）、账号与配置类、TUI 界面类、`ps`、`stop`、`side`、`agents`、`subagents`、`worktree`、`cd` | — |

`!命令`（`thread/shellCommand`）不是 Agent 命令；它不经沙箱，不提供。
