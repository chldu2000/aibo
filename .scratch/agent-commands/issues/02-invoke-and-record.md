# 用户怎样调用 Agent 命令、会话怎样记录

Type: grilling
Label: wayfinder:grilling
Status: resolved
Blocked by: 01

## Question

按 01 的结论，决定输入框里 `/` 补全的内容与排序（名称、说明、来源），界面统一的 `/名字 参数` 如何由适配器翻译成 Claude 和 Codex 各自的调用方式，以及调用后会话时间线上出现什么：用户消息原样记录；Claude 本地命令（`/context`、`/usage` 等）的 `<synthetic>` 回复和 `local_command_*` 事件怎样显示；命令无回复或报错时怎样显示。说明 `/Users/...` 这样的路径和不在清单中的 `/单词` 如何处理。

## Answer

**命令是结构化的。** 一条消息最多一个 Agent 命令，放在开头，其后的文字是参数，文件提及和附件照常可带。Claude 只认开头的 `/名字`；Codex 的输入数组可容纳多个 skill，但未实测，统一取两家共同能保证的一个。从 `/` 面板选中，或手打的名字（含别名）在清单中，输入框开头即变成命令 chip，名字换成正式名。Turn 携带 `Command{Name, Args}`，由适配器翻译：

- Claude：拼成 `/名字 参数` 作为用户消息；
- Codex：文本 `$名字 参数`，外加 `{type:"skill", name, path}` 输入项。Codex 内置命令不走文本，由适配器调用对应的 app-server 方法（裁定见 03）。

**清单外的 `/单词` 继续拦下**，提示改为“`/xxx` 不是 <Agent> 的可用命令”，并说明想原样发给模型时在开头加空格。`/Users/...` 这类路径不受影响。

**补全面板**：每行显示名称、灰色参数提示和一行说明。来源只在 Agent 明确给出时显示（Codex 的 `scope`），不解析 Claude 说明里的 ` (project)`。按名称和别名匹配：前缀匹配在前，包含匹配在后，同级按 Agent 给的顺序。被 03 裁定拦下的内置命令不出现。

**时间线**：
- 用户消息显示为命令 chip 加参数（如 `[/review] src/`），chip 悬停显示发送时的说明。消息存下命令名、参数和说明的快照。展开后的提示词拿不到，界面上不假装有。
- Claude 本地命令的 `<synthetic>` 回复照常记为 Agent 回复，但标为“命令输出”：等宽浅色，不显示模型名。`context_usage`、`usage_report` 等附件暂不专门渲染。
- 轮次结束时既无回复也无错误，用户消息下方显示一行“命令已执行”作为兜底。出错走现有的 Failed 显示。“isn't available in this environment”等 Agent 原话按命令输出原样显示。

**会话引用**：读取工具返回 `/review src/`，附上快照里的说明（如“Claude Code 命令：审查当前 diff”）。

**原则（交给 03）**：Agent 命令在 aibo 里的表现，以 Agent 自己执行时的实际行为为准。据此，`/clear` 在两家都表现为上下文重置：
- Claude 原样执行，aibo 依 `conversation_reset` 和新的 `system/init` 记下新的原生会话 ID，并加重置标记；
- Codex 由适配器调用 `thread/start` 复现 TUI 的行为，`/new` 同理。
