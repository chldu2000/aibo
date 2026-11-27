# 会话引用里的命令消息

Type: task
Status: ready-for-agent
Blocked by: 06

## What to build

读取工具遇到带命令快照的用户消息时，写成 `/名字 参数`，后面附上“<Agent 名> 命令：<说明>”。这段文字是给 Agent 读的，放在 `internal/refs`。见[规格](../spec.md)的“会话引用”。

## Acceptance criteria

- [ ] 引用一个含命令消息的会话，读取结果里有命令名、参数和说明。
- [ ] 旧消息的读取结果不变。
- [ ] 先例：`references_test.go`。
