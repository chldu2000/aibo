# Claude Code 与 Codex CLI 的结构化接入方式

Type: research
Status: resolved

## Question

从 Go 进程以结构化方式驱动 Claude Code 与 Codex CLI，有哪些可选通道（ACP / Agent Client Protocol 及其适配器、Claude Agent SDK、`claude -p --output-format stream-json`、Codex `exec --json` / app-server 协议等）？对每个通道：能否拿到消息、工具调用、工具结果、权限请求等事件；能否多轮交互与续接会话；能否按会话注入 MCP 配置；从 Go 调用是否可行（stdio JSON-RPC、是否需要 Node 运行时）；稳定性与授权条款。给出推荐通道。

Findings: ../research/01-agent-integration.md

## Answer

每家 Agent 走各自的原生结构化通道，都不需要 Node：
- **Claude Code**：每个会话运行一个常驻的 `claude -p --input-format stream-json --output-format stream-json --verbose` 进程，Go 读写 NDJSON。多轮对话通过继续写 stdin 实现，`--resume`/`--session-id`/`--fork-session` 负责续接，`--mcp-config` 加 `--strict-mcp-config` 按会话注入 MCP。权限请求优先走有文档的 `--permission-prompt-tool`（指向工作台的 MCP 工具）。
- **Codex CLI**：使用 `codex app-server`（stdio JSON-RPC），threads 支持 start/resume/fork，按 item 推送事件，审批请求由工作台回复；可以从生成的 JSON Schema 得到 Go 类型。不用 `exec --json`，因为它不支持交互式审批。待确认：`thread/start` 能否按 thread 注入 MCP，如果不行就每个会话起一个 app-server 并用 `-c` 覆盖配置。
- **v1 不把 ACP 当作统一通道**：两个 ACP 适配器都跑在 Node 上，而且就是包在上面两个通道外面，Go 的 ACP SDK 不够成熟。工作台自己定义适配器接口，事件分类参照 ACP。
- **条款约束**：工作台只调用用户已安装、未修改的 `claude`，不读取也不转交 `~/.claude` 中的凭据；默认不用 `--bare`。

详见 [调研结果](../research/01-agent-integration.md)。

## 后续修正

“审批请求的通道与交互”经过实测后决定：Claude 的审批改走 control 协议（`--permission-prompt-tool stdio` + `can_use_tool`），不再走 MCP 审批工具。原因是 MCP 审批工具收不到原生的权限建议 `permission_suggestions`。
