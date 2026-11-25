# OpenCode 1.19.6 在本机通过 ACP 能完成哪些会话操作

2026-11-25 在 macOS 上实测。可执行文件 `/opt/homebrew/bin/opencode`，版本 1.19.6，启动参数 `acp`，无其他参数。每个场景用新建的临时 Git 仓库作工作区，工作区内放 `opencode.json`，要求 bash 先审批：`{"permission": {"bash": {"*": "ask", "sleep *": "allow"}}}`。模型使用 OpenCode 的默认值 `opencode/big-pickle`（免费模型），全程未登录 OpenCode 账号。

协议客户端是本目录的 `acp-probe`（[acp.py](01-probes/acp.py)），不是 aibo 的适配器。跨 Agent 引用由 [refbench](01-probes/refbench/main.go) 提供：它用假 Agent 在临时数据目录上运行真实的 aibo 工作台，所以 MCP 服务、引用快照和会话令牌都是 aibo 的真实实现。aibo 端到端（Go ACP 客户端接入工作台）尚未实现，未测。所有记录里的令牌已替换为 `<tgt-token>`、`<other-token>`；本机 OpenCode 的命令列表和用户自配的模型提供方已脱敏。

## 结论

| 场景 | 结果 | 记录 |
| --- | --- | --- |
| 启动与对话 | 可用。握手声明 `loadSession`，`sessionCapabilities` 有 `resume`、`fork`、`list`、`close`，MCP 支持 HTTP 和 SSE。 | [handshake](01-probes/handshake.jsonl) · [turns](01-probes/turns.jsonl) |
| 审批与中断 | 可用。等待审批时和命令运行中都能中断，之后同一会话能接下一轮。运行中中断时，工具状态报 `completed`，不是 `failed`。 | [turns](01-probes/turns.jsonl) |
| 跨 Agent 引用 | 可用。OpenCode 通过 HTTP MCP 读到引用正文里的值；引用之后源会话追加的消息读不到。 | [refs-separate](01-probes/refs-separate.jsonl) |
| 两个同目录会话 | **共用进程时无法隔离。**同名服务会被后建会话的令牌覆盖；不同名的服务对进程里所有会话可见，未获授权的会话可以读到别人的引用。每会话独立进程时隔离成立。 | [refs-shared](01-probes/refs-shared.jsonl) · [refs-shared-named](01-probes/refs-shared-named.jsonl) · [refs-separate](01-probes/refs-separate.jsonl) |
| 重启续聊 | 可用。`session/resume` 不回放历史，上下文保留，本次传入的 MCP 参数生效。`session/load` 先回放全部历史，再返回响应。 | [restart](01-probes/restart.jsonl) |

## 握手与新建会话

`initialize` 返回 `protocolVersion: 1`、`agentInfo` 为 `OpenCode 1.19.6`，以及：

- `agentCapabilities.loadSession: true`；`sessionCapabilities` 为 `close`、`fork`、`list`、`resume`；
- `mcpCapabilities`：`http: true`、`sse: true`；
- `promptCapabilities`：`image: true`、`embeddedContext: true`；
- `authMethods` 只有一项 `opencode-login`，说明是“在终端运行 `opencode auth login`”。未登录时仍可使用免费模型，握手不要求认证。

`session/new` 的结果没有 `modes` 和 `models` 字段，改用 `configOptions` 给出两项：

- `model`（category `model`）：当前值 `opencode/big-pickle`，可选值包括 OpenCode 的免费模型和用户在配置里登记的提供方；
- `mode`（category `mode`）：`build`、`plan`。这是 OpenCode 的内置 Agent 角色，不是权限模式；权限由 `opencode.json` 的 `permission` 决定。

新建后会推送一次 `available_commands_update`，列出本机安装的命令。续接（resume、load）的结果同样带 `configOptions`。

## 对话、审批与中断

一个会话依次跑六轮（[turns.py](01-probes/turns.py)）。工具事件的顺序：

1. 允许（`allow_once`）：`tool_call(pending)` → `tool_call_update(in_progress)` → `session/request_permission` → `in_progress` → `completed` → `agent_message_chunk` → `usage_update` → 响应 `stopReason: end_turn`。工具结果的 `rawOutput.metadata.exit` 为 `0`。
2. 拒绝（`reject_once`）：工具 `failed`，文字为 “The user rejected permission to use this specific tool call.”；模型没有再回复，轮次以 `end_turn` 结束。
3. 等待审批时中断：发送 `session/cancel`，再以 `{"outcome": "cancelled"}` 回应审批请求。工具 `failed`，`rawOutput` 为 `{"error": "Tool execution aborted", "metadata": {"interrupted": true}}`，轮次以 `stopReason: cancelled` 结束。
4. 下一轮正常回复，原会话可用。
5. 命令运行中中断（`sleep 30 && echo done`，12 秒后取消）：工具状态为 **`completed`**，输出为 “(no output) … User aborted the command”，`metadata.exit` 为 `null`；轮次以 `cancelled` 结束。适配器不能把 `completed` 当作成功，要结合 `exit` 和轮次的 `stopReason` 判断。
6. 之后的一轮正常回复。

审批请求的选项为 `once`（`allow_once`）、`always`（`allow_always`）、`reject`（`reject_once`），`toolCall` 带 `kind: execute`、`rawInput.command`。没有 `reject_always`。另外，`"sleep *": "allow"` 没有匹配 `sleep 30 && echo done`，这条复合命令仍然要求审批。

## 跨 Agent 引用

refbench 的源会话有六条消息，暗号 AMBER-7319 只在第 3 条（不在概要里）；引用建立后，源会话又追加了含 LATE-4421 的消息。tgt 会话收到的是 aibo 原样生成的引用块（`<aibo-reference>` 概要），MCP 服务以 `aibo` 命名、带 tgt 的令牌（[refs.py](01-probes/refs.py)）。

独立进程时，OpenCode 调用 `aibo_read_reference`，读到 `#1–#6，共 6 条消息`，回答 AMBER-7319，没有出现 LATE-4421。OpenCode 把 MCP 工具命名为 `<服务名>_<工具名>`，调用时没有请求审批。other 会话持自己的令牌，`aibo_list_references` 返回“本会话还没有收到会话引用”，`aibo_read_reference` 报没有这条引用。

## 同目录两会话的隔离

三种做法，都是先为 tgt、再为 other 调用 `session/new`，然后先问 tgt、后问 other：

| 做法 | tgt 能否读自己的引用 | other 能否读 tgt 的引用 |
| --- | --- | --- |
| 共用进程，服务都叫 `aibo` | 不能：工作台按 other 的令牌回答 | 不能 |
| 共用进程，服务分别叫 `aibo-tgt`、`aibo-other` | 能 | **能**：other 列出了两组工具，调用 `aibo-tgt_read_reference` 读到 AMBER-7319 |
| 每会话一个进程，服务都叫 `aibo` | 能 | 不能 |

共用进程时，MCP 服务是进程级的：同名时后登记的配置替换前者，不同名时所有会话都能调用。这与上游文档“同一进程中其他同目录会话也可使用注入的 MCP 服务”一致。在 1.19.6 上，只有每个会话独立一个 `opencode acp` 进程，才能保证会话只读到授权给它的引用。

## 重启续聊

[restart.py](01-probes/restart.py) 用三个进程操作同一个原生会话：

1. 进程 1：`session/new`（tgt 的令牌），先让模型记住 ZEBRA-55，再读引用得到 AMBER-7319，然后关闭进程。
2. 进程 2：`session/resume`，故意传入 **other** 的令牌。响应前只推送了 `available_commands_update`，**没有回放历史**。模型答出 ZEBRA-55，说明上下文保留；读引用得到 NONE，说明本次传入的 MCP 参数替换了建会话时的参数。
3. 进程 3：`session/load`，传回 tgt 的令牌。响应之前回放了此前全部四轮（`user_message_chunk` 4 次、`agent_message_chunk` 4 次、`agent_thought_chunk` 5 次、`tool_call` 与 `tool_call_update` 各 2 次），之后读引用重新得到 AMBER-7319。

aibo 自己保存时间线，续接时应使用 `session/resume`，避免把回放的历史重复写入时间线；如果只能用 `session/load`，需要丢弃响应返回前的回放。

`session/list`（按 `cwd`）列出了该目录下的 8 个会话，包括本次会话，每项带 OpenCode 自动生成的标题和 `updatedAt`。返回的 `cwd` 是解析符号链接后的路径（传入 `/tmp/…`，返回 `/private/tmp/…`），按路径匹配工作区时要规范化。

## 未验证

- aibo 端到端：Go ACP 客户端尚未实现，本记录全部来自 `acp-probe`。
- Windows 上的行为、OpenCode 的其他版本，以及登录账号后使用付费模型的情况。
- `allow_always` 的持久化范围，`session/fork`、`session/close`，以及通过 `configOptions` 切换 `model` 或 `mode`。
- 进程意外退出时正在进行的轮次如何收尾。
- 每会话一个进程时的启动耗时和内存占用。
