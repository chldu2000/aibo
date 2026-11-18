# 调研：如何给每个会话注入工作台自己的 MCP server

对应任务：`../issues/03-mcp-injection.md`。调研日期 2026-11-18。本机版本：Claude Code 2.1.318、codex-cli 0.169.0。

## 结论（先看这里）

1. **两个 Agent 都能按会话注入 MCP 配置，不需要改用户的全局配置。**
   - Claude Code：启动参数用 `--mcp-config '<JSON 字符串或文件>'`。如果还想屏蔽用户自己配的 MCP server，再加 `--strict-mcp-config`。
   - Codex CLI：启动参数用 `-c 'mcp_servers.aibo={...}'`（值按 TOML 解析）。如果走 app-server，也可以在 `thread/start` 的 `config` 字段里给同样的覆盖项。
   - ACP：在 `session/new` / `session/load` 的 `mcpServers` 里传。
2. **传输层推荐 streamable HTTP**：工作台进程内监听 `127.0.0.1` 的随机端口，每个会话发一个随机 token。stdio 中继（工作台二进制的子命令，经 unix socket 转发回主进程）留作后备，只在 ACP Agent 不声明 `mcpCapabilities.http` 时使用。
3. **Go SDK 选官方的 `github.com/modelcontextprotocol/go-sdk`**（v1.8.0，已支持 2026-07-28 规范）。它自带 streamable HTTP handler、按请求选 Server 的 `getServer(*http.Request)` 回调，以及 bearer token 中间件，正好满足"按会话识别"。
4. **用"每会话一个 token"来识别会话**：工作台为每个会话生成一个 token，并记录 token 到会话的映射；HTTP 中间件校验 token 后取出会话，再为它返回一个只绑定该会话的 `*mcp.Server`。URL 路径里可以再带上会话 id，方便排查，但不能拿它当凭证。
5. **需要原型验证**：①Codex app-server 的 `thread/start.config` 能否按线程生效 `mcp_servers`；②Codex 无法像 `--strict-mcp-config` 那样只排除用户的 server；③两个 Agent 都需要把工具调用设为免审批。

## 1. Claude Code

| 能力 | 事实 | 来源 |
|---|---|---|
| 按进程注入 | `--mcp-config`：从 JSON 文件**或 JSON 字符串**加载 MCP server，多个用空格分隔；配合 `-p` 时，首轮会等 server 连上（最长 `MCP_TIMEOUT`，默认 30s） | [CLI reference](https://code.claude.com/docs/en/cli-reference)；本机 `claude --help` |
| 屏蔽用户配置 | `--strict-mcp-config`：跳过 `.mcp.json`、`~/.claude.json` 和插件里的 MCP server，只加载 `--mcp-config` 给的 | 同上 |
| JSON 格式 | `{"mcpServers":{"aibo":{"type":"http","url":"...","headers":{"Authorization":"Bearer ..."}}}}`；stdio 写成 `command/args/env`。**有 `url` 但没写 `type` 会被当成 stdio，属于配置错误**；`streamable-http` 是 `http` 的别名 | [MCP 文档](https://code.claude.com/docs/en/mcp) |
| 变量展开 | `command/args/env/url/headers` 支持 `${VAR}` 和 `${VAR:-default}`，所以 token 可以经环境变量传入，不必出现在 argv 里（argv 能被 `ps` 看到） | 同上 |
| 动态 header | `headersHelper`：连接时执行一个命令，命令输出 JSON 格式的 header | 同上 |
| SSE | 已废弃，改用 HTTP | 同上 |
| 权限 | MCP 工具默认要审批，可用 `allowedTools: ["mcp__aibo__*"]`（CLI 对应 `--allowedTools`）免审批。工具名格式为 `mcp__<server>__<tool>` | [Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp) |
| SDK 进程内 server | Agent SDK 支持 `createSdkMcpServer` 定义的进程内 server，通过 `initialize` 控制请求注册，MCP 消息走 SDK 与 CLI 之间的控制通道。理论上 Go 直接实现 stream-json 控制协议也能复用这条路，但这属于 SDK 内部协议，不建议依赖 | 同上 |

## 2. Codex CLI

| 能力 | 事实 | 来源 |
|---|---|---|
| 按进程注入 | `-c/--config key=value`：点路径覆盖 `~/.codex/config.toml`，值按 TOML 解析，解析失败就当作字面字符串；`codex`、`codex exec`、`codex app-server` 都支持 | 本机 `codex app-server --help`；[Codex CLI reference](https://developers.openai.com/codex/cli/reference) |
| 本机验证 | `codex -c 'mcp_servers.aibo={url="http://127.0.0.1:9/mcp", bearer_token_env_var="AIBO_TOKEN"}' -c 'mcp_servers.aibo2={command="/bin/echo",args=["x"],env={AIBO_SESSION="s1"}}' mcp list` 两个都生效（HTTP 那个显示 Auth=Bearer token）。**但用户已有的 server（如 svelte_mcp_server）仍然在**：`-c` 只能叠加，没有与 strict 对应的选项。要排除只能逐个 `-c mcp_servers.<id>.enabled=false`，或换一个 `CODEX_HOME`（这样也会换掉 auth 和历史，不推荐） | 本机实测 |
| 配置键 | `url`、`bearer_token_env_var`、`http_headers`、`env_http_headers`、`http_headers_helper`、`command/args/env/env_vars/cwd`、`startup_timeout_sec`（默认 10）、`tool_timeout_sec`（默认 60）、`required`、`enabled_tools`、`default_tools_approval_mode`（`auto` 等）、`tools.<tool>.approval_mode` | [Config reference](https://learn.chatgpt.com/docs/config-file/config-reference)（由 developers.openai.com/codex/config-reference 308 跳转） |
| app-server 按线程 | `ThreadStartParams` 有 `config: object`，是自由形式的覆盖项（v2 schema）。实验字段还有 `dynamicTools`：客户端声明 function 或 namespace 工具，模型调用时 Codex 会向客户端发 `DynamicToolCallParams{threadId, turnId, callId, tool, arguments}`，**自带 threadId，完全不需要 MCP**。`config` 里的 `mcp_servers` 能否按线程隔离，文档没写，**需要原型验证** | 本机 `codex app-server generate-json-schema [--experimental]`（v2/ThreadStartParams.json、DynamicToolCallParams.json）；[app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) 提到 MCP 连接可以绑定到 thread |
| token 传递 | 对 HTTP server，`bearer_token_env_var` 从 **Codex 进程的环境变量**读取。如果每个会话一个 Codex 进程，直接设 env 即可；如果一个 app-server 进程承载多个线程，则要改用 `http_headers={Authorization="Bearer …"}`，或给每个线程不同的 URL | 同上 |

## 3. ACP（如果经 ACP 适配器接入）

- `session/new`、`session/load` 的 `mcpServers` 支持三种条目：stdio（`name, command, args, env[]`）、http（`type:"http", name, url, headers[]`）、sse（已废弃）。**所有 Agent 都必须支持 stdio**；http 和 sse 是可选能力，看 `initialize` 返回的 `agentCapabilities.mcpCapabilities.http/sse`。来源：[ACP Session Setup](https://agentclientprotocol.com/protocol/session-setup)
- 草案 RFD **MCP-over-ACP**：条目写成 `type:"acp"`，MCP 请求直接复用现有的 ACP 连接，`mcp/message` 是它的封装，不需要额外进程或端口。claude-agent-acp 已经实现（PR #1645），做法是在 127.0.0.1 上为每个 acp server 起一个 HTTP 端点，再转发回 ACP。来源：[RFD](https://agentclientprotocol.com/rfds/mcp-over-acp)、[claude-agent-acp PR #1645](https://github.com/agentclientprotocol/claude-agent-acp/pull/1645)、[README](https://github.com/agentclientprotocol/claude-agent-acp)。目前仍是 unstable，v1 不宜依赖。
- codex-acp 的 README 列出支持 "Client MCP servers"，但没说明支持哪些传输。该仓库已归档，开发迁到 `agentclientprotocol/codex-acp`。来源：[zed-industries/codex-acp](https://github.com/zed-industries/codex-acp)

## 4. 传输层取舍

| | streamable HTTP（进程内） | stdio 中继（`aibo mcp-relay` 子命令） |
|---|---|---|
| 支持情况 | Claude Code 和 Codex 都原生支持；ACP 中是可选能力 | MCP 规范写的是客户端 SHOULD 支持；ACP 中 MUST 支持 |
| 进程 | 不需要额外进程，工具直接访问主进程的会话存储 | 每个会话由 Agent 拉起一个中继子进程，中继再经 unix socket（`0600`）连回主进程，等于要写一层转发 |
| 生命周期 | 主进程退出则端点消失，Agent 会报错，按 Claude 文档会重连 5 次 | 跟随 Agent 进程；主进程不在时中继需要报错退出 |
| 安全 | 按规范必须：校验 `Origin` 防 DNS rebinding，只绑定 127.0.0.1，并且做认证。同一台机器上的其他进程也能连这个端口，所以 token 不能省 | socket 的文件权限就是天然的认证，token 用 env 传给中继 |
| 打包 | 无额外要求 | 中继需要知道 app bundle 内可执行文件的绝对路径（ACP 要求 command 是绝对路径） |

来源：[MCP Transports 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)（Security Warning、stdio 小节）。

**建议**：默认用 HTTP。一个监听器服务所有会话，端口随机；每个会话生成一个 `crypto/rand` token，经 `Authorization: Bearer` 头传递（Claude 写在 `headers` 里并用 `${AIBO_MCP_TOKEN}` 展开，Codex 用 `bearer_token_env_var`）。stdio 中继只作为 ACP 无 http 能力时的后备。

## 5. Go MCP server SDK

| SDK | 状态 | 与本需求相关的 API |
|---|---|---|
| `github.com/modelcontextprotocol/go-sdk`（官方，与 Google 合作维护） | proxy.golang.org 上最新为 v1.8.0（2026-09-04）。支持 2026-07-28 及更早的规范版本 | `mcp.NewStreamableHTTPHandler(getServer func(*http.Request) *Server, *StreamableHTTPOptions)`，选项有 `Stateless`、`JSONResponse`；`mcp.AddTool[In,Out]` 根据结构体推导 schema；`&mcp.StdioTransport{}`；`auth.RequireBearerToken(verifier, opts) func(http.Handler) http.Handler`，`TokenVerifier func(ctx, token, *http.Request) (*TokenInfo, error)`，`TokenInfo{UserID, Extra, ...}`；工具 handler 可以通过 `req.Extra.TokenInfo` 和 `req.Extra.Header` 拿到 token 与 header |
| `github.com/mark3labs/mcp-go` | 最新为 v1.5.0（2026-10-30），约 9.2k star；实现 2025-11-25 规范；README 自述 "some advanced capabilities are still in progress" | 支持 stdio、SSE、streamable HTTP；`WithHTTPContextFunc` 可把 header 注入 ctx，还有 `WithStateLess` |

来源：[go-sdk](https://github.com/modelcontextprotocol/go-sdk)、[pkg.go.dev mcp](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk/mcp)、[pkg.go.dev auth](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk/auth)、源码 [mcp/shared.go `RequestExtra`](https://github.com/modelcontextprotocol/go-sdk/blob/v1.8.0/mcp/shared.go)、[mcp/streamable.go](https://github.com/modelcontextprotocol/go-sdk/blob/v1.8.0/mcp/streamable.go)；[mcp-go](https://github.com/mark3labs/mcp-go)、[server/streamable_http.go](https://github.com/mark3labs/mcp-go/blob/v1.5.0/server/streamable_http.go)；版本号查自 `https://proxy.golang.org/<module>/@latest`。

**建议选官方 go-sdk**。它是官方实现，跟进规范最快；`getServer(req)` 回调天然适合"每个会话一个 Server 实例"。

## 6. 工具调用如何识别会话或引用

推荐做法（HTTP）：

1. 工作台启动 Agent 会话 S 时，生成 `token_S`，在内存中记下 `token_S → S`。会话结束就作废。工作台重启后重新生成，因为端口也会变（这与"重启后会话恢复"一题相关）。
2. 注入配置：URL 为 `http://127.0.0.1:<port>/mcp/<S>`，并带上 `Authorization: Bearer ${AIBO_MCP_TOKEN}` 头；启动 Agent 进程时设置 env `AIBO_MCP_TOKEN=token_S`。
3. 服务端：先过 `auth.RequireBearerToken` 中间件，校验 token，并检查它与路径里的 S 一致；然后 `getServer(req)` 返回一个只绑定会话 S 的 `*mcp.Server`。
4. 工具参数：`read_session(ref_id, range?)`，其中 `ref_id` 是引用概要里给出的引用句柄。服务端还要校验这个引用确实是交给会话 S 的（或者至少 S 有权读它），防止 Agent 猜测其他引用 id。
5. 也可以用 Codex 的 `dynamicTools`（实验性），它会直接带上 `threadId`，但只适用于 Codex app-server，不能与 Claude 共用一套实现。

stdio 中继的做法相同：中继从 env 读 `AIBO_MCP_TOKEN`，连上 unix socket 后先发送 token，主进程据此确定会话。

## 待原型验证

- Codex app-server 的 `thread/start.config` 里写 `mcp_servers.aibo` 能否只对该线程生效；如果不行，每个会话单独起一个 Codex 进程，或者改用 `dynamicTools`。
- Claude Code 中 `--mcp-config` 的 JSON 字符串结合 `${VAR}` 展开、`--allowedTools mcp__aibo__*` 的实际效果。
- Codex 里 `default_tools_approval_mode="auto"` 是否会对 aibo 的工具免除审批弹窗。
