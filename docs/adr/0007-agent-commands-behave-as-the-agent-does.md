# 0007：Agent 命令的表现以 Agent 自己的行为为准

**Status:** accepted

## Context

aibo 原来拦下所有以 `/单词` 开头的消息，原因是 `/clear` 这类命令会让 aibo 的记录和 Agent 的状态对不上。现在要让用户调用 Agent 命令（`.scratch/agent-commands/`），就得决定每条命令在 aibo 里表现成什么。

实测（Claude Code 2.1.331、codex-cli 0.169.0，见 `.scratch/agent-commands/research/01-how-agents-expose-commands.md`）：

- Claude Code 在无头模式下自己执行大部分命令。`/clear` 不换进程，清空上下文，原生会话 ID 换成新的，旧的原生会话仍可 resume。
- Codex 的 app-server 不认任何内置命令。`/clear` 之类只存在于它的 TUI 里，文本 `/clear` 会被原样交给模型，模型可能谎称已经清空。

可以由 aibo 给每条命令定一套自己的语义，比如把 `/clear` 做成“新建会话”；也可以让 aibo 跟着 Agent 走。

## Decision

Agent 命令在 aibo 里的表现，以 Agent 自己执行时的实际行为为准：

- Agent 能通过 aibo 所用的协议自己执行的，原样交给它，aibo 如实记录结果。
- 只在 Agent 的 TUI 里有的，由适配器用协议方法复现 TUI 的行为。
- 复现不了的，拦下。

例如 `/clear`：Claude 原样执行，aibo 据 `conversation_reset` 和新的 `system/init` 记下新的原生会话 ID，并在会话里加上下文重置标记。Codex 由适配器调用 `thread/start`，同样记为上下文重置。两家都不新建 aibo 会话。

## Consequences

- 用户在 aibo 里用某个 Agent 的命令，结果和在它自己的终端里用一样，不用另外学一套。
- 同名命令在两家可能表现不同，aibo 不去抹平。
- 适配器要处理命令带来的状态变化。Claude 的 `/model`、`/effort` 改了状态，却不发结构化事件；这类命令要么改走 aibo 的控件，要么拦下，逐条裁定见 `.scratch/agent-commands/issues/03-builtin-verdicts.md`。
- Agent 升级后，命令的行为可能变化，要靠契约测试发现。
