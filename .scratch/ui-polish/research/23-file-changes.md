# 23 实测：ACP Agent 怎样说出改了哪些文件

实测于 2026-11-28，Windows：OpenCode 2.4.2（用户自己配置的模型），Cursor CLI 2026.11.22（Auto）。探针 `23-probes/acp_edit`（Go）：用 aibo 的 `agents` 包找到可执行文件（Cursor 在 Windows 上是 `node.exe index.js`），审批一律选“允许一次”，收发的每一行都记下来。同一句提示：把 a.txt 里的 `two` 改成 `TWO`，再新建 b.txt，内容两行 `hello`、`world`。

抓取数据去掉了本机路径（工作区换成 `C:\sample`）：

- `internal/agent/acp/testdata/opencode-2.4.2-edit.jsonl`
- `internal/agent/acp/testdata/cursor-2026.11.22-edit.jsonl`

## OpenCode 2.4.2

- 两个调用都是 `kind: "edit"`，`title` 分别是 `edit` 和 `write`。`rawInput` 在 `in_progress` 的更新里才出现：edit 是 `{path, oldString, newString}`，write 是 `{path, content}`。这一轮没有请求审批，OpenCode 默认不问。
- edit 完成时的 `content` 有两项：
  - 一段文字“Edited a.txt (1 replacement)”；
  - `{"type": "diff", "path", "oldText", "newText"}`，`oldText` 和 `newText` 都是整个文件。
- edit 的 `rawOutput.metadata.files[]` 里还有 OpenCode 自己的补丁（`Index:` 加 `---`/`+++`），以及增删行数。这是 OpenCode 私有的字段，不在 ACP 里。
- write 完成时只有一段文字“Created file successfully: b.txt”，**没有 `diff`**。

## Cursor CLI 2026.11.22

- 两个调用都是 `kind: "edit"`，`title: "Edit File"`，`rawInput` 是空对象，`toolCallId` 里带一个换行。
- 修改：完成时 `content` 只有一项 `diff`，`oldText` 和 `newText` 都是整个文件。
- 新建：`diff` 的 `oldText` 是 `"-- /dev/null"`，`newText` 是 `"++ b/<绝对路径>\nhello\nworld"`。看样子是补丁头被截掉了第一个字符，再拼在文字前面。ACP 规定新建文件时 `oldText` 为空（null），Cursor 没有照做。

## 对实现的意义

- ACP 的 diff 只给全文，aibo 要自己算行级差异。实现在 `agent.PatchTexts`：
  - 先去掉相同的开头和结尾；
  - 中间部分不超过约 400 万格时用 LCS 求最少的增删，超过就整段删除再整段添加（仍然正确，只是不是最小差异）；
  - 再按 3 行上下文切成 hunk。
- 没有 `oldText` 的按新建处理，这是 ACP 的规定。Cursor 的 `"-- /dev/null"` 单独认出来，去掉 `newText` 的第一行。
- OpenCode 新建文件时没有 diff，aibo 不从 `rawInput` 里猜：适配器是通用的，不按工具名解析参数。这类调用照旧显示结果文字。
- OpenCode 的 `rawOutput.metadata.files[].patch` 也能用，但它是私有字段，有 `oldText` 就够了。
