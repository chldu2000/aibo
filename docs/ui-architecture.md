# UI 架构与组件库扩展

公共语义与呈现数据定义由 `packages/plugin-protocol/src/` 持有，原
`src/lib/presentation/{contract,renderer-contract,presentation-contract}.ts`
为兼容导出入口。纯数据架构检查沿重导出递归进入协议包，并禁止协议包反向依赖
宿主、平台或框架；独立编译仅使用 ES2022 类型库。可执行 renderer 本地接口仍在
`packages/web-presentation/index.d.ts`，`src/lib/workbench/types.ts` 和
`src/lib/ui-kit/presentation-props.ts` 仅重导出类型，不属于公共数据包。
该本地接口允许 DOM 和函数回调，消费者必须显式引入 DOM 类型库；独立打包测试
验证能力消费者仍可不带 DOM 编译。UiKitAdapter 的必需视觉成员不变。
插件本地 Node 执行 helper 位于 `packages/capability-runtime`，其处理函数不属于
公共纯数据 SDK；协议包禁止反向重导出该 helper。

当前 UI 按四层组织：

1. `App.svelte` 负责状态装配、生命周期和页面组合；业务动作通过 `src/lib/app/` 控制器完成。
2. `src/lib/components/app/` 负责工作区、时间线、Composer、Inspector 和设置等页面级展示，只通过 props 和回调与业务层通信。
3. `src/lib/ui-kit/` 是基础组件 adapter 门面。
4. `src/lib/components/ui/` 提供当前默认的 shadcn-svelte 风格实现。

应用的视觉 CSS 也属于 UI kit 边界：`src/lib/ui-kit/kits/base.css` 提供跨皮肤
共享的语义样式与动效，`material3.css` 和 `shadcn.css` 负责各自皮肤的覆盖；
`src/app.css` 只作为样式入口，不承载颜色、边框、圆角、阴影、字体或状态反馈。

页面组件不应直接导入 `src/lib/components/ui/`，统一从 `$lib/ui-kit` 引入基础组件。这样替换视觉实现时，不需要修改会话状态或 Agent API。

## 添加另一套 UI Kit

1. 在 `src/lib/ui-kit/kits/` 新增 adapter，并实现 `UiKitAdapter` 中的组件：`AlertDialog`、`Button`、`Badge`、`Card`、`Input`、`Textarea`、`Separator` 等。
2. 保持现有基础接口：`variant`、`size`、`class`、`children`、原生 HTML 属性，以及 `data-slot` 标识；按钮变体包含 `toolbar`、`queue`、`abort`、`send` 等语义意图，由 adapter 决定形状、颜色和状态层；语义图标通过 `Icon` 和 `UiIconName` 映射，不在页面组件中直接绑定具体图标库。
3. 在 `src/lib/ui-kit/registry.ts` 注册 adapter，同时提供皮肤名称、默认主题和可选主题色。每个主题通过 CSS token 映射 Aibo 的语义颜色，不应在页面组件里写皮肤专属色值。
4. 用户可在「设置 → 外观」中运行时切换皮肤和主题色。选择写入 `localStorage`，重启后恢复；`VITE_AIBO_UI_KIT=<name>` 仅作为没有本地选择时的开发默认值。

`UiKitRegistration` 是皮肤入口，包含 `adapter`、`defaultThemeId` 和 `themes`。
`UiThemeRegistration` 可注册名称、预览色块和任意 `--*` token。注册表导出的
runtime proxy 会订阅当前 adapter，因此切换皮肤时页面已使用的 `Button`、`Card`、
`Icon` 等基础组件会一起替换，不要求刷新窗口，也不会触碰会话状态。
主题还需声明 `colorScheme`，使原生表单控件和滚动区域与亮色或深色外观一致。
当前 shadcn-svelte 提供 Zinc、Blue、Emerald 和 Light，Material 3 提供 Ocean、
Sage、Violet 和 Daylight。

皮肤的 token 也遵循各自的语义角色，而不是让页面组件依赖具体色值。shadcn
皮肤注册 `background`、`foreground`、`card`、`popover`、`primary`、
`secondary`、`muted`、`accent`、`destructive`、`border`、`input` 和 `ring`
等角色；组件只引用这些角色来表达层级、交互和焦点状态。Material 3 皮肤
注册 `primary/on-primary`、`surface`、`surface-container`、`on-surface`、
`outline`、`error`、`scrim` 等角色，并通过 shape、elevation 和 easing token
保持状态层与形状的一致性。新增控件应优先复用对应角色，不能把某个主题的
十六进制颜色或阴影复制进组件。

参考规范：

- [shadcn-svelte Theming](https://svelte-4.shadcn-svelte.com/docs/theming)
- [Material 3 theming](https://developer.android.com/develop/ui/compose/designsystems/material3)
- [Material 3 interaction states](https://m3.material.io/foundations/interaction/states/overview)

当前的第一个外挂样式示例是 `material3`：它使用
[`m3-svelte`](https://github.com/KTibow/m3-svelte) 的 Material 3 交互按钮，
并用兼容包装补齐 Aibo 所需的卡片与其他基础原语。卡片保持 Aibo 自己的
语义元素和零布局副作用，避免第三方组件的 padding、flex 方向或交互 DOM
改变三栏布局。可以直接在「设置 → 外观」中切换，也可以在没有已保存外观设置时指定开发默认值：

```bash
VITE_AIBO_UI_KIT=material3 pnpm run dev
```

Material 3 token 只作用于 `[data-ui-kit='material3']`，切换视觉实现不需要
修改页面组件或业务逻辑。该 adapter 目前标记为实验性，正式发布前仍需完成
视觉覆盖和依赖许可证审查；当前 `m3-svelte` 包采用 Apache-2.0 OR GPL-3.0-only
双许可证，发布前需要结合桌面发行策略确认选用的许可证。

Adapter 的组件需要同时满足两类约束：Aibo 页面类拥有尺寸、滚动、flex/grid
方向和内容密度的最终决定权；皮肤拥有颜色、形状、状态层、焦点反馈、字重与
图标语言。第三方组件若自带会改变页面结构的 padding 或 DOM 语义，应在
adapter 内归一化，不能把覆盖补丁散落到业务组件。

第三方组件库应作为 npm 依赖打包进 Tauri，不应在运行时从网络加载。组件库自带的全局 CSS 需要通过作用域或 CSS layer 接入，避免覆盖 Tauri 窗口和应用布局。

标题栏统一使用 Tauri drag region 处理窗口拖动。macOS 保留 Overlay 模式的原生
窗口装饰和红绿灯，页面不重复绘制最小化、最大化和关闭按钮；Windows 通过
`tauri.windows.conf.json` 单独关闭原生装饰，并继续使用 Aibo 自绘窗口按钮。
macOS 的拖动和双击缩放均交给原生标题栏处理，页面不能再显式切换窗口大小，避免
一次双击触发两次最大化/还原。Windows 的 drag region 和自绘按钮行为保持独立。

`test/architecture-boundaries.test.mjs` 会在 `pnpm test` 中检查：页面组件不得直接导入具体 UI 实现或 API，业务模块不得反向依赖 Svelte、UI 或 API 实现。新增模块若违反边界会在 CI 中失败。

## Agent Plugin View 边界

Phase 4.7 的插件不能导入 Svelte 组件或把 HTML、CSS、脚本注入主 WebView。插件提交符合 `contracts/plugin-view-protocol.v1.schema.json` 的完整声明式文档；Aibo Renderer 验证节点、binding、action、资源和 revision 后，只通过 `$lib/ui-kit` 渲染。

View v1 只允许语义属性，包括 tone、density、gap、对齐、内容、表单值、状态和 action ID。它不接受 `class`、`style`、颜色、皮肤 ID、任意组件名或具体 UI 库属性。功能图标使用语义名称并由当前 `UiKitAdapter` 映射；插件品牌资源必须来自安装时已校验哈希的 manifest resource。

Renderer 的交互状态以 `(sessionId, viewId, nodeId)` 为稳定键。文档 revision 更新以及 shadcn/Material 3 切换都应保留选中项、表单草稿和焦点恢复目标。若某套皮肤缺少新复合控件，应先扩展 `UiKitAdapter` 并为所有皮肤实现同一契约，不能在 Renderer 或页面组件中检测皮肤 ID。

## Agent 与 CI 硬约束

仓库根目录和各层目录的 `AGENTS.md` 提供给 Agent 的工作规则，但真正的
门禁由测试执行：

- `pnpm run check:architecture` 检查页面组件的 UI kit 导入边界、业务模块
  的框架依赖，以及应用层新增的皮肤视觉 CSS。
- `pnpm run check:types` 检查 `UiKitAdapter` 和各皮肤注册的 TypeScript 契约，
  防止新增复合控件只接入一套皮肤。
- `pnpm run build` 通过 Svelte/Vite 编译检查所有注册皮肤的实现，包括复合
  控件如 `ModelMatrix`。
- `pnpm run verify` 是 UI 改动的统一验收命令。CI 应以该命令作为合并门禁。
- `.github/workflows/verify.yml` 已将该门禁接入 push 和 pull request；PR 会把
  base commit 传给样式边界检查，只阻止新增违规，不会反复阻断历史基线。

历史遗留的 `src/app.css` 视觉声明已迁移到 `src/lib/ui-kit/kits/base.css`，
并由两套皮肤 CSS 按需覆盖。边界测试会阻止应用层继续新增视觉声明；新增的
共享表现规则应放入 `base.css`，只属于某个皮肤的规则放入对应的 skin 文件。

## 当前拆分边界

- `App.svelte` 保留 API 装配、Agent 事件入口、跨面板状态和页面生命周期；控制器通过依赖注入承载可测试的业务动作。
- `WorkspaceSidebar`、`TimelinePanel`、`Composer`、`Inspector`、`SettingsPanel`、`WindowTitlebar` 和 `AppOverlays` 只负责展示与用户事件转发。
- `view-models.ts` 负责领域对象到 UI 窄模型的纯函数投影；新增领域字段不会自动泄漏到页面组件。
- `AlertDialog` 也属于 kit adapter 的契约。当前 shadcn adapter 继续复用本地实现，外部 kit 可以提供自己的弹窗实现。
- `src/lib/app/selection-storage.ts` 封装会话选择的持久化与容错，页面只在生命周期边界调用它。
- `src/lib/app/agent-event-handler.ts` 和 `error-utils.ts` 不依赖 Svelte/UI，分别负责 Agent 事件投影与错误归一化。
- `src/lib/app/session-transitions.ts` 提供会话/工作区列表的纯状态转移原语，生命周期 controller 可直接复用。
- `src/lib/app/session-lifecycle-controller.ts` 通过注入 API、查询器和 setter 编排重命名、关闭、分支、归档和取消归档；它不持有 Svelte state，也不渲染 UI，测试时可直接替换 API 实现。
- `src/lib/app/agent-session-controller.ts` 通过相同方式编排 Codex/Pi 创建、列表 upsert、选中和上下文重置。
- `src/lib/app/workspace-controller.ts` 通过注入目录选择器与 API 编排工作区创建和信任切换；Tauri dialog 仅在 App 装配时注入。
- `workspace-controller.ts` 同时负责工作区删除后的选择、会话投影清理和刷新；页面只传入当前 workspace 与回调。
- `src/lib/app/refresh-controller.ts` 负责工作区/会话加载、generation 防竞态、选择恢复和跨面板刷新；列表查询 API 作为依赖注入。
- `src/lib/app/message-controller.ts` 负责发送、重试、停止与 Pi 排队消息；Composer 只绑定文本和回调，桌面 API 通过 adapter 注入。
- `src/lib/app/approval-controller.ts` 负责审批决策、待处理请求移除和反馈提示；审批卡片只负责展示可用决策。
- `src/lib/app/pi-tree-controller.ts` 负责 Pi 分支切换确认、时间线重载和编辑器文本恢复；Inspector 不直接调用 Pi API。
- `src/lib/app/session-context-controller.ts` 负责时间线、Codex 线程和 Pi 会话树读取，以及刷新状态提示；页面只消费已选上下文的投影。
- `src/lib/app/navigation-controller.ts` 负责工作区展开/切换、会话选择和创建入口状态；展开列表不会隐式改变当前会话。

### P4.7B PluginView renderer

`PluginView` is a required `UiKitAdapter` composite, exported through `$lib/ui-kit` with
`UiPluginViewDocument` and `UiPluginViewProps`. The application supplies a host-validated
v1 document, `sessionId`, `disabled`, and `onAction(actionId, input)`; actions return the
current form fields indexed by `fieldId`. Core must validate and authorize each action,
including its confirmation policy, before dispatch. The renderer performs no API calls.

The host may supply `interaction` and `onInteractionChange` to own form drafts and
expansion state keyed by session/view/node IDs across whole-workbench remounts and
application restarts. Without host state, the runtime proxy retains the existing
skin-switch preservation behavior. Both skins forward this same controlled-state contract. Child lists are keyed by stable node IDs.
Both registered skins implement the control and own shape and semantic color tokens;
shared skin markup only renders explicit supported semantics and never spreads plugin
properties into DOM attributes. JSON Pointer bindings only read own properties.
Unknown components show a host fallback. The minimum renderer displays Markdown as
escaped plain text and code/diff as scrollable source, without HTML, scripts, external
resources or arbitrary CSS. Rich Markdown, selection/focus restoration and full visual
acceptance remain P4.7D work.

The B transition exposes a titlebar plugin workbench alongside existing built-in sessions.
The App composition filters external session rows before passing data to legacy Codex/Pi
controllers; external rows keep their actual agent IDs in a separate presentation model.
Both surfaces read the same persisted sessions. The plugin workbench polls sessions,
timeline and validated views with cancellation of stale selection scopes. A view failure
does not prevent reading saved timeline history. Install, enable, create, send, cancel,
resume and close callbacks use the host's unified API. Generic view actions remain
explicitly unavailable until host capability/confirmation dispatch is wired.

## P1 语义工作区视图
+
+`src/lib/presentation/contract.ts` 是实验性纯 JSON 数据合同；`git.ts` 只把窄数据端口的结果投影为 collection/detail，不导入 Svelte、DOM、具体 API 或 kit。controller 的函数端口是本地宿主装配接口，不是公共 wire protocol。
+
+`src/lib/workbench/` 属于可信表现装配层：Svelte 组件只通过 `$lib/ui-kit` 使用视觉控件，CSS 仍仅表达布局，不调用具体 API、不按皮肤或 Provider ID 分支。`test/presentation-boundaries.test.mjs` 已纳入 `check:architecture`，同时检查数据模块传递依赖、公共类型无回调，以及移除 DOM lib 后的类型检查。
+
+`SemanticView` 是 `UiKitAdapter` 的新增必需成员，由 runtime proxy 转交当前皮肤；两套皮肤均实现，视觉/焦点/disabled 样式留在 kit 内部，未引入 optional 豁免。`PresentationProps` 中的 layout 和 onAction 是可信本地 renderer 参数，不属于能力数据合同。
+
+Svelte 与最小 DOM adapter 均提供 mount/update/dispose 并消费相同 fixture。默认产品入口使用可信 Svelte 工作区组件，adapter 验证入口位于 `probes/semantic-ui.html`；最小 DOM renderer 不作为产品工作台发布，也不加载第三方脚本。JSON schema 验证器在开发阶段生成，运行时不调用 eval/Function，保持现行桌面 CSP。
+
+具体协议和验收见 [P1 实施记录](./plugin-platform-p1-semantic-slice.md)。

## P2 宿主状态与整窗呈现生命周期

插件工作台复用主会话的列表、选择、草稿及时间线投影。窗口导航使用独立存储键；可恢复状态按工作区/contribution 分离，草稿与核心历史仍使用 Core session 存储。

`presentation/presentation-contract.ts` 只定义 JSON 快照与动作；`app/presentation-controller.ts` 通过注入的本地端口管理预检、generation、挂载、清理和失败恢复，不依赖 Svelte、DOM 或具体 API。`workbench/PresentationSurface.svelte` 将其接到本地 Svelte adapter，切换期间使用 inert 限制交互，视觉仍由 UiKitAdapter 提供。宿主装配组件本身不引入新皮肤。

`WorkbenchPresentation` 经 `$lib/ui-kit` 导出为可信宿主装配，复用生命周期控制器切换标准/专注会话布局，dispose 后真正重新挂载整个 App 可视子树。App 根状态、Agent 订阅与执行保持在子树之外；切换/默认恢复入口也在子树之外。`workbench-contract.ts` 是 JSON 上下文与动作，Svelte snippet 和本地函数端口不进入公共协议。此实现不加载第三方 UI 脚本，不代表 P4 Presentation Plugin 发布已完成。

App 中所有业务回调和可写绑定经 generation、当前工作区及会话检查；`test/p2-boundaries.test.mjs` 通过 Svelte AST 检查这些入口并禁止 Shell 导入 Agent 生命周期 API。切换期间 inert，挂载失败回到标准呈现，焦点使用语义 ID。App/Git 提交说明、分支名和插件表单由宿主持有，并在窗口命名空间持久化；会话 Composer 草稿继续使用 Core session 持久化。两套皮肤继续提供同一视觉合同，新增 CSS 仅控制布局。

验收包括两套皮肤的模型矩阵、两种 Git 布局、真实桌面流式切换/应用重启/窗口隔离，以及浏览器故障注入。详见 [P2 记录](./plugin-platform-p2-agent-state.md)。

## P3 安装目录与激活诊断

插件管理面板允许安装记录没有旧 `agents` 数组，显示宿主返回的激活诊断，并在不可运行时禁止启用；已启用插件始终保留禁用入口。现有 v1 新建会话和卸载入口保留。Registry 返回的统一 contributions 是数据目录，不由管理面板执行；声明式贡献自动挂载将在 Broker/扩展点合同就绪后接入。此批不修改 UiKitAdapter，也不添加皮肤分支或视觉样式。

P3 第二批增加宿主注入窗口身份的 capability IPC 与类型化 API，输入不接受 caller、permission 或 workspacePath。只读 capabilityProvider 可独立激活；App 不负责执行或管理进程，不因 capability 的名字选择 Provider。语义贡献自动呈现仍待后续实施，当前管理面板继续显示未支持贡献的激活原因。

第三批由宿主返回包依赖诊断及受影响 contribution ID，管理面板展示固定版本和不可用原因：必需依赖失效阻止启用，可选依赖失效只提示相关功能停用，保留其他功能的启用入口。安装卡片以插件显示名提供可访问标签；继续复用 UiKitAdapter，不新增皮肤样式或契约字段。

P3 第五批通过 `InstalledWorkbench` 和纯数据端口接入已安装语义贡献。App 从宿主目录生成工作区工具命令，按 installation/contribution 标识打开页面；不根据 Git 名称或皮肤选择渲染实现。快照仍经 PresentationSurface 和 UiKitAdapter 校验、挂载与切换，新增组件仅使用已有 Button/Card，CSS 只包含布局。目录变化关闭失效工具，卸载后不保留可执行动作；导航状态按窗口/工作区/贡献/release 隔离。既有 P1 固定只读命令退出主界面，参考端口与测试保留。


## P3 稳定语义贡献

安装贡献由宿主解析 application/workspace/session 上下文，并通过统一命令入口打开。页面只传语义 scope、数据和动作，不指定皮肤或固定物理面板。SemanticView 继续是 UiKitAdapter 必需成员；两套皮肤共同支持 collection/detail、只读 settings 和 inspector，未增加 optional 例外，也未放宽 app 层样式规则。

稳定合同为 contracts/semantic-view.v1.schema.json，原 experimental-v1 schema 独立保留；生成验证器同时读取两者，不能用新字段重新解释旧版本。settings.page 的 workspaceId 为 null，session.context/session.action 必须有 sessionId 和所属 workspaceId。宿主 lease 验证当前上下文、revision、窗口与启用状态后才调度只读能力。P4 再接入编辑、写入审批及任意呈现插件。

架构检查继续覆盖纯数据边界、双皮肤必需成员和 workbench 视觉边界；test/semantic-stable.test.mjs 验证稳定/旧版本读取、作用域伪造与通用 inspect 选择。双 renderer 与双皮肤证据见 [P3 收尾记录](./plugin-platform-p3-completion.md)。

## P4 呈现协商边界

[ADR-0007](./adr/0007-presentation-core-and-fallback.md)将必需核心语义与可选专业呈现分开。renderer-contract.ts 只包含纯数据描述；app/renderer-negotiation.ts 验证描述符并选择专业呈现或相同数据的核心视图。当前默认呈现通过可信构建模块登记，工作台和语义视图均在预检时验证合同；没有新增任意代码加载通道或 UiKitAdapter optional 成员。

workbench 的架构检查递归覆盖子目录，包括 plugins 中的可信呈现模块；新目录不能绕过皮肤隔离、纯布局 CSS 或 API 依赖限制。工作台已改为命名槽位装配；正式专业呈现和完整布局退出矩阵仍需后续验收。

### P4：宿主区域与呈现实例边界

`App.svelte` 直接持有窗口标题栏、插件管理、执行历史、会话历史、插件调用历史、设置和诊断；这些组件位于
`WorkbenchPresentation` 的命名槽位之外，不随 renderer generation 销毁。
插件管理打开时仅隐藏工作台内容，恢复控件仍可访问；关闭管理后显示同一工作台。
插件管理操作通过宿主上下文门检查工作区和会话，窗口控制不依赖呈现实例授权。
呈现内部的回调与可写绑定继续通过 generation gate。架构测试分别验证两种边界，
禁止将宿主组件重新放回可替换 snippet。执行历史控制器按独立选择的工作区读取
任务与工作区写入记录（含 Git 与整轮恢复），按时间/类型/ID 的稳定游标翻页；关闭只释放读取订阅，停止请求使用原工作区/run ID，工作区写入
仍由宿主核对调用窗口。历史游标中的 `git` 保留为旧写入来源键，不代表工作区必须使用 Git。会话历史使用只读 Core 消息分页接口，包含归档会话，选择不改变工作台会话；能力生命周期审计另有只读宿主入口，窗口身份由 Tauri 注入，不依赖 Provider 或作用域资源仍存活。任一来源读取失败时禁止向更早处推进游标，避免遗漏记录。
标题栏文字导航由皮肤按内容分配宽度，布局切换/恢复控件占独立普通布局行，
不以固定偏移覆盖窗口按钮。历史进入时聚焦标题，Escape 返回入口焦点。

待审批请求由宿主统一显示，包含所属会话、请求类型、命令与工作目录。时间线
不接收审批回调，也不渲染决定按钮；切换选中会话、打开管理区域或重新挂载呈现
不会销毁宿主审批区域。审批控制器在提交时重新读取待审批集合，核对请求身份、
turn、命令、目录与当前可选决定，并拦截同一请求的并发提交。原生宿主仍负责
最终审批有效性及执行权限校验。此处的宿主布局隔离适用于当前可信构建模块，
不宣称为不可信第三方 DOM 提供安全隔离。

PluginView 的宿主读取接口返回 `{ document, version: { generationId, revision } }`。
`document` 仍是原始 v1 插件文档；版本由宿主从同一数据库行生成。面板将该版本
随动作传回，动作 IPC 必须携带版本。旧 revision、旧 generation 在确认及执行前
被拒绝，不能以“读取当前版本后重试”替换用户所见的视图版本。兼容只读接口仍可
读取旧文档，但不能省略动作版本。确认后的上下文复核继续执行。

PluginView 的非 never 确认使用宿主原生对话框，并以 Tauri 注入的调用者窗口为
父窗口；插件不能指定其他窗口或提交已确认标志。macOS 原生取消/批准已通过
隔离进程的真实按钮自动化验收，结果见 P4 实施记录。

### P4：工作台槽位合同

`WorkbenchPresentation` 的 renderer 本地接口接收 `navigation`、`navigationResize`、必需的 `content`、`auxiliaryResize`、`auxiliary` 和 `overlays` snippets。这些 Svelte 类型只存在于可信 renderer 实现，纯数据 presentation/capability 协议不导出它们。App 提供数据绑定与经 guard 包装的操作，不再提供整个工作台 main 或决定区域顺序。

可信默认呈现模块拥有区域顺序：standard 装配可用区域，focus 仅装配 content，review 将辅助区域移到左侧、导航移到右侧；overlays 独立于列顺序。宿主传入宽度偏好和辅助区域开启状态，呈现模块根据实际存在的槽位计算列布局，不依赖业务组件类名选择器隐藏区域。所有槽位随呈现代际一起释放，宿主管理、审批与恢复控件继续位于外部。

架构测试枚举所有六个 App 槽位并检查回调和可写绑定的 generation guard，保留原有宿主区域检查。新增槽位必须同时更新接口和测试覆盖，不能通过恢复不透明 children 包装绕过边界。

### P4：专业文本阅读与核心回退

可信默认呈现登记 `dev.aibo.ui-default.numbered-detail@1.0.0`，适用于 detail。`presentation-adapters.ts` 将经过协商的数据描述映射到构建中登记的可执行适配器；没有实现、版本不兼容时选取核心适配器。安装包中的字符串不能提供可执行代码。

现有 UiKitAdapter.SemanticView 的本地 props 增加语义选项 `detailPresentation: plain | numbered`，两套皮肤均通过各自 SemanticView 包装呈现。专业视图继续显示全部属性、状态、截断提示和原动作；行号为辅助视觉，屏幕阅读器不会将行号混入文本。安装视图允许切换到通用阅读，不改变快照、输入和宿主权限。

专业视图最多生成 5,000 个文本行节点，首次挂载或更新超出限制时由呈现生命周期控制器回退到完整文本的核心视图，保留当前布局。限制只影响呈现方式，不截断底层内容。专业实现的限制与宿主快照大小限制分别验证。

槽位第二参数提供 `growthDirection: 1 | -1`，表示分隔条向右移动时目标区域宽度的增长方向。方向由呈现中的实际顺序计算，App 的列宽偏好更新不再假定导航固定在左侧。布局重新挂载时宿主清理旧拖动监听，旧指针移动不能继续修改新布局。standard/focus/review 都可作为窗口级持久布局，独立恢复入口始终返回 standard。

### P4：减少动态效果

`kits/motion.css` 属于 UI 层，统一处理 `prefers-reduced-motion: reduce`，包括皮肤控件、伪元素及 body 浮层。近零时长保留组件完成事件，取消延迟、无限循环及平滑滚动；各皮肤继续提供运行状态的静态反馈。App 和业务模块不根据动效偏好改变执行行为。浏览器探针同时验证普通模式存在动效及减少动态效果模式的实际计算样式，媒体参数本身不作为通过证据。

### P4：可用焦点恢复

工作台呈现同时保存焦点标识与“曾获得焦点”的状态。原目标不再可用时，恢复到可见、可交互控件；禁用、hidden/inert/aria-hidden、无布局区域的目标不能接收恢复焦点。聚焦后检查 activeElement，不能因为找到同名非交互容器就停止回退。工作台被宿主管理区域暂停时不抢焦点；这一规则不改变业务动作的代际和上下文校验。

### P4：快照读取能力必须显式声明

RendererDescriptor.semanticVersion 描述必需核心语义，snapshotSchemas 描述实际快照格式。未声明后者的旧 renderer 只能读取原只读格式；v1.1 写动作需要显式 opt-in。描述符验证拒绝未知、重复或缺少稳定 v1 的列表，协商在选择专业实现之前检查格式支持。默认可信呈现明确声明 experimental-v1/v1/v1.1；该声明不改变原生审批与 Capability 权限。版本支持表见 ADR-0007。
