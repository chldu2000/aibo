# 插件平台演进实施 Checklist

> 日期：2026-09-10 · 状态：待实施。
> 依据：[插件平台架构演进提案](./plugin-platform-evolution.md)。本文将提案转为执行清单，不替代现行契约或授权放宽架构检查。

原提案已给出职责、协议方向、分阶段路线与验收标准，因此采用 checklist，不再重复架构论证。所有复选框表示本次演进的待办；仓库已有基础不等于这些验收项已经通过。

## 执行约定

第二轮交互决定见[语义交互与状态规则](./plugin-platform-interaction-decisions.md)与 [ADR-0006](./adr/0006-presentation-state-and-result-ownership.md)。其中验收场景分别纳入 P1、P2、P4，不能因设计已确认而提前勾选实现项。

2026-09-10 已确认 **P3 为首次平台交付门**：能力包与声明式贡献可安装，并通过该阶段全部退出条件。P1 是验证切片，P4 验收完整可信 Presentation Plugin 边界；第三方可执行 UI 独立安装不属于首版承诺。选择 P3 是因为它能验证真实安装、调用与贡献呈现，又不必等待完整表现插件与写入能力。决定已确认不等于实现已完成，下列复选框继续保持待办。

执行同时遵循 [ADR-0002：契约治理](./adr/0002-capability-and-semantic-contract-governance.md)、[ADR-0003：动作责任](./adr/0003-semantic-action-responsibilities.md)、[ADR-0004：实例隔离](./adr/0004-workspace-capability-runtime-isolation.md) 和 [ADR-0005：协议稳定性](./adr/0005-plugin-protocol-stability-and-compatibility.md)。

- 按 `P0 → P1 → P2 → P3 → P4 → P5` 推进；上一阶段退出条件通过后，再合并下一阶段的依赖实现。可提前准备协议草案和 fixture，但不能宣称功能已支持。
- 每批改动应可独立合并、保留可运行产品。优先就地提取模块与注入端口，不先大规模搬目录或拆包。
- 勾选时在对应条目附 PR/提交、测试或人工验收记录；无法验证的项保持未勾选并记录阻塞原因。
- 每批运行 `pnpm run verify`；涉及 Rust 宿主时额外运行 `cargo test --manifest-path src-tauri/Cargo.toml`。真实 Provider 和桌面交互验收另留记录，不能由 fixture 代替。
- UI 改动遵守 `AGENTS.md`：视觉组件经 `$lib/ui-kit`，app CSS 仅表达布局，业务模块不依赖 Svelte/UI/具体 API。新建 `workbench/` 同样纳入检查。
- 改变正式 UI 规则时，同批更新 ADR、UI contract、架构测试和 `docs/ui-architecture.md`；不得删除断言或将现有必需成员改为可选来绕过检查。

## P0：边界确认与回归基线

**交付物：** 调用链与能力等价矩阵、页面职责清单、协议边界决策及验证记录。

- [ ] 盘点 `api.ts`、`agent-kind.ts`、`plugin_host.rs` 与 Codex/Pi 插件的创建、调用、取消、审批和恢复链；标记统一入口、专属入口、实际调用者与兼容模块退出条件。
- [ ] 建立 Echo/Codex/Pi 等价矩阵：创建、流式、取消、审批、模型选择、树/队列、归档、重启恢复；区分支持、不适用、缺陷、未验证，并为支持项记录自动和真实运行证据。
- [ ] 记录现有 session binding、AgentEvent v1/v2、PluginView v1 和恢复数据样本，作为后续迁移回归 fixture。
- [ ] 分类 `App.svelte` 与 app 组件中的业务语义、布局、视觉、交互，以及插件列表、选择、草稿、时间线的当前状态所有者。
- [ ] 定义 Capability SDK/Presentation Model 禁止项：框架组件类型、DOM/CSS 类型、函数回调、任意脚本/表达式，以及具体 API 实现依赖；明确检查覆盖传递导出。
- [ ] 记录 PluginView v1 与新语义协议并存决策：独立版本化、不重解释旧 row/grid、v1 wire protocol 不变。
- [ ] 明确第一批只做 Git 只读语义切片，复用现有受控 Git API；记录协议大小、分页、错误与交互规则中需要在 P1 冻结的选择。
- [ ] 运行基线验证，记录已有失败及复现方式，避免将旧缺陷误认为迁移成果或新回归。

**退出条件：** 现状与目标可逐项对照；兼容范围、禁止依赖和首个切片边界明确，基线失败均有归因。

## P1：Git 只读语义 UI 垂直切片

**前置：** P0 基线完成。**交付物：** collection/detail 合同与 fixture、Git 语义投影、Svelte adapter、第二个最小 renderer、交互验收记录。

### P1.1 合同与 fixture

- [ ] 新建版本化语义视图 schema，先实现 `collection`、`detail`；定义字段类型、枚举、稳定 item key、必需信息、选择、校验与 action 输入输出。
- [ ] 将 P1 新语义合同标记为实验性；区分本地交互、宿主导航和能力调用，明确 `open-diff` 的语义目标，不编码面板位置。
- [ ] 冻结消息与请求关联、revision 失效粒度；测试 A/B 逆序响应、取消失败和工作区切换，确保只读结果仅更新当前有效上下文，旧动作不静默换目标。
- [ ] 定义 `workspace.tool` 的上下文、排序意图、适用条件、空态、卸载及无常驻位置时的通用访问入口；不暴露 sidebar 等物理位置为公共依赖。
- [ ] 定义 Git status → 文件选择 → open-diff → detail 的数据关系与受控 operation 映射；renderer 不可传任意 IPC method。
- [ ] 冻结数据量/资源限额、分页，以及 loading/empty/error/selection/validation 标准结构；为非法数据和超限数据建立拒绝样本。
- [ ] 提供同一组正常、空、失败、分页和过期 action fixture；禁止 DOM、CSS、px、class、row/grid 布局、脚本与任意表达式。
- [ ] 将 Tab/Enter/Space、焦点语义目标、disabled/loading、错误关联、可访问名称和 reduced-motion 写成可验证的交互合同。
- [ ] 按表格/列表等控件标准模式定义选择、激活、返回和重试行为，统一业务含义而非强制相同按键路径；验证分页和部分 diff 的可见状态，依据样本冻结限额。

### P1.2 只读投影与 Svelte 接入

- [ ] 提取仅依赖窄数据端口的 Git 语义投影，通过组合根注入现有受控 Git API；查询不要求 Agent session。
- [ ] 在宿主 action 边界重新验证 workspace 上下文、revision、generation 与权限；UI 校验不能代替宿主校验。
- [ ] 建立纯数据依赖/类型检查，禁止从 `ui-kit/contract.ts` 等传递泄漏 Svelte `Component`。
- [ ] 实现 `SveltePresentationAdapter`，内部通过 `$lib/ui-kit` 渲染；新建装配目录时同步扩展架构检查范围。
- [ ] 实现侧栏列表与中央集合页两种布局；新增复合控件按现行 `UiKitAdapter` 规则在两套皮肤中完整实现。
- [ ] 两种布局使用同一贡献与动作合同，验证加载、空态、错误、文件选择和 diff 查看。

### P1.3 框架边界与验收

- [ ] 提供第二个最小 renderer（例如无框架 DOM 实现）消费相同 fixture，输出相同 action ID、上下文与 payload；DOM 只存在于本地 renderer 层。
- [ ] 完成「侧栏/中央 × shadcn/Material 3」四种组合的数据、动作、状态、键盘和截图验收，核对宿主 chrome 与可访问性。
- [ ] 验证贡献缺少常驻布局位置时仍可访问，提供者不可用时给出可解释状态。
- [ ] 记录 P1 的能力边界：主 UI 仍随应用构建，第二 renderer 是合同验证样例，Git 尚未迁为进程外能力包。

**退出条件：** 同一无框架/布局字段的语义 fixture 在四种组合中保留相同业务信息与动作，第二 renderer 合同测试通过，全部必需检查通过。

## P2：统一 Agent 路径与 UI 状态

**前置：** P1 证明语义边界。**交付物：** 统一 Agent facade、宿主 UI 状态模型、renderer 生命周期与恢复实现。

- [ ] 按 P0 清单逐项把业务调用迁入统一 facade，以明确 capability 与绑定选择操作；不凭 `queue.manage`、`session.tree` 或 Provider ID 推断 Pi API。
- [ ] 将必要的 Provider 专用装配/恢复留在显式兼容模块，登记退出条件；架构测试禁止通用路由及新工作台新增 Provider 分支。
- [ ] 增加「非 Pi Agent 也支持 queue/tree」回归样例，证明不会误路由。
- [ ] 合并插件列表、选择、草稿、时间线的重复状态，按 contribution 作用域保存 UI 状态；核心会话与历史仍由宿主持有。
- [ ] 按已确认的状态矩阵验证草稿跨重启保留、选择/详情在切换和工作区往返时保留、恢复目标失效时回到合理入口；确定窗口隔离、存储键、保存时机与保留期限。
- [ ] 定义可序列化 `PresentationSnapshot`、动作消息及受限 channel；Web mount/update/dispose 接口与能力 SDK 分离。
- [ ] 实现切换：保存草稿/选择/导航/焦点语义 ID → 预检 → 解除订阅并 dispose → mount → 恢复状态。
- [ ] 引入 presentation generation，拒绝旧 renderer 迟到消息和过期异步结果；测试订阅清理与重复挂载。
- [ ] 验证挂载失败恢复默认 renderer，流式 turn 持续、Agent 不重启、草稿不丢失，焦点按语义目标恢复。
- [ ] 复跑 P0 能力等价矩阵和旧历史/恢复样本；真实 Codex/Pi 验收覆盖本阶段改动链路。

**退出条件：** Agent 路径无能力误判，UI 状态有统一所有者；切换和失败恢复不破坏会话、turn、草稿及历史。

## P3：通用能力与贡献安装

**前置：** P2 统一入口和状态就绪。**交付物：** Manifest v2、v1 adapter、Broker、无 session runtime、Git 能力包及声明式贡献安装链。

### P3.1 Manifest 与兼容

- [ ] 定义 Manifest v2 的 `agent`、`capabilityProvider`、`semanticView` contributions 和 `presentation` 描述；纯声明式包无需 entrypoint，有运行逻辑的包必须声明入口。
- [ ] 分开宿主、runtime/view 协议、能力契约版本、本机可执行依赖和包依赖；不改变 v1 `dependencies` 含义。
- [ ] 定义字段限额、输入输出 schema、operation 映射、激活诊断；补齐正反 schema fixture。
- [ ] 落实插件命名空间能力契约与宿主治理的核心视图边界；P3 对外发布前冻结首个稳定语义版本，并确定兼容窗口与弃用通知策略。
- [ ] 通过 v1 adapter 将旧 agents 映射为内部 contribution；保持旧 wire protocol、session ID 和 binding，不兼容包在激活前拒绝。

### P3.2 Broker 与调用链

- [ ] 提取通用 Broker，支持 application/workspace/session scope；workspace 路径由宿主身份解析，turn 先作为调用上下文。
- [ ] 实现调用者身份、契约版本、manifest 声明、运行时协商、可用状态及输入输出验证；绑定 invocation ID、release、generation 和 deadline。
- [ ] 分离 capability 与 permission，落实审批、资源限额、并发、超时、取消、幂等规则及审计。
- [ ] 实现 provider 绑定：session 固定，workspace/application 显式配置；歧义返回 `provider_selection_required`，失效不静默转交写操作。
- [ ] 覆盖 `unsupported`、`incompatible_version`、`permission_denied`、`provider_unavailable`、`busy`、`cancelled`、`timeout`、`invalid_output`；写后断连表达结果未知，无幂等保证不得自动重试。
- [ ] 插件间调用仅走 Broker，传播原始调用者、资源范围、调用链和 deadline；权限取调用链约束交集，限制深度/并发并向子调用传播取消。
- [ ] 实现声明依赖解析和 release 固定，拒绝必需依赖环，可选依赖缺失仅禁用相关 contribution。

### P3.3 Runtime、贡献与 Git 迁移

- [ ] 复用 Registry/Runtime，分离安装与激活；无 session runtime 使用 instance ID/generation，按作用域懒启动。
- [ ] workspace 能力默认按工作区隔离实例和进程故障边界；确定实例复用键、上限及回收规则，测试一个工作区的取消/崩溃不会终止另一个工作区的调用。
- [ ] 登记 `workspace.tool`、`session.context`、`session.action`、`settings.page`、`command` 的完整扩展点合同；拒绝未知扩展点，诊断可选不兼容贡献。
- [ ] 补齐 `settings`、`inspector` 核心语义合同；统一有限可见性条件与有界数据更新，保留 PluginView v1 并行路径。
- [ ] 将 Git 只读实现迁入进程外能力包，宿主继续执行资源范围/权限检查；支持语义贡献随能力包或独立声明包安装。
- [ ] 实现升级保留活动 session/invocation/依赖的 release，禁用先停止新调用再有界排空/取消；无活动引用且符合恢复策略才回收旧包。
- [ ] 插件私有数据置于 release 包外的版本化命名空间；卸载保留核心历史，用户数据清理单独处理。
- [ ] 为能力事件建立独立版本合同；Git 查询不伪装为 AgentEvent，相关执行可用关联 ID 连接 turn。
- [ ] 测试伪造身份、过期 action/generation、跨插件越权、提供者冲突、取消、崩溃、升级及依赖缺失。

**退出条件：** 不启动 Agent、不加载 Git UI 也能调用 Git 能力；安装其语义贡献后现有 UI 自动呈现；权限、冲突、取消、升级测试及 v1 Echo/Codex/Pi 回归通过。

## P4：完整 UI 插件边界与写入能力

**前置：** P3 安装和 Broker 可用。**交付物：** 可信默认 Presentation Plugin、正式 Core/optional/fallback 契约、可信审批闭环、项目任务与 Git 写入切片。

- [ ] 提交正式 ADR，冻结 Core/optional/fallback、支持版本表与布局所有权；同步 UI contract、架构测试和 `ui-architecture.md` 后才引入 optional 成员。
- [ ] 将默认工作台装配为可信 Presentation Plugin，明确 Shell/renderer/skin 职责及构建期发布边界，允许重排整个工作台。
- [ ] 验证新增标准语义贡献无需逐一修改每套 UI；通用导航保证入口可达，缺提供者或不兼容有诊断。
- [ ] 实现专业呈现 → 当前 renderer 核心语义 fallback → 不可用说明的协商；必需语义缺失拒绝启用，可选增强缺失仅局部降级。
- [ ] 用实际专业呈现验证 fallback 保留必需数据、操作和选择规则，不嵌入其他皮肤组件；时间线与 Composer 暂保留可信专业实现。
- [ ] 补齐 view confirmation 非 `never` 的宿主确认闭环，测试取消、拒绝、失效及确认后再验证；显示按钮不代表审批完成。
- [ ] 确保插件管理、授权、历史、停用故障插件和默认工作台恢复入口独立可用，UI 不能遮蔽或伪造可信审批。
- [ ] 先从 `lib.rs` 提取可测试的项目任务/Git 领域服务，再接受控执行；宿主保留批准、取消、日志、artifact、工作区限制和输出限制。
- [ ] 接入项目任务和 Git 写入，覆盖重复提交、作用域写冲突、取消、超时结果未知与禁止盲目重试；通用宿主路由不新增 Provider 分支。
- [ ] 验证写入执行状态独立于页面生命周期；离开页面不丢弃结果，基于失效上下文的写入重新验证条件与权限，必要时重新确认。
- [ ] 完成整体布局切换、全部核心语义视图、键盘、焦点、屏幕阅读器标签、reduced-motion 与两套皮肤验收。

**退出条件：** 整个 UI 可替换布局且恢复入口始终可达；optional 缺失有合规降级；项目任务/Git 写入经过可信审批与副作用验收。

## P5：SDK、发布与受限扩展

**前置：** P4 合同经真实功能验证。**交付物：** 稳定 SDK、仓库外样例、发布兼容/回滚矩阵；有实际需求时另立 Custom Surface ADR。

- [ ] 提取能力 SDK 和纯数据 presentation 协议；renderer 本地接口单独暴露，不从能力 SDK 重导出 DOM/框架类型。
- [ ] 用仓库外能力包验证构建、打包、安装、调用、语义贡献和卸载，无 Svelte/DOM/CSS 依赖；再决定独立包发布与目录统一。
- [ ] 建立宿主/manifest/runtime/view/capability/renderer 版本与支持平台矩阵，明确 UI 包的构建期可信或已批准的隔离加载机制。
- [ ] 验证新 release 激活失败、旧依赖保留、私有数据可并存版本或迁移前备份、失败不切换 binding；分别记录代码回滚和数据恢复路径。
- [ ] 验证核心数据库增量迁移、旧 AgentEvent/历史可读，不以删除旧列作为早期清理手段。
- [ ] 如有真实 Custom Surface 需求，先单独通过 ADR：隔离 WebView/origin 或受限 iframe、无直接 Tauri 权限的消息桥、CSP、导航/网络、弹窗、剪贴板、拖放、来源校验和限流。
- [ ] 如实施 Custom Surface，再验证主题信号、局部样式、键盘/焦点、无障碍替代视图、缺 surface 降级及崩溃恢复；不可仅以 Shadow DOM 或 token 声明作为安全/兼容证明。

**退出条件：** 仓库外能力包可通过稳定合同运行；版本、依赖、失败和回滚可诊断。Custom Surface 为条件项，无需求时注明暂缓，不阻塞基础 SDK 交付，也不宣称已支持任意第三方 UI。

## 首批建议合并顺序

| 批次 | 对应清单 | 可审查产物与合并门 |
| --- | --- | --- |
| 1 | P0 | 路由/恢复与等价矩阵、边界决策、现有验证结果；确认切片范围 |
| 2 | P1.1 | 新语义 schema、Git fixture、动作/交互合同、正反验证；不修改 v1 解释方式 |
| 3 | P1.2 前半 | Git 窄端口与纯数据投影、依赖检查；无 session 的只读查询及边界检查通过 |
| 4 | P1.2 后半 | Svelte adapter、两种布局、两套皮肤；四种组合数据与动作等价 |
| 5 | P1.3 | 第二 renderer、同 fixture/action 合同验证、桌面交互记录；P1 退出门通过 |

批次 5 完成后再开始 P2。每批检查失败须修复或明确记录阻塞，不通过削弱架构测试完成勾选。

## 暂不纳入实施承诺

仍待后续确定：P1 的消息字段/关联方式、revision 粒度、控件具体交互及数据限额；P2 的窗口隔离、状态存储键/保存时机/保留期限；P3 的命名空间校验与契约分发、新呈现类型协商、实例资源策略及稳定协议支持窗口/弃用通知；P4 的写入审批与结果未知完整流程。分别在相应阶段合同冻结前解决。状态归属与恢复原则、只读结果接纳方式已确认，不再列为未定方向。

插件市场、自动远程更新、运行中 Provider 热替换、任意第三方前端代码、完整服务容器、通用工作流语言，以及完整第二框架产品 UI。语义模型跨框架不等于本机执行、路径和认证已跨平台。
