# 如何给每个会话注入工作台自己的 MCP server

Type: research
Status: resolved

## Question

工作台要向 Claude Code 与 Codex CLI 的会话提供自己的 MCP server（承载 `read_session` 等工具）。两者分别如何按会话（而非全局）注入 MCP 配置？传输层该用 stdio（工作台另起一个子进程 / 自身二进制子命令）还是 streamable HTTP（工作台进程内监听本地端口）？Go 有哪些成熟的 MCP server SDK？如何让工具调用识别出是哪个会话发起的？

Findings: ../research/03-mcp-injection.md

## Answer

两家都能按会话注入，不用改用户的全局配置：
- **Claude Code**：`--mcp-config '<JSON>'` 加 `--strict-mcp-config`；配置里必须显式写 `type: "http"`，`headers` 用 `${VAR}` 从环境变量取 token。
- **Codex**：`-c 'mcp_servers.aibo={url=..., bearer_token_env_var="AIBO_TOKEN"}'`（已在 codex 0.169.0 上实测生效）。`-c` 只能追加，用户自己的 MCP server 仍会加载，没有类似 strict 的模式。

传输层用**工作台进程内的 streamable HTTP**，监听 `127.0.0.1` 上的随机端口，并校验 `Origin`；每个会话分配一个随机 bearer token，映射到它的会话 ID。stdio 中继只作为不支持 http 的 ACP Agent 的备用方案，v1 不依赖 MCP-over-ACP 草案。SDK 用官方的 `modelcontextprotocol/go-sdk`：用 `NewStreamableHTTPHandler` 为每个会话返回绑定该会话的 server，`auth.RequireBearerToken` 负责校验 token。`read_session` 还要检查该引用确实是交给这个会话的。

仍待验证（见“验证 Codex app-server 按 thread 注入工具与审批行为”）：Codex app-server 能否按 thread 注入 MCP、实验性的 `dynamicTools`，以及两家对 aibo 工具的默认审批行为。

详见 [调研结果](../research/03-mcp-injection.md)。
