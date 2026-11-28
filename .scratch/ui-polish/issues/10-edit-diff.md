# 10: 改文件的调用显示差异（Claude Code、Codex）

Status: resolved

**What to build:** Claude Code 和 Codex 改文件的工具调用在会话里显示为“文件名 +N −M”，展开是统一格式的差异，而不是原始 JSON。ACP 见 23。

现状（2026-11-27 调研）：
- `model.Tool`（`internal/model/model.go:156`）和 `agent.ToolStarted`/`ToolFinished`（`internal/agent/agent.go:359`）没有文件改动的字段；只有审批的 `Approval.Diff`。
- Claude：`Edit`、`MultiEdit`、`Write`、`NotebookEdit` 只在审批里识别（`internal/agent/claude/approval.go:76`）。参数有 `file_path`、`old_string`/`new_string`、`edits[]`、`content`。结果的 `tool_use_result`/`structuredPatch` 没有解码（`parse.go:65`）。
- Codex：`fileChange` 改名为 `apply_patch`（`internal/agent/codex/parse.go:118`），每项有 `changes[]{path, diff, kind}`，但 Input 只留“种类 路径”摘要，Output 把各文件的补丁拼在一起，路径和补丁对不上（`parse.go:153`）。
- testdata 里没有任何一家改文件的真实抓取数据。

- [x] 补抓：Claude Code 和 Codex 各跑一次改、建、删文件的会话，整理进各自的 `testdata/`，结论写进 `.scratch/ui-polish/research/`
- [x] `agent` 包：`ToolStarted`/`ToolFinished` 加结构化的文件改动（路径、种类：改/建/删/改名、统一格式的补丁；没有补丁时给改前改后的文字）
- [x] Claude 适配器：优先解码结果里的 `structuredPatch`（带上下文）；抓取里没有时用参数的改前改后文字生成
- [x] Codex 适配器：把 `changes[]` 逐文件交出，路径和补丁一一对应
- [x] 工作台：存进 `model.Tool` 的新字段（先查清要不要存储迁移；迁移只能追加，要跑 `OpenVersion` 测试）
- [x] 外壳：标签显示文件名和增删行数，多个文件时显示“N 个文件 +A −D”；展开用 `editor.DiffView`（Git 页已在用），限高同 09；点文件名在详情面板的文件页打开该文件
- [x] 单元测试用抓取数据；契约测试（`AIBO_CONTRACT=1`）跑真实的改文件轮次

## 决定（2026-11-27）

- 由各适配器解析，通过新增的结构化字段交给工作台；工作台不按工具名解析参数。`ActivityOf` 只按名字分类、不解析参数，不算先例。
- 先做 Claude Code 和 Codex，ACP 单独做（23）。

## 不做

- ACP（23）。

## 实现说明

- 调研结论和抓取数据的位置见 `../research/10-file-changes.md`。两家都给出了带上下文的补丁。
- `agent` 包，新文件 `internal/agent/filechange.go`：
  - `FileChange` 有路径、种类（`FileModified`、`FileAdded`、`FileDeleted`、`FileMoved`）、`MovedTo`，以及单文件的统一格式补丁 `Patch`（带 `---`/`+++` 头）。
  - 辅助函数：`PatchHunks`（hunk 加上文件头）、`PatchAdded`、`PatchDeleted`（全文转成补丁），以及 `PatchStats`（统计增删行数，只数 hunk 里的行）。
  - `ToolStarted` 和 `ToolFinished` 各加了 `Changes`。`ToolFinished` 的 `Changes` 不为空时替换开始时的。
- Claude 适配器（`claude/changes.go`）：解码 `user` 消息顶层的 `tool_use_result`，只认带 `structuredPatch` 的结果。
  - `type: create` 是新建，补丁由 `content` 生成；
  - 有 hunk 的是修改；
  - 只在消息里只有一个 `tool_result` 且没有出错时才取。
  - 没有按“抓取里没有时用参数的改前改后文字生成”去做：没有 `structuredPatch` 的只有失败的调用，这种调用什么也没改。
- Codex 适配器（`codex/changes.go`）：`changes[]` 逐文件转换，开始和结束时都交出。`kind.move_path` 不为空时是移动。`Input` 和 `Output` 保持原样，引用和复制仍然用它们。
- 工作台：`ToolStarted` 时记下 `Changes`，`ToolFinished` 带了就替换。`model.Tool.Changes` 加了 `omitempty`，存在消息的 JSON 列里，不需要存储迁移。`Clone` 会复制这个切片。
- 外壳（`shell/changes.go`）：
  - 调用的标签：一个文件时是“a.txt +1 −1”（移动时是“old → new”），多个文件时是“N 个文件 +A −D”，后面照旧跟着运行中、出错等状态。
  - 展开后每个文件一行，显示路径（工作区内的写相对路径）、新建/删除/移动的标记和增删行数，下面是 `editor.DiffView`。
    - 补丁不超过 400 行时按内容的高度显示，超过 320 就在框内滚动；更长的固定 320 高，在编辑器里滚动。
    - 解析失败时按文字显示。
  - 点路径会在详情面板的文件页打开该文件。删除的文件和工作区外的文件不能点。
  - 没有出错时不显示“结果”：Claude 的结果只是一句“已更新”，Codex 的结果和差异重复。
  - 组摘要“改了 N 个文件”按文件数算，同一个文件只算一次。原来按调用数算，一个 Codex 补丁改三个文件只算一个。
- 适配器认出了 Claude 新的 `system/thinking_tokens` 消息（推理大约用了多少 token），写明不显示。
- 测试：
  - `claude.TestEditChanges`、`codex.TestEditChanges`：用抓取数据；
  - `codex.TestMovedFile`：手写的移动数据；
  - `workbench.TestFileChanges`：替换、保留、重启后读出；
  - `shell.TestFileChangeCalls`：标签、组摘要、路径、新建/删除标记、不显示结果、点路径打开文件页；
  - 契约测试 `contract.TestContractFileChanges`：真实的 Claude（haiku）和 Codex 各跑一轮，2026-11-28 在 Windows 上通过。

## 没有验证

- 没有在真机上看差异的样子：`NoBackground` 的 DiffView 放在 `Surface` 底色的滚动框里，嵌套滚动的手感也没看过。
- Codex 的移动、Claude 的 MultiEdit 和 NotebookEdit 没有真实抓取。移动只用手写数据测过；后两种按 `structuredPatch` 识别，有这个字段才显示差异。
- 审批卡仍用原来的 `Approval.Diff`（Claude 的没有 hunk 头），没有改成新的补丁。
- 历史会话里的旧调用没有 `Changes`，仍按原样显示。
