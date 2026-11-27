# 10: 改文件的调用显示差异（Claude Code、Codex）

Status: ready-for-agent

**What to build:** Claude Code 和 Codex 改文件的工具调用在会话里显示为“文件名 +N −M”，展开是统一格式的差异，而不是原始 JSON。ACP 见 23。

现状（2026-11-27 调研）：
- `model.Tool`（`internal/model/model.go:156`）和 `agent.ToolStarted`/`ToolFinished`（`internal/agent/agent.go:359`）没有文件改动的字段；只有审批的 `Approval.Diff`。
- Claude：`Edit`、`MultiEdit`、`Write`、`NotebookEdit` 只在审批里识别（`internal/agent/claude/approval.go:76`）。参数有 `file_path`、`old_string`/`new_string`、`edits[]`、`content`。结果的 `tool_use_result`/`structuredPatch` 没有解码（`parse.go:65`）。
- Codex：`fileChange` 改名为 `apply_patch`（`internal/agent/codex/parse.go:118`），每项有 `changes[]{path, diff, kind}`，但 Input 只留“种类 路径”摘要，Output 把各文件的补丁拼在一起，路径和补丁对不上（`parse.go:153`）。
- testdata 里没有任何一家改文件的真实抓取数据。

- [ ] 补抓：Claude Code 和 Codex 各跑一次改、建、删文件的会话，整理进各自的 `testdata/`，结论写进 `.scratch/ui-polish/research/`
- [ ] `agent` 包：`ToolStarted`/`ToolFinished` 加结构化的文件改动（路径、种类：改/建/删/改名、统一格式的补丁；没有补丁时给改前改后的文字）
- [ ] Claude 适配器：优先解码结果里的 `structuredPatch`（带上下文）；抓取里没有时用参数的改前改后文字生成
- [ ] Codex 适配器：把 `changes[]` 逐文件交出，路径和补丁一一对应
- [ ] 工作台：存进 `model.Tool` 的新字段（先查清要不要存储迁移；迁移只能追加，要跑 `OpenVersion` 测试）
- [ ] 外壳：标签显示文件名和增删行数，多个文件时显示“N 个文件 +A −D”；展开用 `editor.DiffView`（Git 页已在用），限高同 09；点文件名在详情面板的文件页打开该文件
- [ ] 单元测试用抓取数据；契约测试（`AIBO_CONTRACT=1`）跑真实的改文件轮次

## 决定（2026-11-27）

- 由各适配器解析，通过新增的结构化字段交给工作台；工作台不按工具名解析参数。`ActivityOf` 只按名字分类、不解析参数，不算先例。
- 先做 Claude Code 和 Codex，ACP 单独做（23）。

## 不做

- ACP（23）。
