# 哪些能力决定新 Agent 在工作台中的可用操作

Type: grilling
Label: wayfinder:grilling
Status: resolved
Blocked by: 01

## Question

哪些能力是进入工作台的最低要求，哪些只影响某个操作？逐项考虑对话、审批与取消、HTTP MCP 引用读取、原生会话续接、权限模式、模型选择和额外可读目录。用 OpenCode 的实际握手与现有接口逐项比对，决定能力缺失时界面怎样呈现。特别核对 ACP 的 mode 在 OpenCode 中表示什么，以及读取会话引用与访问源工作区分别需要什么授权。

## Answer

工作台启动要求 ACP v1 和 HTTP MCP。续接按 `resume`、`loadSession` 的能力选择。图片和模型设置取决于对端声明。审批使用对端选项，OpenCode 角色不作为权限模式。工作台只交付引用快照，不授予源目录权限。[操作与能力表](../../../docs/acp-agents.md)
