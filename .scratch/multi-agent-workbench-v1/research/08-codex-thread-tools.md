# 实测：Codex app-server 按 thread 注入工具、审批行为、标题与压缩事件

任务：[验证 Codex app-server 按 thread 注入工具与审批行为](../issues/08-codex-thread-tools.md)
实测日期：2026-11-20。环境：macOS，codex-cli 0.169.0，Claude Code 2.1.318（测试用 `--model haiku`）。
脚本在 [08-probes/](08-probes/)：`mcp_probe.py` 是一个会记录调用日志的 stdio MCP 测试服务器，`drive.py` 是 app-server 的 JSON-RPC 驱动；`s1.py`、`s2.py` 测 Codex，`cl.py` 测 Claude。

## (1) Codex：`thread/start.config.mcp_servers` 能否只对单个 thread 生效？可以

- 在同一个 app-server 进程里启动三个 thread：A 和 C 在 `config.mcp_servers.aibo` 里各自配置了带不同 `AIBO_TAG` 环境变量的 stdio server，B 没有配置。
- 用 `mcpServerStatus/list {threadId}` 查询：A 和 C 都能看到 `aibo/read_reference`，B 看不到。测试服务器的日志显示 A 和 C 各起了一个独立进程，环境变量也各自生效。
- 推论（未实测）：HTTP 传输下，`bearer_token_env_var` 读取的是 app-server 进程的环境变量，多个 thread 共用一个进程时就无法区分 token。所以应该改用按 thread 写入的 `http_headers = {Authorization = "Bearer …"}`。这个配置通过 stdin 上的 JSON-RPC 传给 app-server，不会出现在 argv 里。

## (2) Codex `dynamicTools`：可以使用，但不作为首选

- 在 `thread/start.dynamicTools` 里声明了一个 `read_reference` 函数。模型调用它时，app-server 向客户端发出 `item/tool/call` 请求，参数为 `{threadId, turnId, callId, tool, arguments}`。客户端回复 `{contentItems:[{type:"inputText",text}], success:true}` 后，模型拿到了返回内容。整个过程**没有触发审批**。会话记录里对应的条目类型是 `dynamicToolCall`。
- 局限：这是实验性接口，需要 `experimentalApi`；而且只有 Codex 支持，没法和 Claude 共用一套实现。

## (3) 免审批：两家都可以做到

- **Codex，MCP 默认配置**：调用 aibo 工具前，app-server 会发出 `mcpServer/elicitation/request`，`_meta.codex_approval_kind = "mcp_tool_call"`，`persist: ["session","always"]`，相当于一次审批。
- **Codex，在 server 配置里加上 `default_tools_approval_mode = "approve"`**：不再发出审批请求，工具直接被调用。`auto` 这个取值没有测试。
- **Claude，不加 `--allowedTools`**：在 `-p` 模式下工具被直接拒绝，会发出 `system/permission_denied` 事件，`result.permission_denials` 里也有记录，不会弹出询问。
- **Claude，加上 `--allowedTools 'mcp__aibo__*'`**：工具直接被调用。
- 附带发现：
  - Claude 把 MCP 工具当作延迟加载的工具，模型要先用 `ToolSearch` 找到 `mcp__aibo__read_reference` 才能调用。所以引用概要和工具描述里应该写明工具名。
  - Codex 调用 MCP 工具时，`_meta.x-codex-turn-metadata` 里带有 `thread_id` 和 `turn_id`，可以用于日志和排查，但不能当作认证依据。

## (4) Agent 自动生成的会话标题：两家都拿不到

- **Codex**：thread 对象有 `name` 字段，协议里也有 `thread/name/updated` 通知和 `thread/name/set` 方法。但我们创建的非临时 thread 跑完一个 turn 后，`name` 仍是 `null`，也没有收到 `thread/name/updated`。`thread/list` 里其他 thread 有名称，推测是别的客户端（比如 Codex 官方应用）生成后写入的，app-server 本身不会自动命名。`preview` 字段是第一条用户消息。
- **Claude**：stream-json 事件流里没有任何标题事件，headless 会话的本地记录里也没有标题条目。

## (5) 压缩上下文时的事件：两家都有

- **Claude**：先发 `system/status {status:"compacting"}`，然后是 `system/status {compact_result:"success"}`，接着发 `system/compact_boundary`，其中 `compact_metadata` 包括 `trigger`（实测为 `manual`；自动压缩推测为 `auto`，未实测）、`pre_tokens`、`post_tokens`、`cumulative_dropped_tokens`。压缩后会重新发一次 `system/init`。
- **Codex**：在 turn 内发出 `item/started` 和 `item/completed`，条目类型为 `contextCompaction`，只带 `id`、`startedAtMs` 和 `completedAtMs`，没有 token 数。token 变化要从 `thread/tokenUsage/updated` 里看。schema 里还有一个 `ContextCompactedNotification`，但这次没有收到。实测用的是手动触发（`thread/compact/start`），自动压缩推测走同一个条目类型。

## 测试留下的痕迹

- Codex：一个非临时 thread（cwd 为 `/tmp/aibo-08/ws`，preview 以 “Call the read_reference tool” 开头）留在了 `~/.codex` 的历史记录里。
- Claude：两个会话文件在 `~/.claude/projects/-private-tmp-aibo-08-ws/`。
