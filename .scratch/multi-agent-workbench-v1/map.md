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
- [引用读取工具的接口](issues/05-read-session-tools.md): 四个只读、免审批的工具 `list_references` / `read_reference` / `read_message` / `search_reference`；只能读引用范围内的消息；返回给大模型读的文本并分页（约 8k token/页）；关键词或正则搜索，不做语义搜索。
- [会话持久化](issues/06-session-persistence.md): 一个全局 SQLite 库（纯 Go 驱动）加附件目录，默认放在 `~/Library/Application Support/aibo/`，可迁移到自定义位置；删除源会话后，指向它的引用失效；单实例运行；升级前先备份。
- [发起和呈现引用的交互](issues/07-reference-ux.md): 两条发起路径：在源会话里选中范围后点“发给…”，或在接收方输入 `@` 拉取；接收方用卡片显示引用，可以展开概要，读取记录可以跳回来源；原型在 `prototype/reference-ux` 分支。
- [验证 Codex app-server 按 thread 注入工具与审批行为](issues/08-codex-thread-tools.md): Codex 用一个 app-server 跑多个 thread，MCP 按 thread 注入；两家都能免审批；两家都不提供 Agent 生成的标题；两家都会发出压缩事件（Claude 带 token 数，Codex 只有时间戳）。
- [aibo 记录与 Agent 实际上下文不一致时的处理](issues/09-native-divergence.md): 压缩只在会话里留一个标记（不算消息），会话视图里显示为分隔线；引用和读取工具都基于完整记录；允许把会话引用给它自己，用来找回被压缩掉的内容；会话菜单里可以手动压缩；v1 不转发 Agent 自带的斜杠命令。
- [续接原生会话与续接失败时的兜底](issues/10-native-session-recovery.md): 发首条消息时才续接，闲置 30 分钟自动断开，每次续接都重新注入 MCP token；续接失败时提示用户，用户可以选择在同一个 aibo 会话里换一个新的原生会话（记一个上下文重置标记），并把之前的内容自引用过去；aibo 会话同一时刻只对应一个原生会话。
- [用 MyGO 验证会话视图的原生渲染](issues/11-mygo-native-spike.md): 真机验证通过（流式 Markdown、1 万条消息、着色器 glass、大输出都没有明显慢帧）；按整条消息多选时，不连续的选区需要先规整为连续范围；本机构建要用 `CGO_ENABLED=0`；验证程序在 `spike/mygo-session-view` 分支。
- [检测 Agent 的安装、版本与登录状态的方式](issues/14-agent-detection-research.md): 先查用户指定路径，再查固定位置，最后用 `$SHELL -lic` 找可执行文件；版本取自 `--version`；登录状态用 `claude auth status` 和 Codex 的 `account/read` 检测（Codex 每个 turn 前都要查）；Claude 只能引导用户去终端登录，Codex 可以在应用内用浏览器或设备码登录。
- [跨工作区引用中的文件路径](issues/12-cross-workspace-paths.md): 接收方可以读源工作区，但只读（Claude 用 `--add-dir`，Codex 本来就能读），授权在整个会话期间有效；路径不改写，读取时开头注明源工作区，并提示文件可能已经改动。
- [审批请求的通道与交互](issues/13-approval-flow.md): Claude 的审批走 control 协议，因为这样能拿到原生建议；会话可在三档审批之间切换；审批卡片挂在工具调用下面，选项以 Agent 原生的为准，“本会话内始终允许”由 aibo 补记，进程重启后仍然有效，永久选项要写明写入位置；没处理的审批会一直等着，后台会话会发系统通知提醒。
- [Agent 的发现、版本兼容与登录引导](issues/15-agent-discovery-login.md): 先查用户指定路径，再查固定位置，最后用登录 shell；最低版本取实测时的版本；未安装时只给链接，不代为安装；Claude 引导到终端登录，Codex 可以在应用内登录；Codex 的登录状态靠启动时检查、订阅 `account/updated` 和 401 时重查来维护，不做每轮检查。
- [引用概要的生成规则](issues/16-reference-brief-rules.md): 发送时每个引用渲染成一个 `<aibo-reference>` 块，放在用户正文前面；摘录取范围内第一条用户消息和最后一条 Agent 回复；工具名按接收方 Agent 的写法；是否读取由 Agent 自己判断；自引用用另一套措辞；概要在创建引用时固定，最长 1500 字；卡片展开后显示 Agent 实际收到的文本。
- [工作区与会话列表的管理（含配置项清单）](issues/17-workspace-session-management.md): 工作区以绝对路径识别，移除工作区时会话转为归档；侧栏按工作区分组、按活跃时间排序，并显示状态标记；会话可重命名、删除、归档和搜索；新建会话时选 Agent 和模型；设置分通用、Agent、高级三页。
- [工作台窗口布局](issues/18-window-layout.md): 三栏布局，左侧是浮动的 Liquid Glass 侧栏，右侧详情以 glass 面板浮出；设置是全局弹窗；输入框用图标按钮，上方有染色 glass 的状态徽标；文字和图标颜色一律取自主题；会话可以拆到独立窗口（低优先级）；原型保存在 `prototype/window-layout` 分支。

## Not yet specified

<!-- 已全部拆成任务 -->

## Out of scope

- Agent 之间的自动编排 / 互相对话：v1 只做人手动发起引用。
- 云同步与多设备。
- Windows / Linux 打包与适配。
- 实时引用（引用跟随源会话更新）。
- 由 LLM 生成引用概要（工作台不持有模型 API key）。
- 会话导出为 Markdown、一键备份与恢复：数据目录是普通文件夹，可以手动复制备份（见[会话持久化](issues/06-session-persistence.md)）。
- 分屏同时浏览两个会话，以及在两栏之间拖拽引用：留到以后支持分屏时再加（见[发起和呈现引用的交互](issues/07-reference-ux.md)）。
- 导入 aibo 之外产生的原生会话：与“v1 只引用 aibo 内发起的会话”“不读取 Agent 本地存储”两项决定冲突。
- 支持 Agent 自带的斜杠命令：v1 只做“不转发，并给出提示”（见[aibo 记录与 Agent 实际上下文不一致时的处理](issues/09-native-divergence.md)）。
- 会话进行中切换模型：两家 Agent 中途换模型的方式和审批行为都还没实测，v1 只支持在新建会话时选择模型（见[工作区与会话列表的管理（含配置项清单）](issues/17-workspace-session-management.md)）。
