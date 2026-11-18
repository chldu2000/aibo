# 调研：从 Go 结构化驱动 Claude Code 与 Codex CLI

任务：[01-agent-integration](../issues/01-agent-integration.md)
调研日期：2026-11-18（文档版本以当日官方页面为准）

## 结论

- **Claude Code**：用 `claude -p --input-format stream-json --output-format stream-json --verbose`，Go 直接起子进程收发 NDJSON。这是 Agent SDK 自己用的底层通道。官方 SDK 只出 Python/TS 两种，文档原话是其他语言"run the CLI as a subprocess"。
- **Codex CLI**：用 `codex app-server`（stdio JSONL，JSON-RPC 2.0 去掉 `jsonrpc` 字段）。官方定位就是"给富客户端做深度集成"，VS Code 扩展用的也是它；并且可以生成 JSON Schema，Go 端能据此生成类型。
- **不建议首版统一走 ACP**：两家的 ACP 适配器（`claude-agent-acp`、`codex-acp`）都是 Node/TS 写的第三方桥，底下还是上面这两个通道。走 ACP 等于多一层 Node 运行时、多一层翻译，还要跟着它的版本漂移；Go 的 ACP SDK 也只有社区版本（coder/acp-go-sdk 等），而且上游维护停滞。好处是可以只写一套协议代码。**折中做法**：工作台内部定义自己的 Agent 适配接口，事件模型参考 ACP 的 `session/update` 分类（message/thought/tool_call/tool_call_update/plan/permission），以后要接其他 ACP Agent 时再加一个 ACP 适配器。
- **授权红线（Claude）**：工作台不能自带 claude.ai 登录，也不能读取、转存用户的 OAuth token。可以做的是调用用户本机**未修改的** `claude` 二进制，由用户自己完成登录（订阅账号或 API key 都行）。Codex 方面，app-server 原生支持 ChatGPT 登录流程。

## 各通道对比

| 通道 | 事件 | 多轮/续接 | 按会话注入 MCP | Go 可行性 | 稳定性/条款 |
|---|---|---|---|---|---|
| Claude `-p` stream-json 双向 | system/init、assistant（text/thinking/tool_use）、user（tool_result）、`stream_event` 增量、result、`permission_denied` 等 | stdin 持续写入 user 消息即为多轮；`--resume <id>`、`--session-id <uuid>`、`--fork-session` | `--mcp-config <json>` + `--strict-mcp-config`；init 事件里有 `mcp_servers`/`mcp_server_errors` | 纯子进程 + NDJSON，**不需要 Node** | 公开 CLI flag；控制子协议（权限回调）属 SDK 内部协议，文档没有给出线格式 |
| Claude Agent SDK (TS/Python) | 同上，另有 `canUseTool` 回调 | 同上 | `mcpServers` 选项 | 要嵌 Node 或 Python 运行时，**不适合** | 官方，MIT（Python SDK） |
| `claude-agent-acp` (ACP) | ACP 标准事件；权限请求、diff、终端、子代理 | v2 实验面有 `session/resume`/`fork` | ACP `session/new` 传 mcpServers | 需要 Node，或用自带 claude 的独立二进制 | Apache-2.0，社区（Zed→ACP 组织）维护，v2 实验中 |
| Codex `app-server` | `item/started`/`item/completed`/`item/agentMessage/delta`、`turn/completed`；item 类型 `agentMessage`、`reasoning`、`commandExecution`、`fileChange`、`mcpToolCall`、`plan`、`webSearch` 等 | `thread/start`/`resume`/`fork`/`read`/`list`，`turn/start`/`steer`/`interrupt` | 见下方"待验证" | stdio JSONL，Rust 单二进制，**不需要 Node**；`generate-json-schema` 可以直接生成类型 | 官方，Apache-2.0；部分方法要带 `experimentalApi` 才能用；schema 随版本变 |
| Codex `exec --json` | `thread.started`、`turn.*`、`item.*`、`error`，item 类型同上 | 每轮一个进程，用 `codex exec resume <id>` 续接 | `-c` 配置覆盖 | 可行 | **没有交互式审批**（只能靠 sandbox 档位或 `--approve-for-me`），工作台做不了审批 UI，所以不推荐 |
| Codex SDK (TS) | 同 exec | Thread.run 多轮 | — | 需要 Node；底层就是起 CLI 走 JSONL | 官方建议拿它做 CI 自动化，不建议做富客户端 |
| `codex-acp` (ACP) | ACP 标准事件 + 权限 | `session/load` | 客户端可提供 MCP（stdio/HTTP/ACP） | 需要 Node（自带 `@openai/codex`） | Apache-2.0，ACP 组织维护；底层就是起 app-server 再做翻译 |

## 关键细节

### Claude Code（stream-json）

- 推荐的启动参数：`claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --mcp-config '<json>' --strict-mcp-config [--resume <id> | --session-id <uuid>]`。另外考虑加 `--bare`：它会跳过 hooks、CLAUDE.md 和用户的 MCP，可复现性更好。但 bare 模式**不读 OAuth/钥匙串**，只能用 API key，对订阅用户不友好。所以默认不加 `--bare`，只靠 `--strict-mcp-config` 隔离 MCP。来源：[headless](https://code.claude.com/docs/en/headless)、[cli-reference](https://code.claude.com/docs/en/cli-reference)
- 子代理消息通过 `parent_tool_use_id` 归属；加 `--forward-subagent-text` 可以拿到子代理的 text/thinking。init 事件带 `capabilities` 数组，可用来做特性探测，不必比较版本号。来源：[headless](https://code.claude.com/docs/en/headless)
- **权限请求**有两条路：
  1. 公开方式：`--permission-prompt-tool mcp__<server>__<tool>`，让 Claude 把审批请求交给一个 MCP 工具。工作台本来就要跑自己的 MCP server（给会话引用用），可以顺带承载审批工具。这条路完全走公开接口。来源：[cli-reference](https://code.claude.com/docs/en/cli-reference)
  2. SDK 内部方式：在 stdin/stdout 上收发 `control_request`/`control_response`，subtype 有 `can_use_tool`、`interrupt`、`set_permission_mode`、`hook_callback`、`mcp_message`。官方 Python SDK 源码里有实现，可照抄，但没有正式规范。来源：[claude-agent-sdk-python query.py](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)、[subprocess_cli.py](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py)
- 中断：发 SIGINT 或 control `interrupt` 会正常结束当前 turn；发 SIGTERM 则该 turn 不会记录结果。来源：[headless](https://code.claude.com/docs/en/headless)
- `--permission-prompts none` 加上默认 Manual 模式（v2.1.302+）时，需要审批的调用会被直接拒绝。所以工作台必须提供审批宿主，否则工具调用会被拒或一直挂起。

### Codex（app-server）

- 握手：先发 `initialize`（带 `clientInfo`、`capabilities.experimentalApi`），再发 `initialized`。传输默认是 stdio JSONL；WebSocket 属于实验功能。来源：[app-server](https://learn.chatgpt.com/docs/app-server)
- 审批：服务端主动发 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`，客户端回 `accept`/`acceptForSession`/`decline`/`cancel`。另外还有 `item/permissions/requestApproval`、`mcpServer/elicitation/request`、`tool/requestUserInput`（实验）。来源同上。
- 认证：`account/login/start` 支持 `apiKey`、`chatgpt`（浏览器流程）、`chatgptDeviceCode`。来源同上。CLI 本身支持"Sign in with ChatGPT"。来源：[openai/codex](https://github.com/openai/codex)
- 类型：`codex app-server generate-json-schema --out ./schemas` 生成的 schema 和 Codex 版本绑定。Go 端可以在构建时生成类型，运行时再检查 Codex 版本。
- **待验证**：`thread/start` 能不能按线程注入 MCP server。官方页面只列了 `model`/`cwd`/`approvalPolicy`/`sandbox`。`codex-acp` 支持"客户端提供 MCP"，而它底下就是 app-server，说明协议里应该有配置覆盖字段（可能是 `config`）。用 `generate-json-schema` 确认一下就行。保底方案是每个会话起一个 app-server 进程，启动时用 `-c mcp_servers.aibo...` 覆盖配置。
- 不推荐 `exec --json`，因为它没有交互审批。来源：[non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode)

### ACP

- 协议本身是 JSON-RPC 2.0，Agent 作为子进程运行，方法有 `initialize`、`session/new`、`session/load`、`session/prompt`、`session/cancel`，通知走 `session/update`，权限走 `session/request_permission`。客户端还可以选择提供 fs 和 terminal 能力。来源：[ACP overview](https://agentclientprotocol.com/protocol/overview)
- 官方列出的适配器：Claude 用 [claude-agent-acp](https://github.com/zed-industries/claude-agent-acp)（基于 Agent SDK，Apache-2.0，独立构建版会把 `claude` 一起打包），Codex 用 [codex-acp](https://github.com/agentclientprotocol/codex-acp)（TS 写的，底层起 app-server）。来源：[ACP agents](https://agentclientprotocol.com/overview/agents)
- Go SDK：[coder/acp-go-sdk](https://github.com/coder/acp-go-sdk)（社区项目，有 fork 说上游自 2026-06 起无人维护）、[caelis-labs/acp-go-sdk](https://github.com/caelis-labs/acp-go-sdk)。ACP 组织本身没有官方 Go SDK。

## 授权与条款

- Anthropic："Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users… may not collect, store, or intermediate Claude.ai credentials"。同时又说，这"does not … prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription"。来源：[legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)、[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
  - 对 aibo 的含义：只调用用户自己安装的 `claude` 二进制。登录引导让用户去终端运行 `claude` 或 `/login`，工作台不做 OAuth 页面，也不碰 `~/.claude` 里的凭据。是否构成"third-party developer product"仍有灰色地带；作为个人使用的本地工具风险较低，如果分发，要按"运行未修改的 Claude Code"那条来做。
  - 品牌：不能把 Claude Code 名称或 logo 用作产品名，只能如实写"运行 Claude Code"。
- Codex 是 Apache-2.0 开源；app-server 官方提供 ChatGPT 登录，`codex-acp` 也提供。调研中没有找到类似 Anthropic 那样禁止第三方客户端的条款（只查了 Codex 文档和仓库，没逐条核对 OpenAI ToS）。

## 推荐落地形态

1. Go 内定义 `AgentAdapter` 接口，统一成工作台自己的事件流（消息增量、思考、工具调用开始/结束、权限请求/应答、turn 结束、错误）。
2. `ClaudeAdapter`：每个会话一个常驻 `claude -p` stream-json 进程。审批先实现 control 协议的 `can_use_tool`（体验最好）；如果担心它不稳定，就退回到 `--permission-prompt-tool` 加工作台 MCP。
3. `CodexAdapter`：一个 `codex app-server` 进程可以承载多个 thread，用 JSON Schema 生成 Go 类型。
4. 两边都要做版本探测：Claude 用 init 的 `capabilities`，Codex 用 `initialize` 返回值和 schema 版本。版本兼容和安装检测并入 map 的"待定"项。
