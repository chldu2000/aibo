# 每条内置命令放行、改走控件还是拦下

Type: grilling
Label: wayfinder:grilling
Status: open
Blocked by: 01

## Question

按 01 抓到的 Claude Code 与 Codex 内置命令清单，逐条归为三类：放行（展开成普通轮次，如 `/review`、`/init`）、改走 aibo 已有控件（`/model`、`/compact`、权限模式）、拦下并说明原因。Codex 的 app-server 不认任何内置命令，所以 Codex 这边要决定的是：哪些 TUI 命令要由适配器映射到 app-server 方法（`review/start`、`thread/fork` 等）。注意 `thread/shellCommand` 不受沙箱限制。Claude 的 `/model`、`/effort` 改了状态却没有结构化事件，会让 aibo 的控件与实际状态脱节。裁定的依据是地图注记里的原则：以 Agent 自己执行时的实际行为为准。`/clear` 已在 02 中定为上下文重置：Claude 原样执行，aibo 记下新的原生会话 ID；Codex 的 `/clear`、`/new` 由适配器调用 `thread/start`。说明 Agent 升级新增未裁定的内置命令时的默认处理。
