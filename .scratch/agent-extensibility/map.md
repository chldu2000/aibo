# 接入第三个及后续 Agent

Label: wayfinder:map

## Destination

形成可交付实现的本地 Agent 接入规格。以 OpenCode 为首个验证对象，确定用户如何通过配置接入 Agent、读取其他 Agent 的会话引用、回应审批、中断轮次并在重启后续聊。再用另一款 ACP Agent 检验这份规格能否复用。

## Notes

- aibo 本体无需 Node。用户安装的外部 Agent 可以使用自己的运行时和登录方式。保留 Claude Code、Codex 已有的原生接入路径。[本机 CLI 接入决策](../../docs/adr/0001-drive-the-agents-own-clis.md)
- Go ACP 客户端现已接入工作台。每个会话独占进程，使用自己的 HTTP MCP 参数。内置 OpenCode 和通过 `agents.json` 登记的实例共用这一实现。[登记方式与兼容范围](../../docs/acp-agents.md) · [工作台契约](../../internal/contract/opencode_test.go)
- OpenCode 的本地入口为 `opencode acp`。区分上游文档、具体安装版本的观测和实际通过的 aibo 契约测试。协议结论按仓库约定留存证据，术语沿用词汇表。讨论决策时使用 grilling 和 domain-modeling。[OpenCode ACP 文档](https://opencode.ai/docs/cli/acp/) · [工程约定](../../docs/agents/conventions.md) · [术语表](../../GLOSSARY.md)
- 可参照 [T3 Code 的接入调研](research/t3-code.md)。T3 把驱动类型和配置实例分开，本地 ACP 命令无需新增代码即可接入；厂商扩展放进专用驱动，通用路径只依赖 ACP。T3 接 OpenCode 用的是专用驱动和 OpenCode 的 HTTP 服务，没走 ACP，因此 `opencode acp` 这条路径没有旁证，要靠实测。T3 为隔离线程，要么每个线程起一个服务，要么每个线程注册不同的工具名；它的方案只能用来提出测试问题，aibo 的进程粒度以实测为准。

- Windows 2.4.2 已复核独立进程、审批与中断、引用快照和重启续接，并记录了异常退出时的协议表现。[Windows 实测](research/opencode-windows.md)

## Decisions so far

- [OpenCode 在本机能完成哪些会话操作](issues/01-opencode-local.md) — 1.19.6 的会话操作都能完成，引用快照边界成立；共用进程无法隔离会话的 MCP，须每会话一个进程；续接用 `session/resume`，它不回放历史且采用新的 MCP 参数。

## Not yet specified

- [ACP Agent 的命令怎样接入](issues/06-acp-agent-commands.md)：协议上由 Agent 一侧适配器筛选命令（Zed 不做白名单），建议全部交给 Agent；另发现 `session/new` 应答之前到达的 `session/update` 会被丢掉。

只支持回放式续接的测试程序已覆盖配置登记、取消、退出和 `session/load`。另一款真实产品能否通过同一组模型与引用场景，仍需单独验收。[配置测试](../../internal/agents/config_test.go)

## Out of scope

远程托管 Agent、由 aibo 安装运行时或托管模型凭据，以及多个 Agent 自动分工。在同一会话里切换到另一个 Agent 接着做，是独立的产品决定，不作为接入第三个 Agent 的前提；跨 Agent 传递上下文继续使用会话引用。[T3 Code 的同线程切换](research/t3-code.md#两种上下文传递)
