# 审批请求的通道与交互

Type: grilling
Status: open

## Question

Agent 请求执行命令、改文件、调用 MCP 工具时，aibo 怎样拿到审批请求，又怎样呈现给用户？
- Claude 走哪个通道：有文档的 `--permission-prompt-tool`（由 aibo 自己的 MCP 工具承接），还是 SDK 内部的 control 协议 `can_use_tool`？
- Codex 走 app-server 的 `item/commandExecution|fileChange|permissions/requestApproval`。
- 审批时要显示什么：命令、diff、工具参数？
- 提供哪些选项：批准、拒绝、本会话内始终允许？审批的初始模式和沙箱档位怎么定？
- 会话不在前台时，审批请求怎样提醒用户？

已有的约束：审批结果作为工具调用的属性记录；aibo 自己的读取工具免审批；退出时未处理的审批视为拒绝。
