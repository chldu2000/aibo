# ACP 进程和工作台会话如何绑定

Type: grilling
Label: wayfinder:grilling
Status: open
Blocked by: 01

## Question

结合 OpenCode 同目录双会话及重启实验，决定 Go 客户端何时启动和关闭 ACP 进程、能否跨会话复用连接，以及续接时如何重新注入 MCP。两个会话使用同一服务名但持有各自的令牌时，每个会话应只读到授权给它的引用。说明如何验证这个条件，同时处理进程意外退出、等待审批时中断和历史回放。
