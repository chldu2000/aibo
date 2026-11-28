# 10 实测：Agent 怎样说出改了哪些文件

实测于 2026-11-28，Windows：Claude Code 2.1.332（haiku），codex-cli 0.172.0。抓取数据去掉了本机路径（工作区换成 `C:\sample`），放在：

- `internal/agent/claude/testdata/edit.jsonl`：一轮，Edit 改 a.txt、Write 新建 b.txt、Write 覆盖 d.txt。用 `claude -p --output-format stream-json --verbose --permission-mode acceptEdits` 跑。
- `internal/agent/codex/testdata/edit-0.172.0.jsonl`：一轮，一个 apply_patch 改 a.txt、新建 b.txt、删除 c.txt。探针 `10-probes/codex_edit`（Go，`approvalPolicy: never`）。

## Claude Code

每个调用的结果在 `user` 消息里。除了 `tool_result` 块，消息顶层还有一个 `tool_use_result`，就是 Claude Code 自己记的结果：

| 调用 | `tool_use_result` |
|---|---|
| Edit | `filePath`、`oldString`、`newString`、`originalFile`、`structuredPatch`（带 3 行上下文的 hunk：`oldStart`、`oldLines`、`newStart`、`newLines`、`lines`），没有 `type` |
| Write 新建 | `type: "create"`、`content`、`structuredPatch: []`、`originalFile: null` |
| Write 覆盖 | `type: "update"`、`content`、`structuredPatch`（整个文件的 hunk）、`originalFile` |
| Read | `type: "text"`、`file{…}`，没有 `structuredPatch` |

- `lines` 每行带 `" "`、`"-"`、`"+"` 前缀，最后一行没有换行时跟着 `\ No newline at end of file`，可以直接拼成统一格式的 hunk。
- `tool_result` 的文字只有一句“has been updated successfully”或“File created successfully at”。
- 删除文件 Claude 没有专门的工具（走 Bash 的 `rm`），所以没有删除这一类。
- 这一轮没有用到 MultiEdit 和 NotebookEdit。按 `structuredPatch` 识别，它们有这个字段就能显示，没有就照旧。

## Codex

`item/started` 和 `item/completed` 的 `fileChange` 内容相同（只有 `status` 不同），`changes[]` 每项有：

- `path`：绝对路径；
- `kind`：对象，不是字符串。`{"type": "update", "move_path": null}`、`{"type": "add"}`、`{"type": "delete"}`；
- `diff`：
  - update 时是 hunk，从 `@@ -1,3 +1,3 @@` 起，带上下文，没有 `---`/`+++` 头；
  - add 时是新文件的全文；
  - delete 时是被删文件的全文。

`move_path` 不为空表示移动。这次没有抓到，按协议的字段处理，单元测试用的是手写数据。

## 对实现的意义

- 两家都给出了带上下文的补丁，不需要用参数的改前改后文字自己生成。Claude 失败的调用没有 `structuredPatch`，本来也没改成，不显示差异。
- 新建和删除时，把全文转成 `@@ -0,0 +1,N @@` 或 `@@ -1,N +0,0 @@` 的补丁，统一用 `editor.ParsePatch` 显示。
- Codex 一次补丁可能改多个文件，标签和组摘要要按文件数算，不能按调用数。

抓取数据里删掉了 `account/*` 通知（账户的套餐和额度），测试用不到。
