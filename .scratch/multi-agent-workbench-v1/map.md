# 多 Agent 工作台 v1

Label: wayfinder:map

## Destination

一份可交给 `/to-spec` → `/to-tickets` 的 aibo v1 规格文档：Go + MyGO 实现的 macOS 工作台，接入 Claude Code 与 Codex CLI，用户可把某会话的一段内容以会话引用的形式交给另一个 Agent。

## Notes

- 已定：工作台本体用 Go，UI 采用 MyGO（https://github.com/egoist/mygo）原生 UI + glass 插件；首版只做 macOS（MyGO 本身支持跨平台）。
- 已定（图表外）：Agent = 外部 Agent 进程；以结构化方式接入，由工作台自绘会话；会话引用 = 句柄 + 引用概要，接收方通过工作台的 MCP server 按需读取；引用范围可为整个会话或一段连续消息；引用是创建时的快照；引用概要由规则生成；会话属于工作区，引用可跨工作区；v1 只引用工作台内发起的会话。
- 术语以 `GLOSSARY.md` 为准；grilling 类任务同时调用 grilling 与 domain-modeling skill。
- 调研成果写入本目录的 `research/`，由任务文件链接，随路线图一起提交（仓库暂无 remote，不另开 `research/*` 分支）。

## Decisions so far

<!-- 每个已关闭任务一行 -->

- [MyGO 原生 UI 能否渲染 Agent 会话](issues/02-mygo-rendering.md): 能；原生 `ui`（markdown Stream + List + DiffView）加着色器 glass，不做 WebView 混合；跨消息复制按整条消息从数据模型取。
- [Claude Code 与 Codex CLI 的结构化接入方式](issues/01-agent-integration.md): Claude 用常驻 `claude -p` stream-json，Codex 用 `codex app-server` JSON-RPC，都不需要 Node；自定义适配器接口（事件分类参照 ACP），v1 不走 ACP；只调用用户本机的 `claude`，不碰凭据。
- [如何给每个会话注入工作台自己的 MCP server](issues/03-mcp-injection.md): 工作台进程内的 streamable HTTP（127.0.0.1 随机端口），每个会话一个 bearer token；Claude 用 `--mcp-config` + `--strict-mcp-config`，Codex 用 `-c mcp_servers.aibo`（只能追加）；SDK 用官方 go-sdk。
- [规范会话模型](issues/04-canonical-session-model.md): 引用以“消息”为单位（用户消息/Agent 回复/工具调用/计划），按会话内递增序号编址；会话只追加；思考附属于回复、默认不读；子代理嵌套、审批作属性；一个工作台会话对应一个 Agent 原生会话。

## Not yet specified

- 跨工作区引用时文件路径的处理规则（接收方看不到源工作区文件时怎么办）。
- 导入工作台之外产生的原生会话（`~/.claude`、`~/.codex` 存储）——等接入方式调研后再判断是否值得做。
- Agent 工具调用 / 权限请求的审批 UI。
- Agent 的安装检测、版本兼容与登录状态处理。
- 引用概要的具体生成规则（包含哪些字段、摘录多少）。
- 应用重启后会话的恢复（是否续接 Agent 侧会话）。

## Out of scope

- Agent 之间的自动编排 / 互相对话：v1 只做人手动发起引用。
- 云同步与多设备。
- Windows / Linux 打包与适配。
- 实时引用（引用跟随源会话更新）。
- 由 LLM 生成引用概要（工作台不持有模型 API key）。
