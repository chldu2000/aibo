# UI 架构与组件库扩展

当前 UI 按四层组织：

1. `App.svelte` 负责状态装配、生命周期和页面组合；业务动作通过 `src/lib/app/` 控制器完成。
2. `src/lib/components/app/` 负责工作区、时间线、Composer、Inspector 和设置等页面级展示，只通过 props 和回调与业务层通信。
3. `src/lib/ui-kit/` 是基础组件 adapter 门面。
4. `src/lib/components/ui/` 提供当前默认的 shadcn-svelte 风格实现。

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

`test/architecture-boundaries.test.mjs` 会在 `pnpm test` 中检查：页面组件不得直接导入具体 UI 实现或 API，业务模块不得反向依赖 Svelte、UI 或 API 实现。新增模块若违反边界会在 CI 中失败。

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
