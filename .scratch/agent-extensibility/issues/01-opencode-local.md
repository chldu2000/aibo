# OpenCode 在本机能完成哪些会话操作

Type: task
Label: wayfinder:task
Status: resolved

## Question

用本地 OpenCode 和隔离的测试工作区，取得决定接入规格所需的协议记录。记录安装版本、实际可执行路径、启动参数、工作区、握手能力以及各场景的观测结果。建图时当前 PowerShell 的 PATH 未解析到 `opencode`；以下是待执行的验证。[OpenCode ACP 文档](https://opencode.ai/docs/cli/acp/)

| 场景 | 要观察什么 |
| --- | --- |
| 启动与对话 | 启动 `opencode acp`，完成握手和新建原生会话，记录回复、工具事件与轮次结束的顺序。 |
| 审批与中断 | 分轮触发审批，分别同意、拒绝和在等待期间中断。确认中断后原会话能接收下一轮。 |
| 跨 Agent 引用 | 从已有的 Claude Code 或 Codex 会话创建引用，让 OpenCode 调用工作台的 HTTP MCP 工具读取一个只在引用正文中出现的值。记录实际工具名和返回范围。引用送出后再给源会话追加一条消息，确认 OpenCode 只能读到快照范围内的内容，读不到新消息。 |
| 两个同目录会话 | 为两个会话分别注入同名的 aibo MCP 服务和不同的会话令牌。分别观察共用进程与独立进程时，每个会话能读到哪条引用；确认没被授予某条引用的会话读不到它。证据中隐去令牌。 |
| 重启续聊 | 结束并重启进程，以原工作区、原生会话 ID 和本次 MCP 参数续接；确认上一轮上下文可用、时间线无重复、引用仍可读。分别记录 resume 与 load 的回放行为。 |

上游文档说明同一进程中，其他同目录会话也可使用注入的 MCP 服务；这是两会话测试的依据。若先用小型协议客户端取证，注明客户端名称，将 aibo 端到端结果单独记录。

## Answer

OpenCode 1.19.6 通过 `opencode acp` 可以完成新建会话、对话、审批、中断、跨 Agent 读引用和重启续聊。引用的快照边界成立：引用之后源会话追加的消息读不到。共用一个进程时无法隔离会话：同名 MCP 服务会被后建会话的令牌覆盖，不同名的服务则对进程里所有会话可见，未获授权的会话也能读到别人的引用。每会话独立一个进程时隔离成立。`session/resume` 不回放历史，并采用本次传入的 MCP 参数；`session/load` 会先回放全部历史。运行中被中断的命令，工具状态报 `completed`，要结合 `exit: null` 和 `stopReason: cancelled` 判断。模式 `build`/`plan` 是 OpenCode 的 Agent 角色，不是权限模式。以上结果来自协议客户端 `acp-probe` 和真实的 aibo 工作台 MCP 服务，未经 aibo 端到端验证，也未在 Windows 上测试。

[OpenCode 1.19.6 本机 ACP 实测](../research/opencode-local.md)
