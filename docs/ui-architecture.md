# UI 架构与扩展边界

本文定义当前 UI 的分层、状态所有权、扩展方式和验证要求。默认工作台的视觉与交互细则以
[Aibo Material 3 现行规范](design/material3-current-spec.md)为准；公共呈现协议以
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
| 布局选择、列宽、导航栏收起状态与辅助区域开关 | 宿主按窗口保存 | 呈现实现排列区域并消费尺寸偏好；切换外观不重置偏好。窗口变窄时只按比例压缩显示列宽，不改写保存的偏好，放宽后恢复。收起状态仅用于内置工作台（收起时隐藏 `navigationResize` 槽位），不属于外部布局合同。 |
| 焦点、选区、滚动锚点与可恢复展开状态 | 宿主视图状态存储 | 通过稳定语义 key 恢复可匹配状态，不从其他会话或皮肤猜测身份。 |
| 颜色、字体、几何、图标、交互视觉 | UI kit 或对应的外部呈现 surface | 保留语义、可访问性和动作边界。 |

状态的持久化范围依所属合同确定；并非所有视图状态都写盘。外部焦点、选区与滚动缓存的范围和限制见
[视觉状态恢复](presentation-package.md#外部工作台视觉状态恢复)。呈现更换不能重建能力实例，
也不能丢失业务历史、草稿、附件、队列或待审批请求。

会话导航统一按内容活动时间倒序，同刻以会话 ID 倒序稳定排序；归档筛选不改变此规则。
宿主返回的 `Session.updatedAt` 是 `sessions.content_updated_at`，无内容时使用创建时间；
数据库原有 `sessions.updated_at` 保留为维护时间，恢复连接、改名、归档及状态恢复不影响导航。
消息新增或正文/工具结果变化推进内容时间，状态更新和相同内容的重复快照不推进；
子 Agent 消息同样计入，但子 Agent 状态摘要不计入。前端插入、替换与刷新合并使用相同排序，
刷新保留并发本地修改时仍接纳宿主更新的内容时间。默认与外部呈现消费同一投影。
升级时根据消息创建时间与持久化内容事件回填；旧记录没有事件时，无法精确重建最后一次
流式修改的时间，使用可确认的消息创建时间，不沿用可能已被维护操作污染的时间。

异步读取和回调必须验证当前工作区、会话及请求代际；关闭、删除、切换后的迟到结果不得恢复旧状态。
普通选择、创建分支及取消归档共用导航控制器的上下文清理与加载；生命周期操作先保存返回的会话，
仅在用户选择未变化时导航到结果。时间线读取的成功与失败均核对当前会话。
搜索打开活动会话复用会话状态转移的排序；打开历史时将工作区、会话及消息锚点作为一次请求，
由同一个面板生命周期启动读取，避免 effect 与点击处理器重复加载。
功能支持来自协商后的能力，忙碌、归档等状态决定此刻是否可执行；两者均不等于执行授权。
能力发现、安装绑定和权限检查见[会话能力协商](session-capability-negotiation.md)与
[宿主和插件边界](plugin-boundaries-and-regression.md)。

Git 工作区状态由 `src/lib/app/workspace-git-controller.ts` 持有：仓库发现与选择、
仓库草稿、历史分页、提交文件列表、diff 读取和写入完成后的刷新都经过同一个注入式控制器。
`App.svelte` 注入原生调用与存储、订阅快照、接入导航及呈现动作；内置与外部工作台消费
同一份状态。控制器按窗口保存仓库偏好，沿用工作区/仓库草稿键，呈现切换不会重建控制器。
工作区或仓库切换撤销旧读取结果；写入保留提交时的目标，离开页面后仍报告结果，
但不刷新或关闭新视图。提交与建分支成功后仅清除仍与提交值相同的原仓库草稿。
回归入口为 `test/workspace-git-controller.test.mjs`、`test/presentation-git.test.mjs`
及 `probes/presentation-git-browser.mjs`。Inspector 的回合 diff、文件/hunk 动作及
回合恢复由 `turn-change-controller.ts` 持有，通过 `test/turn-change-controller.test.mjs`
及 `probes/presentation-inspector-browser.mjs` 验证；App 仅连接会话导航与完成后的刷新。

跨默认与外部工作台共享的展示投影只维护一份：时间线分组规则位于
`packages/presentation-workbench/timeline-model.js`，内置时间线通过兼容导出使用同一实现。
系统消息分组由宿主提示控制，推理、分支摘要和压缩摘要保持各自语义；皮肤不按 Agent 身份选择规则。
Agent 名称和品牌图标来自绑定插件声明，缺失时使用通用回退，UI kit 不维护提供者映射。

Markdown 也在 `packages/presentation-workbench/markdown.js` 共享解析，支持技术回答常用的
GFM 表格、编号/嵌套/任务列表、引用、完整标题、强调和代码；内置组件与外部视觉树分别
安全绘制同一份数据，不注入 HTML。代码高亮使用纯文本节点，复制保留完整源代码。
回答中的网页/邮件链接由宿主统一打开：内置时间线和子 Agent 详情上报 `onOpenLink`，
外部工作台沿用已校验的 `openLink` 动作。桌面通过 Tauri opener 调用系统默认应用，
原生权限仅允许 `http`、`https`、`mailto`，不授予文件路径打开权限；浏览器预览使用新标签页。
打开失败由宿主显示通知，不依赖 WebView 的 `target="_blank"` 新窗口行为。
显式 Markdown 文件链接支持工作区相对路径、绝对路径、`file://`，并解析 `:行号[:列号]`
与 `#L行号`（含范围形式，定位起始行）。普通文字与行内代码不自动变成文件链接。
网页、邮件、文件链接前绘制小型线性类型图标；外部包与内置组件共享链接分类。

文件链接通过同一个 `openLink` 入口转入宿主 `file-preview-controller`，在工作台外的
非模态侧边 `FilePreviewPanel` 中只读预览，提供行号、代码高亮、目标行滚动与标记、
复制路径、分段阅读和关闭。子 Agent 详情先关闭模态详情，再打开宿主预览。
文件预览不随皮肤切换销毁；关闭、换文件、切换会话或工作区会撤销旧读取结果。
外部皮肤只提交当前消息绑定的动作，不获得文件内容或任意文件读取接口。

`read_linked_file` 从持久化会话查找工作区，不接受前端提供的根目录；相对路径以工作区根为基准，
绝对路径也必须位于该工作区内。`text_preview` 与全局搜索共享规范化路径和有界 UTF-8 读取，
拒绝越界、符号链接逃逸、目录、二进制和非 UTF-8 文件。当前读取上限 2 MiB，每次显示最多
400 行；缺失文件或超出已读取范围的行号显示错误。预览读取当前磁盘内容，不是回答生成时快照。
工作区外文件、目录打开、图片/PDF 预览和列级定位不在第一版范围。
布局在 UI kit 的 base 层，颜色和排版在各 kit 中定义，外部包提供自己的样式。
公式、Mermaid 和远程图片预览不在此渲染范围。验证入口为
`test/markdown-technical.test.mjs`、`probes/markdown-browser.mjs` 和完整外部皮肤探针。
`probes/markdown-links-native.mjs` 用隔离桌面实例验证回答链接实际到达系统浏览器。
文件预览验证入口为 `test/file-links.test.mjs`、`probes/file-links-browser.mjs`、
`probes/file-links-native.mjs` 和 Rust `file_preview` / `search_files` 测试。

用户消息通过持久化的附件 ID 关联附件，不能按可能共享的 turnId 批量关联。预览请求只传会话与附件 ID，
由宿主校验所有权、工作区边界、格式、大小和哈希；切换会话后丢弃迟到预览，失败时仍保留文件名。

## 内部 UI Kit 与外部 Presentation

### 内部视觉合同

`UiKitAdapter` 是宿主内部完整的视觉合同。组件通过 `$lib/ui-kit` 导出，由 runtime proxy 选择当前实现。
复合控件接收语义 props 和回调，应用层不传入皮肤专属 class、颜色或图标库实现。
按钮意图、状态标记、设置表单、工作台外壳等都在此边界统一；完整成员以
[`contract.ts`](../src/lib/ui-kit/contract.ts)为准，不在本文重复维护组件清单。

当前注册两个内置 kit：`ak-ui` 和 `material3`，均支持浅色/深色。ak-ui 保留原有两套主题；
Material 3 提供经典蓝、森林绿与紫罗兰三组配色，每组包含浅深版本。
`material3` 为默认与首次启动的回退，使用经典蓝浅色；ak-ui 仍可在外观设置选择。
有效的已保存外观优先于默认值，包括 ak-ui、Material 3 配色及旧偏好迁移结果；升级不覆盖用户选择。
缺失、损坏或未知偏好回到默认外观，显式 `VITE_AIBO_UI_KIT` 覆盖仍然有效。
两个注册入口各自装配 adapter。`kits/shared-controls.ts` 和 `kits/shared/` 只提供无皮肤的 DOM、
可访问性与交互行为，`components/ui/` 的基础原语也不预置视觉 utility。图标和状态图形由各 kit
独立提供。应用组件不直接导入这些实现目录。

旧内置 shadcn 与基于 m3-svelte 的 Material 3 实现已移除。旧 shadcn 主题及旧 Material 3 的
`ocean` / `sage` / `violet` / `daylight` 偏好仍由 `appearance-selection.ts` 迁移到 ak-ui；
新的 `material3` 保留经典蓝的 `light` / `dark` ID，并新增 `forest-light` / `forest-dark`、
`plum-light` / `plum-dark`，保存时按注册表校验，与旧主题迁移区分。
迁移仅涉及旧外观存储，不改变外部包选择、工作区布局或会话数据。`VITE_AIBO_UI_KIT` 只查询内置注册表，
不安装或加载外部皮肤。独立 shadcn / Material 3 呈现包仍通过包安装机制使用。

### 内置外观 release

两个内置 kit 同时是宿主预装的可信 Presentation release，id 为 `dev.aibo.builtin.<kit>`。
宿主启动时从编译进来的 `kits/<kit>/presentation.json` 登记这两个 release，与外部包共用
`presentation_releases` 和按窗口的 `presentation_selections`。`dev.aibo.builtin.` 是保留前缀：
本地包不能安装这类 id，内置 release 也不能被禁用或卸载。release 的 `source` 由宿主根据前缀判定，
不来自 manifest。内置 release 没有资源文件，也不在隔离环境中运行；激活时只切换已编译的 kit 与主题。

`presentation.json` 由 `pnpm run generate:builtin-presentations` 从 `themes.json` 生成，并按外部包的
schema 与 token 规则校验。`themes.json` 顶层的可选 `tokens` 是 kit 的基础 token，每个主题只写自己改变的值；
注册表合并两者后，得到完整的主题 token 集合。宿主版本变化或主题内容变化时，同 id 的旧内置行被替换，
各窗口保留原选择；主题 id 不再存在时回到默认主题。

选择以宿主记录为准。`localStorage` 中的 `aibo.appearance.v1` 只用于首帧渲染缓存和无原生宿主的浏览器环境；
首次启动且宿主没有该窗口的记录时，将缓存中的 kit 与主题记录到对应的内置 release。
外部包运行失败、被禁用或不兼容时，回到该窗口最近一次的内置选择；设置中的"恢复内置皮肤"
仍然选择产品默认外观。宿主没有登记内置 release 时，沿用仅缓存的选择方式。

### 单选下拉控件

应用中的单选下拉通过必需的 `UiKitAdapter.Select` 使用统一语义接口：`options`、确认后的
`value`、`disabled` 与 `onSelect`。选择只提交用户意图，异步确认前继续显示宿主提供的值。
共享行为使用按钮 combobox 与 Popover 顶层 listbox，支持方向键、Home/End、文字定位、
Enter/Space 确认、Escape 取消及 Tab 离开；滚动祖先或调整窗口时关闭，避免浮层脱离入口。
触发器和选项的颜色、形状、选中及焦点样式分别由当前 kit 提供，页面不直接使用原生 `<select>`。

外部视觉树沿用 `select` / `option` 及现有 change 动作合同，可信绘制桥将单选节点绘制为
同类自定义菜单，保留语义 key、原始值、动作 token、revision 与真实用户事件校验。
旧包通过现有主题令牌获得菜单的基础外观；独立 shadcn / Material 3 包从 0.3.2 提供
`.ui-select-*` 样式，安装新版后使用包自己的菜单细节。
多选节点继续保留原协议行为。

外部 controls 包定制 Select 或 ModelContextSelect 时，只绘制触发器；选项菜单由 `UiKitAdapter.SelectMenu`
在 iframe 外绘制。它与 Select 共用 `.ui-select-*` 样式和 `kits/shared/select-navigation.ts` 中的键盘规则，
挂载即打开并接管焦点，关闭后焦点回到控件 iframe。

### 内置 Material 3

[Material 3 规范](design/material3-current-spec.md)以 [HTML 设计稿](design/material3-redesign.html)为视觉基准。
`kits/material3.ts` 与 ak-ui 分别装配共享行为组件，保留输入、菜单与对话框的函数身份；
没有交互状态的图标与状态图形使用各自的实现。Material 3 不导入 ak-ui adapter、CSS 或令牌；
`--md-sys-*` 定义视觉角色，`--md-aibo-*` 定义本地排版、密度与动效，`--aibo-*` 保留宿主/外部主题语义。
不改变应用层 props、事件、能力合同或宿主状态，也不引入已移除的 m3-svelte。

两种内置外观切换时保留浅深偏好，不重建编辑器、菜单和管理对话框。工作区列宽、布局、草稿、
附件、队列、历史及审批仍由原宿主管理。HTML 设计稿中的模拟交互不进入产品实现。
外部包未覆盖的 surface 继承当前选中的内置 kit；外部包失败时回到该内置选择。
设置中的“恢复内置皮肤”通过 `defaultUiKitId` 显式选择 Material 3 并保留明暗，
不依赖设置卡片的显示顺序；外部包自动故障回退继续使用当前内置选择。
更改默认外观不修改外部包清单、发布身份或会话绑定。

### 明暗与配色选择

内置 `UiThemeRegistration.palette` 是可选的 `{ id, label, description }`，显式关联同一配色的浅深主题；
不从主题 ID、名称或颜色值推断分组。所有主题都提供该字段时，设置显示「明暗模式」与「配色方案」；
未分组的 kit 保留现有主题列表，因此 ak-ui 及外部呈现包的选择方式不变。

切换明暗只查找同一 palette 的目标亮度；切换配色只查找当前亮度的目标主题。配色卡片的色板跟随亮度，
缺失版本显示不可用，不能静默换另一配色。标题栏快捷按钮复用同一明暗解析函数。
偏好继续保存 `{ kitId, themeId }`，主题 ID 唯一确定配色和亮度，避免分别保存后出现不一致。
跨 kit 切换沿用现有规则，保留亮度并选择目标 kit 的对应默认配色；不会把某套 kit 的配色注入另一套。

配色仅替换所属 kit 的颜色令牌，不改变组件身份、几何、字体或行为。选择控件的视觉也归当前 kit。
`palette` 是可信内置元数据，本次不扩展外部 Presentation manifest；外部包继续使用已有平铺主题合同。

### 外部扩展合同

根据 [ADR-0008](adr/0008-unified-presentation-plugins.md)，皮肤与 Presentation 是同一种用户可安装插件。
主题、控件、语义视图与工作台是同一包的可选定制范围，共用身份和激活生命周期。
外部包通过 `presentation.json` 声明合同、资源与 surfaces，不通过修改宿主注册表接入。

内部 adapter 始终完整；外部包未提供的范围继承宿主默认实现。新增内部控件不会自动成为外部 controls 协议，
也不要求已有外部包补齐所有内部控件。声明提供的范围必须通过预检，失败时执行明确的恢复，
不能把候选激活失败当作成功继承。字段、支持版本、打包与安装方式见[包合同](presentation-package.md)。

界面语言属于宿主应用偏好，与 kit、主题、工作区和会话身份分开。
controls、semantic 和 workbench 的 `PresentationInput.locale` 仅提供显示语言，
语言切换在原实例上更新递增 revision 的输入，不改变 intent.context 或授权。
宿主通知保留消息描述符，到展示时翻译；外部协议仍只传递普通数据，不传递函数。
词条与保存规则见[界面国际化](i18n.md)。

公共核心语义与可选专业呈现分开协商。宿主先检查快照格式支持，再选择可用的专业实现；
不存在、不兼容或超过专业实现限制时，用相同完整数据退回核心视图，不改变能力、输入或权限。
`SemanticView` 保持内部必需成员。协商规则见
[ADR-0007](adr/0007-presentation-core-and-fallback.md)，其中旧 skin/Presentation 身份划分已由 ADR-0008 替代。

## 布局与视觉边界

应用和可信呈现层 CSS 只表达布局：display、position、尺寸、flex/grid、间距、overflow、顺序、containment 和 z-index。
颜色、边框、圆角、阴影、字体、图标、焦点/禁用反馈、过渡与动画属于 UI kit。
第三方原语的 DOM 和间距由 adapter 归一化，不能让应用组件散布具体库的覆盖补丁。

- `src/app.css` 是样式入口。
- `kits/base.css` 只保留结构布局与文档启动时的根级回退，不放任何 kit 的颜色、边框、圆角、字体或状态样式。
- `kits/ak-ui.css` 与 `kits/material3.css` 各自拥有完整外观，选择器只能匹配自己的 `data-ui-kit`。
- 各 kit 的 `primitives.css`、`foundation.css`、`components.css` 分别提供基础原语、工作台表面和复合控件视觉；
  `themes.json` 持有独立令牌。动画名也须使用 kit 前缀，防止全局 keyframes 互相覆盖。
- 禁止把某个 kit 的视觉作为所有 kit 的基础，再用覆盖规则补差异；共享组件不得导入具体 kit，
  不得携带皮肤 CSS、令牌或视觉 utility。外部包的缺省继承由当前内置 kit 提供，不由共享层指定外观。
- `kits/motion.css` 统一减少动态效果；视觉动效偏好不改变业务执行行为。

内置依赖随应用打包，不在运行时从 CDN 加载。第三方 CSS 通过作用域或 layer 接入，
外部包 CSS 只能作用于隔离呈现，不能覆盖固定宿主区域。颜色值、尺寸和断点细则分别见
[Material 3 现行规范](design/material3-current-spec.md)与 [ak-ui 现行规范](design/ak-ui-current-spec.md)。

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

### 设置中心

两个快捷入口共用固定宿主 `SettingsPanel` 和 `ManagementCenter`，分别定位到外观和插件管理。
内部 `UiManagementSection` 包含 `appearance`、`layout`、`workspace`、`extensions`、`runtime`，
各分类通过独立 snippet 传入默认 kit；runtime proxy 原样转发。此分类属于内部 UI 合同，
不改变外部呈现消息协议、Agent 设置作用域或原生持久化。
皮肤选择与包管理分属外观和插件页，恢复入口与错误仍由宿主提供。
工作区页同时管理新增目录默认信任与五类宿主操作确认，后者全局默认始终允许，可逐类改为每次询问。
这些策略由原生宿主读取，独立于 Agent 会话审批；详见[工作区偏好](workspace-preferences.md)。
插件表单草稿由 App 的设置控制器持有，分类卸载或关闭窗口不丢弃；保存动作仍显式执行。

### 固定宿主区域

窗口标题栏、管理中心、历史面板、全局搜索面板、文件预览面板、宿主操作确认、应用通知与默认恢复入口位于可替换工作台之外。
呈现故障、禁用或卸载时，这些入口仍可达。

#### 应用通知

应用通知是宿主持有的瞬时反馈（`src/lib/app/notifications.ts`），位于 `AppOverlays` 的 `toast-region`。
产生方只选择语义类型 `success`、`info`、`warning` 或 `error`，不选择视觉；warning 与 error 显示 6 秒，
其余 3.6 秒。各内置 kit 自行定义样式：Material 3 使用反色表面、8px 圆角和圆形状态图标；
ak-ui 使用中性直角表面和 3px 语义色左侧标记。两者都遵守减少动态效果偏好。
验证入口为 `probes/toast-browser.mjs`。

Agent 会话审批与 Agent 提问一样属于会话区域：宿主只把当前会话的待处理审批交给工作台，
默认 `TimelinePanel` 在消息与输入框之间渲染，外部呈现通过 `approvalRequests` 快照与 `resolveApproval`
动作渲染（见[包合同](presentation-package.md#工作台会话与-composer)）。审批不再在窗口顶部、管理中心或宿主面板上处处可见；
其他会话的待处理审批只通过会话状态提示；导航栏收起时，入口按钮以标记和可访问名称提示等待审批或输入的会话数，后续由系统通知补足。外部呈现故障或不渲染审批时，
用户经默认恢复入口回到默认呈现继续审批。无论在哪里提交，宿主都重新核对待处理请求和可选决定，最终授权由原生宿主执行。

内置提问面板一次展示一道问题，多题时显示题号、回答状态和上一个/下一个操作，题号可直接跳转。
选择答案不自动翻页；切换问题保留宿主拥有的回答草稿。最后一题提交全部回答，遗漏时回到第一道
未回答的问题并提示；单题隐藏分页，直接提交。当前协议没有单题可跳过标记，沿用所有问题均需
回答的校验。标题、分页和底部操作栏位于滚动内容外，长问题、选项和输入框在内容区滚动，
键盘聚焦输入框时保持可达。外部 workbench 继续消费相同问答快照与动作合同，自行决定展示方式。
验证入口为 `probes/user-input-pagination-browser.mjs`，覆盖两套内置 kit 的浅深主题。

架构检查覆盖组件的祖先区域和所有槽位，不能仅靠 snippet 内部约定维持隔离。

打开管理中心或执行/调用历史时，工作台保持挂载、可见且 inert；会话历史另通过 `hideWhenSuspended` 隐藏工作台。
暂停输入与隐藏布局分别控制，隔离绘制桥同步祖先的 inert/hidden 状态，迟到绘制不得抢走宿主焦点。
显式恢复外部呈现焦点时，宿主先校验当前焦点归属并聚焦 iframe，再通知绘制桥恢复内部控件；重绘只有在隔离文档仍持有焦点时才能恢复控件焦点，过时许可不能覆盖用户后来选中的宿主控件。
管理的键盘访问优先于被暂停工作台。管理中心是模态对话框，打开期间工作台及其中的会话审批不可交互，
关闭后回到会话区域继续处理。

普通关闭恢复触发焦点；设置期间更换呈现时，将焦点与选区恢复交还宿主视图状态存储。
从管理中心打开执行历史时，管理中心不再把焦点还给自己的入口，焦点留在新面板内；
面板关闭时原触发按钮已随管理中心卸载，焦点改回标题栏的管理中心入口。
恢复目标必须可见、可交互且不在 hidden/inert 区域，聚焦后确认实际生效，失败时继续选择可用目标。
宿主持有[全局搜索面板](global-search.md)（双击 Shift 或 Ctrl/⌘ K）与 `Ctrl/⌘+Shift+Backspace` 默认恢复入口，其可用性不依赖当前呈现代际。

## 扩展与修改流程

### 修改默认组件或增加内部复合控件

1. 先确定业务状态与动作的所有者；页面仅增加窄 props 和语义回调。
2. 新增或修改语义接口时，同步 `UiKitAdapter` 及对应 props、runtime proxy、公开导出和当前所有注册 adapter。
   仅调整样式或主题令牌时沿用现有接口。两个内置 adapter 都必须覆盖完整合同，必需成员不能改为 optional 来绕过完整性检查。
3. 视觉实现放入对应 kit；共享行为进入 shared，共享布局进入 base。Material 3 与 ak-ui 的具体视觉分别遵循各自现行规范。
4. 若影响外部呈现，分别检查未覆盖 surface 的继承，以及已覆盖 surface 的快照和动作是否仍完整。
   需要新增公共字段时，同时更新协议、验证器及消费者，不能把内部组件接口直接当作外部协议。
   把控件加入外部 controls 目录时，在 `presentation-runtime/controls.ts` 的注册表中提供纯数据投影、
   按当前 props 重新解析意图的 `resolve` 和预检样例；runtime proxy 使用 `PublicControl` 包裹 kit 组件。
   `ExternalControl` 与 `PublicControl` 不按控件名分支，由 `test/presentation-controls.test.mjs` 检查。
5. 按下节验证；正式改变架构规则时同步 UI 合同、架构测试和本文。

### 开发外部外观或工作台

按[插件开发指引](plugin-development_zh.md)与[包合同](presentation-package.md)声明、打包和安装 Presentation 包，
使用宿主提供的快照、动作及可选 surfaces。提供 workbench surface 的包须渲染当前会话的 `approvalRequests`
（见[插件开发指引](plugin-development_zh.md#渲染会话审批)）。验证安装、激活、切换、禁用/卸载、缺失范围继承和故障恢复。
增加新的可信内置 kit 属于宿主架构变更，需要同步注册、偏好兼容、完整 adapter 与默认回退的测试约束，
不是第三方外观的常规接入步骤。

## 验证要求

从仓库根目录运行 `pnpm run verify`，包含迁移检查、架构检查、类型检查、Node 测试与构建；CI 使用同一入口。
`check:architecture` 覆盖 app/workbench 的导入、CSS、公共纯数据边界、宿主区域与 generation guard；
`test/default-ui-kit.test.mjs` 保护两个内置 kit、完整 adapter、默认回退、切换时的明暗偏好及旧入口兼容。
`test/material3-theme.test.mjs` 限制共享层视觉声明、跨 kit 选择器/令牌引用及全局动画名。
`probes/material3-controls-browser.mjs` 验证按钮、输入、badge 等状态，并删除 ak-ui 规则与令牌后比较实际外观。
`test/theme-options.test.mjs` 验证配色配对及缺失版本；`probes/material3-palettes-browser.mjs` 检查
六个主题的实际颜色、明暗快捷切换、原生键盘选择、状态保留、重载与 ak-ui 不变。

按[回归矩阵](plugin-boundaries-and-regression.md#regression-gate)选择受影响路径，验证改变的行为与必须保留的既有行为。
UI 实现变化需检查默认 Material 3 与 ak-ui 的浅/深主题，以及受影响外部包的继承、协商与失败恢复。
设备范围按[现行规范的适用范围](design/ak-ui-current-spec.md#适用范围与优先级)选择；探针中保留的范围外场景属于补充检查。
以下是常用浏览器入口，选择依据是改动边界，不是历史阶段编号：

| 变化 | 探针入口 |
| --- | --- |
| 单选下拉的主题、键盘、长列表与外部动作 | `probes/select-browser.mjs` |
| 两套内置主题、响应式、密度与控件交互 | `probes/default-appearance-browser.mjs`、`probes/material3-browser.mjs`、`probes/ak-ui-browser.mjs`、`probes/ak-ui-density-browser.mjs`、`probes/ak-ui-controls-browser.mjs` |
| Composer 输入、引用、粘贴与附件 | `probes/composer-input-browser.mjs`、`probes/composer-paste-browser.mjs` |
| 外部包继承、完整工作台与恢复 | `probes/presentation-app-browser.mjs`、`probes/presentation-full-skins-browser.mjs` |
| 管理区域与焦点；宿主面板不承载审批 | `probes/host-panels-browser.mjs` |
| 会话区域审批、故障回退后审批与选项作答 | `probes/presentation-full-skins-browser.mjs`（`probes/lib/presentation-approval-fault.mjs`） |
| 长命令审批的高度限制、命令详情滚动与按钮换行 | `probes/approval-layout-browser.mjs` |
| 多题提问分页与回答草稿 | `probes/user-input-pagination-browser.mjs` |
| 导航栏收起、等待提示与布局恢复 | `probes/sidebar-collapse-browser.mjs` |
| 应用通知类型与各 kit 样式 | `probes/toast-browser.mjs` |
| 回答中的文件链接、类型图标与预览面板 | `probes/file-links-browser.mjs` |
| 内置外观作为预装 release 的选择与回退 | `probes/builtin-presentation-browser.mjs` |
| hostApi 1.1.0 公开控件的定制与预检 | `probes/presentation-controls-browser.mjs`、`probes/presentation-skin-controls-browser.mjs` |
| 分支/取消归档、切换期间迟到时间线、默认与外部呈现导航 | `probes/session-lifecycle-browser.mjs` |
| 五类设置、快捷入口、布局恢复焦点、插件草稿与继承 | `probes/settings-sections-browser.mjs`、`probes/workspace-preferences-browser.mjs` |

`verify` 不运行浏览器或 Rust 测试；使用替身 IPC 的浏览器结果不能证明原生授权、持久化或 OS 行为。
涉及这些边界时追加对应原生验证并说明未覆盖范围。仅文档修改运行 `verify` 并检查引用即可。

## 专项文档与历史记录

| 修改内容 | 权威说明 |
| --- | --- |
| 内置 kit 的视觉、密度、状态与响应式 | [Material 3 现行规范](design/material3-current-spec.md)、[ak-ui 现行规范](design/ak-ui-current-spec.md) |
| 外部呈现包、快照、动作、状态恢复 | [Presentation 包合同](presentation-package.md) |
| 能力协商、模式和权限菜单 | [会话能力协商](session-capability-negotiation.md)、[会话控件](session-controls.md) |
| 设置表单与原生校验 | [Agent 设置协议](agent-plugin-settings.md) |
| 工作区新增与默认信任 | [工作区信任偏好](workspace-preferences.md) |
| 目标、队列及子任务过程 | [目标生命周期](goal-lifecycle.md)、[消息队列](message-queue.md)、[子 Agent 历史](subagent-history.md) |
| Git 仓库、选择和分页 | [Git 仓库](git-repositories.md) |
| 共享边界与回归范围 | [宿主与插件边界及回归要求](plugin-boundaries-and-regression.md) |

旧 PluginView 和 P1–P5 迁移过程见[历史归档](archive/README.md)；呈现包交付与当时证据见
[退出审计](presentation-plugin-exit-audit.md)。旧接口、双内置皮肤和阶段性待办不构成当前实现要求。

## 会话右侧标签工作区

右侧辅助区域由 `sidebar-controller` 持有会话级标签和插件视图，`sidebar-layout` 提供纯布局转移。
`SidebarDock` 通过 UI kit 绘制右侧工具轨、视图选择菜单、上下分屏和窗口内浮动面板。
工具轨顺序由 `layout.tabs` 持有，与面板归属独立；拖拽、Alt+上下键或菜单上下移只调整入口顺序。
点击入口聚焦其所属面板；右键、Shift+F10 或“更多”菜单提供在下方打开、浮动、移回主面板与移除。
工具轨悬停或键盘聚焦时显示名称；上下键、Home/End 移动焦点，Enter/Space 打开视图。
浮动面板可移动、调整大小和重新停靠。收起只隐藏停靠内容，保留工具轨和已挂载内容；
收起偏好按窗口存于 `aibo.workbench-layout.v1`，与原列宽独立，外部工作台仍消费完整侧栏宽度。
Git 与上下文是内置标签；能力插件的已安装 `semanticView` 贡献自动进入打开菜单，仍通过
原来的 InstalledPort、Broker、语义快照校验及动作授权链路读取与执行，不把插件组件挂入宿主。

布局按窗口、工作区、会话保存于 `aibo.sidebar.v1` localStorage 键，存储不可用时保持内存内可用。
仅保存目标身份、顺序、活动标签、面板与浮动几何，不保存插件快照、动作 token、授权或租约。
无会话的工作区也有独立布局。相同 installation/contribution 在一个布局中只出现一次；再次打开
会聚焦已有标签。恢复读取最多 64 个标签与面板，损坏偏好降级或清理。颜色、排版和外观切换
不参与布局身份，也不重建插件租约。

每个已打开插件标签由宿主独立持有一个 installed-workbench controller；切换标签、分屏、
浮动和换肤不释放它。关闭标签、切换会话/工作区及插件不可用时释放；迟到读取不能恢复旧视图。
插件禁用或移除时保留不可用标签，目录重新可用后按当前作用域重新读取。恢复的布局本身不授予
执行权限。Git 与工程任务的可见刷新检查所有面板的活动标签，分屏时两者可同时刷新。

外部 workbench 快照新增可选 `sidebar` 与 `sidebarActions`；见[呈现包合同](presentation-package.md#右侧标签工作区)。
内置文件链接预览仍属于固定宿主面板，沿用原来的文件读取与恢复边界。
验证入口：`test/sidebar-layout.test.mjs`、`probes/sidebar-dock-browser.mjs` 和外部完整皮肤探针。
