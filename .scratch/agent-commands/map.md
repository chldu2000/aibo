# 调用 Agent 命令

Label: wayfinder:map

## Destination

形成可交付实现的规格：用户在 aibo 里发现并调用 Claude Code 和 Codex 的 Agent 命令（内置命令、用户或项目定义的命令与 skills），每类命令在会话记录里有确定的写法，不让 aibo 的记录与 Agent 的状态脱节。取代现在“以 `/单词` 开头即拦下”的做法。

## Notes

- 术语见[术语表](../../GLOSSARY.md)的“Agent 命令”。讨论决策时使用 grilling 和 domain-modeling。
- 命令清单只取 Agent 自己报告的，不扫描 `.claude/`、`~/.codex/` 等目录（[本机 CLI 接入决策](../../docs/adr/0001-drive-the-agents-own-clis.md)）。界面上统一用 `/` 调用，由适配器翻译成各家的写法。
- 用户消息按用户输入原样记录（如 `/review src/`），Agent 展开后的提示词不作为消息。两家都不在协议流里回传展开文本，只写进各自磁盘上的会话记录，因此 aibo 拿不到它（读那些文件与 ADR 0001 相悖）。
- 现状：工作台拦下 `/单词` 开头的消息（[turns.go](../../internal/workbench/turns.go)，`ErrSlashCommand`）；Claude 的 `commands_changed` 与 Codex 的 `skills/changed` 被忽略（[claude/parse.go](../../internal/agent/claude/parse.go)、[codex/notices.go](../../internal/agent/codex/notices.go)）。`/compact` 已由 `Session.Compact` 覆盖，模型和权限模式已有控件。
- 协议结论按[工程约定](../../docs/agents/conventions.md)附真实抓取数据，区分上游文档与本机版本的观测。
- 命令模型要能容纳 ACP 的 `available_commands_update`，但不等[接入第三个及后续 Agent](../agent-extensibility/map.md)的结论。

## Decisions so far

- [Claude Code 和 Codex 怎样报告并执行 Agent 命令](issues/01-how-agents-expose-commands.md) — Claude 在 `initialize` 和 `commands_changed` 里报告完整清单，用户消息 `/名字` 即可调用，`/clear` 会换会话 ID；Codex 只通过 `skills/list` 报告 skills、用 `$名字` 或 skill 输入项调用，没有协议层的内置命令；两家都不在流里回传展开文本

## Not yet specified

- 展开内容对会话引用的影响：接收方只看到 `/review src/` 时，引用概要和读取工具是否需要补上命令的含义或展开文本。两家都不回传展开文本，aibo 能给接收方的只有命令名、参数和清单里的说明。
- 带参数的命令：参数提示、参数补全（如 skill 声明的参数）。
- MCP 提供的 prompts 是否也作为 Agent 命令出现。
- ACP Agent 的 available commands 能否套用同一模型。

## Out of scope

- 在 aibo 里创建、编辑 Agent 命令或 skills，管理插件与市场。
- aibo 自己的命令（用 `/` 调用工作台功能）。
