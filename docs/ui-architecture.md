# UI 架构与扩展边界

本文定义当前 UI 的分层、状态所有权、扩展方式和验证要求。默认工作台的视觉与交互细则以
[Aibo ak-ui 现行规范](design/ak-ui-current-spec.md)为准；公共呈现协议以
[Presentation 包合同](presentation-package.md)为准。阶段记录只说明当时的实现与验收，不能替代现行规则。

## 分层与依赖方向

| 层 | 主要位置 | 职责与依赖 |
| --- | --- | --- |
| 宿主装配 | `src/App.svelte` | 注入 API、订阅 Agent 事件，持有跨面板状态并装配控制器和页面生命周期。 |
| 业务与状态 | `src/lib/app/` | 纯状态转移、领域到 UI 的窄模型投影、依赖注入的控制器；不依赖 Svelte、UI 或具体 API 实现。 |
| 页面展示 | `src/lib/components/app/` | 消费 props，转发语义动作；视觉控件通过 `$lib/ui-kit` 使用。 |
| 可信呈现装配 | `src/lib/workbench/` | 装配布局、槽位和语义视图生命周期；同样遵守 UI kit、纯布局 CSS 和 API 依赖边界。 |
| UI kit | `src/lib/ui-kit/` | 提供完整的 `UiKitAdapter`、runtime proxy、主题与视觉实现；不拥有会话或执行状态。 |
| 外部呈现运行时 | `src/lib/presentation-runtime/` | 包校验、宿主数据投影、动作目录、隔离执行及视图状态桥接。 |

页面与可信呈现组件只传语义数据和用户意图，不通过 Agent 名称、插件 ID、可执行文件名或皮肤 ID
推断功能。业务层决定动作含义和是否可用，UI kit 决定如何显示，原生宿主负责最终授权与执行。

公共纯数据定义由 `packages/plugin-protocol/src/` 持有；`src/lib/presentation/` 的合同文件保留兼容导出，
投影模块保持框架与平台无关。公共协议不包含 Svelte、DOM、函数回调或可执行组件，协议包不反向依赖宿主。
`packages/web-presentation/index.d.ts` 定义可信 renderer 的本地可执行接口，允许 DOM 和回调；
`src/lib/workbench/types.ts` 与 `src/lib/ui-kit/presentation-props.ts` 是相应类型入口。
本地接口不能混入跨进程或 Worker 的 wire protocol。

## 状态与动作所有权

| 内容 | 所有者 | 呈现层的责任 |
| --- | --- | --- |
| 会话、历史、执行、队列、附件与审批 | 宿主及绑定的能力调用链 | 展示宿主快照，提交当前允许的语义意图。 |
| Composer、Git、工程动作、问答草稿及异步读取 | 宿主状态和注入式控制器 | 默认与外部工作台消费同一份状态；可替换组件不维护第二套业务副本。 |
| 布局选择、列宽与辅助区域开关 | 宿主按窗口保存 | 呈现实现排列区域并消费尺寸偏好；切换外观不重置偏好。 |
| 焦点、选区、滚动锚点与可恢复展开状态 | 宿主视图状态存储 | 通过稳定语义 key 恢复可匹配状态，不从其他会话或皮肤猜测身份。 |
| 颜色、字体、几何、图标、交互视觉 | UI kit 或对应的外部呈现 surface | 保留语义、可访问性和动作边界。 |

状态的持久化范围依所属合同确定；并非所有视图状态都写盘。外部焦点、选区与滚动缓存的范围和限制见
[视觉状态恢复](presentation-package.md#外部工作台视觉状态恢复)。呈现更换不能重建能力实例，
也不能丢失业务历史、草稿、附件、队列或待审批请求。

异步读取和回调必须验证当前工作区、会话及请求代际；关闭、删除、切换后的迟到结果不得恢复旧状态。
功能支持来自协商后的能力，忙碌、归档等状态决定此刻是否可执行；两者均不等于执行授权。
能力发现、安装绑定和权限检查见[会话能力协商](session-capability-negotiation.md)与
[宿主和插件边界](plugin-boundaries-and-regression.md)。

跨默认与外部工作台共享的展示投影只维护一份：时间线分组规则位于
`packages/presentation-workbench/timeline-model.js`，内置时间线通过兼容导出使用同一实现。
系统消息分组由宿主提示控制，推理、分支摘要和压缩摘要保持各自语义；皮肤不按 Agent 身份选择规则。
Agent 名称和品牌图标来自绑定插件声明，缺失时使用通用回退，UI kit 不维护提供者映射。

用户消息通过持久化的附件 ID 关联附件，不能按可能共享的 turnId 批量关联。预览请求只传会话与附件 ID，
由宿主校验所有权、工作区边界、格式、大小和哈希；切换会话后丢弃迟到预览，失败时仍保留文件名。

## 内部 UI Kit 与外部 Presentation

### 内部视觉合同

`UiKitAdapter` 是宿主内部完整的视觉合同。组件通过 `$lib/ui-kit` 导出，由 runtime proxy 选择当前实现。
复合控件接收语义 props 和回调，应用层不传入皮肤专属 class、颜色或图标库实现。
按钮意图、状态标记、设置表单、工作台外壳等都在此边界统一；完整成员以
[`contract.ts`](../src/lib/ui-kit/contract.ts)为准，不在本文重复维护组件清单。

当前唯一注册的内置 kit 是 `ak-ui`，提供浅色与深色主题，默认浅色。
`kits/ak-ui.ts` 注册 adapter，`kits/ak-ui/` 提供专属实现，`kits/shared/` 与仍使用的
`components/ui/` 提供共享行为和基础原语。应用组件不直接导入这些实现目录。

旧内置 shadcn / Material 3 已移除，其外观偏好由 `appearance-selection.ts` 迁移到 ak-ui；
迁移仅涉及旧外观存储，不改变外部包选择、工作区布局或会话数据。`VITE_AIBO_UI_KIT` 只查询内置注册表，
不安装或加载外部皮肤。独立 shadcn / Material 3 呈现包仍通过包安装机制使用。

### 外部扩展合同

根据 [ADR-0008](adr/0008-unified-presentation-plugins.md)，皮肤与 Presentation 是同一种用户可安装插件。
主题、控件、语义视图与工作台是同一包的可选定制范围，共用身份和激活生命周期。
外部包通过 `presentation.json` 声明合同、资源与 surfaces，不通过修改宿主注册表接入。

内部 adapter 始终完整；外部包未提供的范围继承宿主默认实现。新增内部控件不会自动成为外部 controls 协议，
也不要求已有外部包补齐所有内部控件。声明提供的范围必须通过预检，失败时执行明确的恢复，
不能把候选激活失败当作成功继承。字段、支持版本、打包与安装方式见[包合同](presentation-package.md)。

公共核心语义与可选专业呈现分开协商。宿主先检查快照格式支持，再选择可用的专业实现；
不存在、不兼容或超过专业实现限制时，用相同完整数据退回核心视图，不改变能力、输入或权限。
`SemanticView` 保持内部必需成员。协商规则见
[ADR-0007](adr/0007-presentation-core-and-fallback.md)，其中旧 skin/Presentation 身份划分已由 ADR-0008 替代。

## 布局与视觉边界

应用和可信呈现层 CSS 只表达布局：display、position、尺寸、flex/grid、间距、overflow、顺序、containment 和 z-index。
颜色、边框、圆角、阴影、字体、图标、焦点/禁用反馈、过渡与动画属于 UI kit。
第三方原语的 DOM 和间距由 adapter 归一化，不能让应用组件散布具体库的覆盖补丁。

- `src/app.css` 是样式入口。
- `kits/base.css` 持有共享样式与默认继承所需的回退；删除前检查所有消费者，不能因为 ak-ui 覆盖了某条规则就移除它。
- `kits/ak-ui.css` 与 `kits/ak-ui/themes.json` 持有默认 kit 的表现和主题令牌。
- `kits/motion.css` 统一减少动态效果；视觉动效偏好不改变业务执行行为。

内置依赖随应用打包，不在运行时从 CDN 加载。第三方 CSS 通过作用域或 layer 接入，
外部包 CSS 只能作用于隔离呈现，不能覆盖固定宿主区域。颜色值、尺寸和断点细则见
[ak-ui 现行规范](design/ak-ui-current-spec.md)。

可信 `WorkbenchPresentation` 本地接口用 `navigation`、`navigationResize`、`content`、
`auxiliaryResize`、`auxiliary` 和 `overlays` 命名槽位装配工作台。
呈现模块拥有区域顺序，宿主持有 standard/focus/review 选择和宽度偏好；
分栏增长方向来自实际顺序，重排后旧拖动动作失效。Svelte snippets 只用于可信本地装配。
外部工作台通过纯数据布局和动作合同消费同一宿主状态，详见
[工作台布局状态](presentation-package.md#工作台布局状态)。

原生窗口装饰由宿主控制：macOS 使用 Overlay 标题栏和原生红绿灯，拖动及双击缩放交给原生处理；
Windows 使用独立配置和自绘窗口按钮。呈现替换不接管原生窗口控制。

## 生命周期、隔离与恢复

`PresentationHost` 装配外部包，`WorkbenchPresentation` 装配可信工作台；它们是宿主生命周期组件，
不是两类用户插件。选择和安装事务由注入式 `presentation-package-controller` 管理，
业务状态与能力执行保持在可释放的呈现子树之外。

候选包通过验证和预检后才提交选择。取消、旧代际或迟到的结果不能覆盖当前选择；
候选失败保留最后确认的可用状态，运行故障提供默认呈现恢复。
宿主回调与可写绑定受 generation 和工作区/会话上下文检查，切换时暂停交互。

外部包代码在可终止 Worker 中计算受限视觉树，隔离文档内的可信桥负责绘制；主 WebView 不执行包代码。
宿主校验节点、资源和事件范围，原生 IPC、网络与执行权限不因呈现声明而开放。
隔离模型见 [ADR-0009](adr/0009-presentation-package-isolation.md)。

外部动作由宿主从当前快照生成不透明 token，绑定作用域、代际与 revision。
撤销或离开上下文的动作不能复用；点击严格核对 revision，本地输入仅使用合同明确允许的输入例外。
呈现不能自行提交任意 IPC、文件路径或写命令。完整动作桥规则见[包合同](presentation-package.md)。

### 固定宿主区域

窗口标题栏、管理中心、历史面板、命令面板、审批、确认与默认恢复入口位于可替换工作台之外。
呈现故障、禁用或卸载时，这些入口仍可达；审批由宿主重新核对待处理请求和可选决定，最终授权由原生宿主执行。
架构检查覆盖组件的祖先区域和所有槽位，不能仅靠 snippet 内部约定维持隔离。

打开管理中心或执行/调用历史时，工作台保持挂载、可见且 inert；会话历史另通过 `hideWhenSuspended` 隐藏工作台。
暂停输入与隐藏布局分别控制，隔离绘制桥同步祖先的 inert/hidden 状态，迟到绘制不得抢走宿主焦点。
管理和审批的键盘访问优先于被暂停工作台。

普通关闭恢复触发焦点；设置期间更换呈现时，将焦点与选区恢复交还宿主视图状态存储。
恢复目标必须可见、可交互且不在 hidden/inert 区域，聚焦后确认实际生效，失败时继续选择可用目标。
宿主持有命令面板与 `Ctrl/⌘+Shift+Backspace` 默认恢复入口，其可用性不依赖当前呈现代际。

## 扩展与修改流程

### 修改默认组件或增加内部复合控件

1. 先确定业务状态与动作的所有者；页面仅增加窄 props 和语义回调。
2. 在 `UiKitAdapter` 及对应 props 中定义合同，实现 runtime proxy、公开导出和当前所有注册 adapter。
   当前内置实现只有 ak-ui，必需成员不能改为 optional 来绕过完整性检查。
3. 视觉与交互实现放入 kit；共享行为才进入 shared/base。默认 ak-ui 的具体视觉遵循现行规范。
4. 若影响外部呈现，分别检查未覆盖 surface 的继承，以及已覆盖 surface 的快照和动作是否仍完整。
   需要新增公共字段时，同时更新协议、验证器及消费者，不能把内部组件接口直接当作外部协议。
5. 按下节验证；正式改变架构规则时同步 UI 合同、架构测试和本文。

### 开发外部外观或工作台

按[插件开发指引](plugin-development_zh.md)与[包合同](presentation-package.md)声明、打包和安装 Presentation 包，
使用宿主提供的快照、动作及可选 surfaces。验证安装、激活、切换、禁用/卸载、缺失范围继承和故障恢复。
增加新的可信内置 kit 属于宿主架构变更，需要同步注册、偏好兼容及唯一默认 kit 的测试约束，
不是第三方外观的常规接入步骤。

## 验证要求

从仓库根目录运行 `pnpm run verify`，包含架构检查、类型检查、Node 测试与构建；CI 使用同一入口。
`check:architecture` 覆盖 app/workbench 的导入、CSS、公共纯数据边界、宿主区域与 generation guard；
`test/default-ui-kit.test.mjs` 保护唯一内置 kit、主题及旧入口兼容。

按[回归矩阵](plugin-boundaries-and-regression.md#regression-gate)选择受影响路径，验证改变的行为与必须保留的既有行为。
UI 实现变化需检查默认 ak-ui 浅/深主题，以及受影响外部包的继承、协商与失败恢复。
以下是常用浏览器入口，选择依据是改动边界，不是历史阶段编号：

| 变化 | 探针入口 |
| --- | --- |
| 默认主题、响应式、密度与控件交互 | `probes/ak-ui-browser.mjs`、`probes/ak-ui-density-browser.mjs`、`probes/ak-ui-controls-browser.mjs` |
| Composer 输入、引用、粘贴与附件 | `probes/composer-input-browser.mjs`、`probes/composer-paste-browser.mjs` |
| 外部包继承、完整工作台与恢复 | `probes/presentation-app-browser.mjs`、`probes/presentation-full-skins-browser.mjs` |
| 管理区域、焦点与审批访问 | `probes/host-panels-browser.mjs` |

`verify` 不运行浏览器或 Rust 测试；使用替身 IPC 的浏览器结果不能证明原生授权、持久化或 OS 行为。
涉及这些边界时追加对应原生验证并说明未覆盖范围。仅文档修改运行 `verify` 并检查引用即可。

## 专项文档与历史记录

| 修改内容 | 权威说明 |
| --- | --- |
| 默认 kit 的视觉、密度、状态与响应式 | [ak-ui 现行规范](design/ak-ui-current-spec.md) |
| 外部呈现包、快照、动作、状态恢复 | [Presentation 包合同](presentation-package.md) |
| 能力协商、模式和权限菜单 | [会话能力协商](session-capability-negotiation.md)、[会话控件](session-controls.md) |
| 设置表单与原生校验 | [Agent 设置协议](agent-plugin-settings.md) |
| 工作区新增与默认信任 | [工作区信任偏好](workspace-preferences.md) |
| 目标、队列及子任务过程 | [目标生命周期](goal-lifecycle.md)、[消息队列](message-queue.md)、[子 Agent 历史](subagent-history.md) |
| Git 仓库、选择和分页 | [Git 仓库](git-repositories.md) |
| 共享边界与回归范围 | [宿主与插件边界及回归要求](plugin-boundaries-and-regression.md) |

旧 PluginView 和 P1–P5 迁移过程见[历史归档](archive/README.md)；呈现包交付与当时证据见
[退出审计](presentation-plugin-exit-audit.md)。旧接口、双内置皮肤和阶段性待办不构成当前实现要求。
