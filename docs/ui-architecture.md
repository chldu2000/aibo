# UI 架构与组件库扩展

当前 UI 按四层组织：

1. `App.svelte` 负责状态装配、生命周期和页面组合；业务动作通过 `src/lib/app/` 控制器完成。
2. `src/lib/components/app/` 负责工作区、时间线、Composer、Inspector 和设置等页面级展示，只通过 props 和回调与业务层通信。
3. `src/lib/ui-kit/` 是基础组件 adapter 门面。
4. `src/lib/components/ui/` 提供当前默认的 shadcn-svelte 风格实现。

页面组件不应直接导入 `src/lib/components/ui/`，统一从 `$lib/ui-kit` 引入基础组件。这样替换视觉实现时，不需要修改会话状态或 Agent API。

## 添加另一套 UI Kit

1. 在 `src/lib/ui-kit/kits/` 新增 adapter，并实现 `UiKitAdapter` 中的组件：`AlertDialog`、`Button`、`Badge`、`Card`、`Input`、`Textarea`、`Separator` 等。
2. 保持现有基础接口：`variant`、`size`、`class`、`children`、原生 HTML 属性，以及 `data-slot` 标识。
3. 在 `src/lib/ui-kit/registry.ts` 注册 adapter。
4. 使用 `VITE_AIBO_UI_KIT=<name>` 选择构建时实现；未配置或名称错误时回退到 `shadcn`。

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
