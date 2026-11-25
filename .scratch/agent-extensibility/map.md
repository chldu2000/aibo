# 接入第三个及后续 Agent

Label: wayfinder:map

## Destination

形成可交付实现的本地 Agent 接入规格。以 OpenCode 为首个验证对象，确定用户如何通过配置接入 Agent、读取其他 Agent 的会话引用、回应审批、中断轮次并在重启后续聊。再用另一款 ACP Agent 检验这份规格能否复用。

## Notes

- aibo 本体无需 Node。用户安装的外部 Agent 可以使用自己的运行时和登录方式。保留 Claude Code、Codex 已有的原生接入路径。[本机 CLI 接入决策](../../docs/adr/0001-drive-the-agents-own-clis.md)
- 首选设计是在现有 Agent 接口后增加一个 Go ACP 客户端。工作台管理会话时间线和引用快照，Agent 管理原生会话和权限。注册配置、进程隔离粒度和最低能力要求仍待决定。[Agent 接口](../../internal/agent/agent.go) · [注册表](../../internal/agents/agents.go) · [引用快照](../../docs/adr/0002-references-are-snapshots.md) · [原生权限模式](../../docs/adr/0003-agents-own-permission-modes.md)
- OpenCode 的本地入口为 `opencode acp`。区分上游文档、具体安装版本的观测和实际通过的 aibo 契约测试。协议结论按仓库约定留存证据，术语沿用词汇表。讨论决策时使用 grilling 和 domain-modeling。[OpenCode ACP 文档](https://opencode.ai/docs/cli/acp/) · [工程约定](../../docs/agents/conventions.md) · [术语表](../../GLOSSARY.md)
- 可参照 [T3 Code 的接入调研](research/t3-code.md)。T3 把驱动类型和配置实例分开，本地 ACP 命令无需新增代码即可接入；厂商扩展放进专用驱动，通用路径只依赖 ACP。T3 接 OpenCode 用的是专用驱动和 OpenCode 的 HTTP 服务，没走 ACP，因此 `opencode acp` 这条路径没有旁证，要靠实测。T3 为隔离线程，要么每个线程起一个服务，要么每个线程注册不同的工具名；它的方案只能用来提出测试问题，aibo 的进程粒度以实测为准。

## Decisions so far

<!-- 决策票解决后，将票名、链接和结论概要记在这里。 -->

## Not yet specified

第二款 ACP Agent 的选择取决于 OpenCode 暴露了哪些差异。例如，需要观察只有历史回放式续接的实现，还是需要观察只能接收 stdio MCP 的实现？待首轮观测后选择能区分方案的样本。

## Out of scope

远程托管 Agent、由 aibo 安装运行时或托管模型凭据，以及多个 Agent 自动分工。在同一会话里切换到另一个 Agent 接着做，是独立的产品决定，不作为接入第三个 Agent 的前提；跨 Agent 传递上下文继续使用会话引用。[T3 Code 的同线程切换](research/t3-code.md#两种上下文传递)
