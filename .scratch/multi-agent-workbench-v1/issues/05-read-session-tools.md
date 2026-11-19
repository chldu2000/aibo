# 引用读取工具的接口

Type: grilling
Status: resolved
Blocked by: 03, 04

## Question

工作台 MCP server 向接收方 Agent 暴露哪些工具（读取范围、分页、按消息取工具输出、搜索？）？输出格式是什么，如何控制 token 预算，越出引用范围的请求如何处理？

## Answer

工作台的 MCP server 向接收方 Agent 提供四个只读工具（原暂定名 `read_session` 不再使用，因为接收方读到的是引用范围内的快照，而不是整个会话）：

- `list_references()`：列出交给当前会话的引用，包括引用 ID、来源会话的标题与 Agent、引用范围、引用概要。
- `read_reference(ref_id, from_seq?, cursor?, include_thinking=false)`：按序分页读取引用范围内的消息。
- `read_message(ref_id, seq, include_thinking=false)`：读取单条消息的完整内容。
- `search_reference(query, ref_id?, regex=false, include_thinking=false, cursor?)`：在引用里查找内容。
  - 不传 `ref_id` 时搜索当前会话收到的全部引用。
  - 默认关键词匹配，不区分大小写，多个词需同时出现；`regex=true` 时改用正则。不做语义搜索。
  - 搜索范围包括消息正文、工具参数、完整的工具输出和附件文件名；思考内容只在 `include_thinking=true` 时才搜。
  - 每个命中项包含引用 ID、序号、角色和约 200 字的片段；每页最多 20 项，用 cursor 翻页。

规则：
- **读取边界**：只能读取引用范围内的消息，超出范围时报错，并在错误里写明有效范围。不是交给当前会话的引用 ID 一律拒绝。
- **输出格式**：给大模型读的文本，不返回 JSON。每条消息以 `### [序号] 角色 · 时间` 开头；工具调用写成工具名、参数摘要和结果；中断的消息标 `（已中断）`；附件写成 `[图片: 文件名]`。
- **分页**：`read_reference` 每页约 8k token，页内单条工具输出最多保留约 2k token，页尾说明剩余条数和 cursor；`read_message` 每页约 25k token。这几个数字以后可以做成设置项。
- **免审批**：四个工具在两家 Agent 里都默认免审批，实际是否生效由“验证 Codex app-server 按 thread 注入工具与审批行为”确认。
- **引用 ID**：全局唯一的短随机串，例如 `ref_7Kq2xP`，写在引用概要里。
- **多个引用**：一个会话可以先后收到多个引用，它们互相独立。
