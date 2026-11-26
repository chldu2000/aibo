# ACP 进程和工作台会话如何绑定

Type: grilling
Label: wayfinder:grilling
Status: resolved
Blocked by: 01

## Question

结合 OpenCode 同目录双会话及重启实验，决定 Go 客户端何时启动和关闭 ACP 进程、能否跨会话复用连接，以及续接时如何重新注入 MCP。两个会话使用同一服务名但持有各自的令牌时，每个会话应只读到授权给它的引用。说明如何验证这个条件，同时处理进程意外退出、等待审批时中断和历史回放。

## Answer

每个活动原生会话使用独立的 ACP 进程。新建、恢复和加载均使用当前工作台签发的 MCP 参数。加载期间的历史由工作台数据库提供。等待审批时中断会取消原请求，进程异常退出会结束轮次。覆盖这些顺序的测试见 [OpenCode 契约](../../../internal/contract/opencode_test.go) 和 [回放型 ACP 程序](../../../internal/agents/config_test.go)。
