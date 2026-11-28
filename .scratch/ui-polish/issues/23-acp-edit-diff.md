# 23: 改文件的调用显示差异（ACP）

Status: resolved
Blocked by: 10

**What to build:** OpenCode、Cursor 等 ACP Agent 改文件的工具调用，和 10 一样显示为文件名、增删行数和差异。

现状（2026-11-27 调研）：ACP 适配器只解码 diff 内容的 `Type`、`Path`、`NewText`（`internal/agent/acp/updates.go:17`），没有 `oldText`；Output 写成 `path + "\n" + NewText`（`updates.go:138`）。ACP 审批只给 `Paths`，没有 `Diff`。testdata 里没有改文件的抓取。

- [x] 补抓：OpenCode 和 Cursor 各跑一次改、建文件的会话，整理进 `internal/agent/acp/testdata/`，结论回填 `docs/acp-agents.md`
- [x] 解码 diff 内容的 `oldText`
- [x] 有 `oldText` 时生成统一格式的补丁，填进 10 加的结构化字段；没有时（新建文件或 Agent 不给）标为整段新内容，不伪造差异
- [x] 外壳：整段新内容显示为“新内容”，不显示 −0
- [x] 单元测试用抓取数据；契约测试分别跑 OpenCode 和 Cursor

## 决定（2026-11-27）

- 补上 `oldText`；没有时整段显示新内容。

## 实现说明

- 抓取和结论见 `../research/23-file-changes.md`，已回填 `docs/acp-agents.md` 的兼容范围和验证两节。
- 两家都只给改前改后的全文，不给补丁，所以在 `agent` 包加了 `PatchTexts`（`internal/agent/textdiff.go`）：
  - 去掉相同的开头和结尾，中间用 LCS 求最少的增删；中间太大（约 400 万格）时整段删除再添加；
  - 按 3 行上下文切成 hunk，替换的行先删后加，和 git diff 一样。
- ACP 适配器（`acp/changes.go`）：
  - 解码 diff 内容的 `oldText`（可能为空）；
  - 有 `oldText` 时是修改，补丁由 `PatchTexts` 生成；
  - 没有 `oldText` 时按 ACP 的规定是新建，补丁是全文添加；
  - Cursor 新建文件时给的 `oldText` 是 `"-- /dev/null"`，`newText` 第一行是 `"++ b/路径"`，单独认出来，去掉这一行后按新建处理。
  - 开始和结束时都把改动交给工作台；结束时没有改动就保留开始时的。`Output` 保持原样。
- 清单里“没有 `oldText` 时标为整段新内容”和“外壳：整段新内容显示为'新内容'，不显示 −0”这两条，改成了：没有 `oldText` 就是 ACP 规定的新建文件，显示为“新建”。所有 Agent 都一样，增删行数里为 0 的一边不显示：新建显示“b.txt +2”，删除显示“−N”。两边都为 0 时照旧都显示。
- OpenCode 新建文件时不给 diff，不从 `rawInput` 里猜（通用适配器不按工具名解析参数），这类调用照旧显示结果文字。
- 测试：
  - `agent.TestPatchTexts`、`TestPatchTextsBig`；
  - `acp.TestCursorEditChanges`、`TestOpenCodeEditChanges`（用抓取数据）、`TestDiffWithoutOldText`；
  - `shell.TestFileChangeCalls` 加了“没有 +0、−0”；
  - 契约测试 `contract.TestContractACPFileChanges`：OpenCode 和 Cursor 各跑一轮，2026-11-28 在 Windows 上通过。OpenCode 用的是用户自己的配置，因为登录和模型在里面。

## 没有验证

- 没有在真机上看 ACP 调用的差异。
- 改动很大的文件（中间部分超过约 400 万格）会显示为整段替换，没有用真实的大文件试过耗时。
- 审批卡仍用原来的显示（ACP 审批只有路径）。
- 其他 ACP Agent（用户自己登记的）没有试过，只要按 ACP 给 `oldText`/`newText` 就能显示。
