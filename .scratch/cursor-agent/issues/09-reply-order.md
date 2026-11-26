# 09: 没有 messageId 的 ACP Agent，一轮里的回复都并进第一条

Status: ready-for-agent

**What to build:** 用 Cursor CLI 时，一轮里先说了一句、然后调用工具、最后再说一句，时间线上显示成一条回复在前（两句话都在里面）、工具调用在后，顺序和实际发生的不一致。应该按发生的顺序显示：回复、工具、回复。

发现于：用户实机使用 Cursor（2026-11-26）。

## 原因

ACP 适配器（`internal/agent/acp/updates.go` 的 `update`）按 `agent_message_chunk`/`agent_thought_chunk` 的 `messageId` 分段：`messageId` 变了就结束上一段（`finishReply`）、开新的一段。没有 `messageId` 时，整轮都用同一个 ID `turn-<请求号>`，工具调用（`tool`）也不结束当前段。工作台（`internal/workbench/events.go` 的 `ReplyDelta`）把同一 ID 的文字追加到已有的那条消息上，那条消息在它第一次出现的位置，于是工具之后说的话也进了工具之前的那条回复。思考（`ThinkingDelta`）用同一个 ID，同样并进去。

抓取对照（`internal/agent/acp/testdata/cursor-2026.11.22-turns.jsonl`，第二轮）：`agent_thought_chunk` ×5 → `agent_message_chunk`“我会在当前目录执行你指定的命令。” → `tool_call`/`request_permission`/`tool_call_update` → `agent_thought_chunk` ×2 → `agent_message_chunk`“DONE”。所有分块都没有 `messageId`，aibo 显示为一条回复“我会在当前目录执行你指定的命令。DONE”在上、工具在下。

## 哪些 Agent 会出现

- **Cursor CLI 2026.11.22**：会。分块一律不带 `messageId`（上面的抓取，以及 `session/load` 重放的分块）。
- **OpenCode**：不会。每段文字和思考都有自己的 `messageId`（`prt_…`），工具前后的 ID 不同（`.scratch/agent-extensibility/research/01-probes/turns.jsonl`），已经按顺序分开。
- **Claude Code、Codex**：不会。它们不走 ACP，适配器按各自的消息和条目 ID 分段（`internal/agent/claude/parse.go`、`internal/agent/codex/parse.go`）。
- **其他 ACP Agent**：可能会。ACP v1 里 `messageId` 是可选的（[v1 schema](https://agentclientprotocol.com/protocol/v1/schema)，[Message ID RFD](https://agentclientprotocol.com/rfds/message-id)），v2 才要求每个分块都带（[v2 迁移说明](https://agentclientprotocol.com/protocol/v2/migration)）。已有别的 ACP 实现报告过不带 `messageId` 的情况（例如 [OndeCode #18](https://github.com/kelvin-soen/OndeCode/issues/18)）。所以这是通用适配器的问题，Cursor 只是第一个碰到的；不按 Agent 特判。

## 做法

- [ ] Agent 没给 `messageId` 时，适配器自己分段：一轮里出现新的工具调用（`tool_call` 第一次见到某个 `toolCallId`）或计划更新时，结束当前段（`finishReply`），之后的文字和思考用新的 ID（如 `turn-<请求号>-<段号>`）。Agent 给了 `messageId` 的照旧按它分，不受影响
- [ ] 同一段里先思考后回复的，仍在一条消息里（现在的样子）；工具之后的思考进下一段
- [ ] 审批请求（`session/request_permission`）跟着它的工具，不单独分段
- [ ] 测试：`TestCursorTurnCapture`（`internal/agent/acp/cursor_test.go`）补上：两段回复的 ID 不同，第一段是“我会在当前目录执行你指定的命令。”、第二段是“DONE”，各自 `ReplyDone`；工具事件在两段之间。另加一个用 OpenCode 抓取的检查，确认带 `messageId` 的分段不变
- [ ] 工作台层面确认（可用假 Agent）：两段 ID 不同的回复和中间的工具，时间线顺序是回复、工具、回复
- [ ] 续聊：`session/load` 的重放 aibo 本来就跳过，不受影响；核对一下
- [ ] `docs/acp-agents.md` 兼容范围表“新建与对话”一行补一句：没有 `messageId` 时按工具调用分段

## 不做

已经存下来的旧会话不重排：那些回复在库里已经是一条消息。
