# 调用 Agent 命令

Label: wayfinder:map

## Destination

形成可交付实现的规格：用户在 aibo 里发现并调用 Claude Code 和 Codex 的 Agent 命令（内置命令、用户或项目定义的命令与 skills），每类命令在会话记录里有确定的写法，不让 aibo 的记录与 Agent 的状态脱节。取代现在“以 `/单词` 开头即拦下”的做法。

## Notes

- 术语见[术语表](../../GLOSSARY.md)的“Agent 命令”。讨论决策时使用 grilling 和 domain-modeling。
- 命令清单只取 Agent 自己报告的，不扫描 `.claude/`、`~/.codex/` 等目录（[本机 CLI 接入决策](../../docs/adr/0001-drive-the-agents-own-clis.md)）。界面上统一用 `/` 调用，由适配器翻译成各家的写法。
- Agent 命令在 aibo 里的表现，以 Agent 自己执行时的实际行为为准：Agent 能自己执行的，原样交给它，aibo 如实记录；只在其 TUI 里有的，由适配器用协议方法复现 TUI 的行为，复现不了的就拦下（[ADR 0007](../../docs/adr/0007-agent-commands-behave-as-the-agent-does.md)）。命令是结构化的，不是文本（[ADR 0008](../../docs/adr/0008-agent-commands-are-structured.md)）。
- 用户消息按用户输入原样记录（如 `/review src/`），Agent 展开后的提示词不作为消息。两家都不在协议流里回传展开文本，只写进各自磁盘上的会话记录，因此 aibo 拿不到它（读那些文件与 ADR 0001 相悖）。
- 现状：工作台拦下 `/单词` 开头的消息（[turns.go](../../internal/workbench/turns.go)，`ErrSlashCommand`）；Claude 的 `commands_changed` 与 Codex 的 `skills/changed` 被忽略（[claude/parse.go](../../internal/agent/claude/parse.go)、[codex/notices.go](../../internal/agent/codex/notices.go)）。`/compact` 已由 `Session.Compact` 覆盖，模型和权限模式已有控件。
- 协议结论按[工程约定](../../docs/agents/conventions.md)附真实抓取数据，区分上游文档与本机版本的观测。
- 命令模型要能容纳 ACP 的 `available_commands_update`，但不等[接入第三个及后续 Agent](../agent-extensibility/map.md)的结论。

## Decisions so far

- [Claude Code 和 Codex 怎样报告并执行 Agent 命令](issues/01-how-agents-expose-commands.md) — Claude 在 `initialize` 和 `commands_changed` 里报告完整清单，用户消息 `/名字` 即可调用，`/clear` 会换会话 ID；Codex 只通过 `skills/list` 报告 skills、用 `$名字` 或 skill 输入项调用，没有协议层的内置命令；两家都不在流里回传展开文本

- [用户怎样调用 Agent 命令、会话怎样记录](issues/02-invoke-and-record.md) — 结构化命令 chip，每条消息最多一个且放在开头，由适配器翻译（Claude `/名字`，Codex `$名字` 加 skill 项）；清单外的 `/单词` 拦下；用户消息记命令名、参数和说明快照，本地命令输出标为“命令输出”；`/clear` 表现为上下文重置

- [每条内置命令放行、改走控件还是拦下](issues/03-builtin-verdicts.md) — 内置命令走白名单，新出现和没测过的默认拦下；Claude 的提示词型和只读本地命令放行，`model`/`effort`/`compact`/`rename` 改走 aibo 控件，终端专用、`mcp`、`config`、`loop`、`goal` 拦下；Codex 只复现 `model`/`permissions`/`compact`/`rename`/`clear`/`new`，`review` 待契约测试，其余拦下

- [命令清单在什么时候可用](issues/04-list-availability.md) — 打出 `/` 时才取：Claude 提前启动会话自己的原生进程，从 `initialize` 拿清单；Codex 用 `skills/list`；运行时随 `commands_changed`、`skills/changed` 刷新；清单按 Agent、工作区和登录状态缓存在内存；取不到时拦下 `/单词`

## Not yet specified

（无。剩余的迷雾已在 2026-11-25 划为范围外。）

## Out of scope

- 在 aibo 里创建、编辑 Agent 命令或 skills，管理插件与市场。
- aibo 自己的命令（用 `/` 调用工作台功能）。
- 参数补全、Codex 一条消息带多个 skill、Claude 本地命令附带的结构化数据（`context_usage`、`usage_report`）的专门渲染：都是第一版之后的增强，第一版的规格用不到。
- Agent 主动发起的轮次（Claude 的 `loop`、`goal`，Codex 的 `goal`）、分叉会话（Codex `fork`）、Codex 的 plan 协作模式：都是工作台的独立功能，相关命令在[内置命令裁定](issues/03-builtin-verdicts.md)里先拦下，等这些功能做出来再改裁定。
- MCP 提供的 prompts：aibo 启动 Claude 时带 `--strict-mcp-config`，用户自己的 MCP 服务器不会接进来，所以这些 prompts 在 aibo 里本来就看不到；Codex 不把 MCP prompts 作为命令报告。
- ACP Agent 的 available commands：属于[接入第三个及后续 Agent](../agent-extensibility/map.md)，在那张地图里处理（[issue 06](../agent-extensibility/issues/06-acp-agent-commands.md)）；本地图的命令模型（结构化命令、白名单裁定）要能容纳它。
