# 验证 Codex app-server 按 thread 注入工具与审批行为

Type: task
Status: open

## Question

在本机实际运行 `codex app-server` 来确认：(1) `thread/start` 的 `config` 覆盖里设置的 `mcp_servers`，是否只对该 thread 生效；(2) 实验性的 `dynamicTools`（Codex 带上 `threadId` 回调客户端）能否替代 MCP 承载 `read_session`；(3) aibo 的工具调用能否免审批，Codex 用 `default_tools_approval_mode`，Claude 用 `--allowedTools mcp__aibo__*`。记下结论与用到的 schema 片段，决定 Codex 是“一个 app-server 跑多个 thread”还是“每个会话一个进程”。
