# 0009：ACP Agent 的命令由 Agent 自己裁定

**Status:** accepted

## Context

Claude Code 和 Codex 的内置命令走白名单（ADR 0007，裁定见 `.scratch/agent-commands/issues/03-builtin-verdicts.md`）：没测过的内置命令先拦下，因为有些命令只在 Agent 自己的终端里有用，有些会改掉 aibo 看不到的状态。

ACP Agent 用 `available_commands_update` 报告命令。和 Claude、Codex 相比，有三点不同（`.scratch/agent-extensibility/issues/06-acp-agent-commands.md`）：

- 每条命令只有名称、说明和可选的参数提示，没有“是否内置”“来源”这类字段，aibo 分不出哪些是内置命令。
- ACP 规定客户端把 `/名字 参数` 当作提示词文字发出，由 Agent 执行。只报告能在 ACP 里用的命令，是 Agent 一侧适配器的责任。Claude Code 的 ACP 适配器就主动去掉了 `clear`、`login` 和终端专用的命令；Zed 作为客户端，Agent 报什么就列什么。
- 模型和权限模式改了，ACP 会用 `config_option_update`、`current_mode_update` 报回来，aibo 的控件不会和 Agent 脱节。

## Decision

ACP Agent 报告的命令全部提供，处理方式都是“交给 Agent”。aibo 不为 ACP Agent 维护白名单，也不按名字猜测哪些命令会改状态。

## Consequences

- 接入新的 ACP Agent 时，命令不用逐条裁定。
- Agent 报告了某条在 aibo 里没有效果的命令，aibo 照样提供：执行后没有输出时，显示“命令已执行，没有输出”。如果某条命令确实有害，以后再在 Agent 的登记里加按名字隐藏的选项。
- ACP 没有“上下文重置”的事件。通过 ACP 清空上下文的命令，在 aibo 里没有重置分隔线；ACP 会话 ID 不变，记录不会出错。
- Claude Code 和 Codex 仍走各自的原生协议和白名单：它们的原生协议分得出内置命令，而且有的内置命令要由 aibo 复现。
