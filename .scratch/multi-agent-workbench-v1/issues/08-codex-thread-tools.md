# 验证 Codex app-server 按 thread 注入工具与审批行为

Type: task
Status: resolved

## Question

在本机实际运行 `codex app-server` 来确认：(1) `thread/start` 的 `config` 覆盖里设置的 `mcp_servers`，是否只对该 thread 生效；(2) 实验性的 `dynamicTools`（Codex 带上 `threadId` 回调客户端）能否替代 MCP 承载 `read_reference`；(3) aibo 的工具调用能否免审批，Codex 用 `default_tools_approval_mode`，Claude 用 `--allowedTools mcp__aibo__*`；(4) 两家是否把 Agent 自动生成的会话标题交给客户端（Claude stream-json 事件、Codex thread 的名称字段），以及在哪个事件里给出。(5) 两家在自动压缩上下文时是否发出事件（如 Claude stream-json 的压缩边界、Codex 的 context compaction），事件里包含哪些信息。记下结论与用到的 schema 片段，决定 Codex 是“一个 app-server 跑多个 thread”还是“每个会话一个进程”。

## Answer

实测完成，详见[实测记录](../research/08-codex-thread-tools.md)。

- **进程模型：Codex 用一个 app-server 承载多个 thread。** 在 `thread/start.config.mcp_servers` 里配置的 MCP server 只对该 thread 生效，每个 thread 各起各的 server。HTTP 传输下，token 不能通过 `bearer_token_env_var` 读环境变量，要改为按 thread 写入 `http_headers` 的 Authorization。
- **`dynamicTools` 可用**：回调里带有 `threadId`，也不需要审批。但它是实验性接口，而且只有 Codex 有，所以只作备用，统一用 MCP 承载读取工具。
- **免审批**：Codex 在 aibo server 的配置里写 `default_tools_approval_mode = "approve"`；Claude 加 `--allowedTools 'mcp__aibo__*'`。两者都实测有效。不做这些配置时，Codex 会发审批请求，Claude 在 `-p` 模式下会直接拒绝。另外，Claude 要先通过 ToolSearch 发现 aibo 工具，所以引用概要和工具描述里要写明工具名。
- **Agent 生成的标题：两家都拿不到。** Codex 的 thread `name` 不会被 app-server 自动填写，Claude 的事件流里也没有标题。因此“规范会话模型”里的标题规则实际上会退化为“手动修改的标题优先，否则用第一条用户消息的开头”。
- **压缩事件：两家都有。** Claude 的 `system/compact_boundary` 带有 `trigger`、`pre_tokens`、`post_tokens`；Codex 是一个 `contextCompaction` 条目，只有时间戳。这些信息够“aibo 记录与 Agent 实际上下文不一致时的处理”用来标出压缩边界。
