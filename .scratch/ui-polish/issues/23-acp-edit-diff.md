# 23: 改文件的调用显示差异（ACP）

Status: ready-for-agent
Blocked by: 10

**What to build:** OpenCode、Cursor 等 ACP Agent 改文件的工具调用，和 10 一样显示为文件名、增删行数和差异。

现状（2026-11-27 调研）：ACP 适配器只解码 diff 内容的 `Type`、`Path`、`NewText`（`internal/agent/acp/updates.go:17`），没有 `oldText`；Output 写成 `path + "\n" + NewText`（`updates.go:138`）。ACP 审批只给 `Paths`，没有 `Diff`。testdata 里没有改文件的抓取。

- [ ] 补抓：OpenCode 和 Cursor 各跑一次改、建文件的会话，整理进 `internal/agent/acp/testdata/`，结论回填 `docs/acp-agents.md`
- [ ] 解码 diff 内容的 `oldText`
- [ ] 有 `oldText` 时生成统一格式的补丁，填进 10 加的结构化字段；没有时（新建文件或 Agent 不给）标为整段新内容，不伪造差异
- [ ] 外壳：整段新内容显示为“新内容”，不显示 −0
- [ ] 单元测试用抓取数据；契约测试分别跑 OpenCode 和 Cursor

## 决定（2026-11-27）

- 补上 `oldText`；没有时整段显示新内容。
