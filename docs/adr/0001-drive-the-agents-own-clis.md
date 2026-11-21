# 0001：通过用户本机的 Agent 命令行接入，不用 SDK 或 API

**Status:** accepted

## Context

aibo 要同时承载 Claude Code 和 Codex。可选的接法有：直接调模型 API，嵌入 Agent SDK，或者驱动用户已经安装、已经登录的命令行。

## Decision

只驱动用户本机安装、未经修改的命令行：Claude Code 用常驻的 `claude -p`（stream-json 加 control 协议），Codex 用 `codex app-server`（JSON-RPC）。aibo 不读取、不转交它们的凭据，登录也交给它们自己完成。

## Consequences

- 用户沿用自己的订阅、配置、技能和权限规则，aibo 不必实现 Agent 本身。这样也符合 Claude Code 的条款：只调用未经修改的 `claude`。
- 代价是依赖没有公开文档的协议（Claude 的 control 协议、app-server），版本升级可能改变行为。因此每个协议结论都要有真实抓取的数据和契约测试，并且设了最低版本。
- 两家的能力不对称（例如 Claude 只在启动时接受 `--add-dir`），由适配器接口吸收（`DirsAtStart` 等）。
