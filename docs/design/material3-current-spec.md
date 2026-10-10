# Aibo 内置 Material 3

以 [Material 3 交互设计稿](material3-redesign.html)为视觉基准，是 Aibo 的默认内置外观。
本规范定义 Material 3 独立拥有的完整视觉；状态、功能与布局所有权继续遵循 [UI 架构](../ui-architecture.md)。
可选 ak-ui 的规则见 [ak-ui 规范](ak-ui-current-spec.md)。

## 接入与兼容

- 注册 ID 为 `material3`；入口是工作台设置 → 外观 → 界面皮肤。
- 经典蓝保留 `light` / `dark`；新增森林绿 `forest-light` / `forest-dark` 与紫罗兰 `plum-light` / `plum-dark`。
  所有配色均提供完整浅深版本，默认仍为经典蓝浅色。
- Material 3 经典蓝浅色为首次启动及无有效偏好时的默认外观。已有有效偏好保持不变，
  包括 ak-ui 和已选配色；切换内置皮肤保持当前明暗偏好，选择保存于原有外观存储键。
- 旧 Material 3 的 `ocean` / `sage` / `violet` / `daylight` 偏好继续迁移到 ak-ui；新增主题不恢复旧实现。
- 两种内置 adapter 共享无皮肤的行为组件，保留有状态组件身份；图标和状态图形分别实现。
  共享组件不得携带具体皮肤样式，Material 3 不继承 ak-ui CSS 或 `--ak-*` 令牌。
- 外部呈现包继续独立安装，未提供的 surface 继承当前内置选择；故障自动回退同样使用该选择。
  设置中的“恢复内置皮肤”显式选择 Material 3，保留明暗。切换与恢复不得丢失宿主拥有的数据。

## 配色选择

- 明暗使用「浅色 / 深色」分段单选；配色使用带名称、说明、色板和勾选标记的三张卡片。
- 切换配色保持明暗；设置与标题栏切换明暗均保持配色。选择立即生效并保存，下次启动恢复。
- 卡片色板跟随当前亮度，键盘 Tab 与方向键沿用原生单选操作。缺失亮度版本不可选。
- 新配色调整主色、选中容器、文字与中性表面，不改变几何、排版或交互；成功/警告/错误的语义不变，
  其中成功与警告按 M3 custom color 随主色协调，色值随配色变化。
- ak-ui 的颜色令牌和原有两张主题卡片保持不变；外部皮肤继续使用已有主题列表。

## 组件外观

- 经典蓝沿用设计稿；森林绿、紫罗兰各自提供主色与六级浅深表面，保留独立的成功、警告、错误语义色。
  `material3/themes.json` 是颜色与形状的唯一数据源，`--md-sys-*` 映射到宿主语义令牌，`--md-aibo-*` 提供本地密度、排版与动效。
- 组件数值以 Google 官方 Material 3 设计令牌（`@material/web` 随附，设计系统 34.x，含 Expressive）为准。
  每个配色提供完整颜色角色，包括 tertiary、inverse 与 on-error-container；缺失角色由 Material Color Utilities 从主色生成，
  成功与警告使用官方 custom color：由 Material Color Utilities `customColor` 以主色协调生成（color 用于文字与描边，
  color container 用于底色），不再手调。
  inverse-primary 取对应明暗版本的主色。形状只使用 0/4/8/12/16/20/28/32/48px 与全圆角；
  字号只使用官方字阶（正文与标签 14px、辅助 12px、标题 16/22/24px），字重为 400/500。
- 交互状态使用状态层：在原容器色上叠加内容色，悬停 8%、聚焦与按下 10%，不替换容器色；选中项保留选中色再叠加状态层。
  禁用时容器为 on-surface 10%、内容为 on-surface 38%。键盘焦点框统一为 3px secondary，
  独立控件外偏移 2px，标签、菜单项和列表行内偏移 3px。遮罩为 scrim 32%，不加模糊。
- 尺寸使用官方组件令牌：按钮与图标按钮为 S 40px，紧凑工具栏使用 XS 32px，标题栏按钮为 XS 32px；
  菜单项 44px，主标签 48px，新建会话为 Extended FAB 56px，侧栏收起时为 40px 小 FAB（12px 圆角）。
  信息密集的列表、表格与表单按官方[密度刻度](https://m3.material.io/foundations/layout/understanding-layout/density)使用 −3 档（每档 4px）：
  单行列表、导航抽屉项与输入框 44px，双行列表（如提交历史）60px，表格行 40px、表头 44px；输入文字为 body-large 16px；
  未单独设计的 `small` 文字使用 body-small 12px。
  密度只用于鼠标指针；触屏（`pointer: coarse`）下所有目标恢复到至少 48px。
- 收起的侧栏与右侧工具轨是 80px 窄导航栏，宽度由皮肤令牌 `--aibo-rail-width` 提供（未提供时为 56px）。
  通知按 Snackbar 使用 24px 图标、16px 左右内边距，单行高 48px。
- 形状形变使用官方 fast spatial 弹簧（刚度 1400、阻尼 0.9），以 CSS `linear()` 采样实现，时长 224ms；
  状态层透明度过渡使用 fast effects 弹簧。
- 保留现有桌面三栏位置、列宽调节、标准/专注/审查布局、紧凑标题栏与 760px 阅读栏。
  M3 只规定窗格（固定窗格 360/412px 与弹性窗格），不规定正文最大行宽；760px 是弹性内容窗格内的阅读宽度，
  属于布局而非组件令牌。
  导航项与 Git 文件行为 44px（密度 −3），元信息不低于 12px。
- 主按钮采用圆角填充样式，按下时圆角收为 8px；新建会话采用 primary-container 色调表面和 16px 圆角。
  次要按钮为 secondary-container，描边按钮为 outline-variant 描边加 on-surface-variant 文字，危险操作为 error-container；
  按钮标签为 14px/500，左右内边距 16px。
- 选择控件：复选框 18px、2px 圆角；单选框 20px，选中为 primary 圆环加圆点；开关轨道 52×32，
  未选中为 surface-container-highest 加 2px outline 描边与 16px outline 圆点，选中为 primary 轨道与 24px on-primary 圆点，按下 28px。
  三者均有 40px 圆形状态层。
- 设置中的单选分组使用 Expressive 连接按钮组：tonal 段为 secondary-container，间距 2px、内角 8px，
  选中段变为全圆角 secondary，不显示勾选标记。
- 导航选中使用圆角容器填充，去掉左侧信号边；主标签为 48px 高、14px/500，未选中 on-surface-variant，选中 primary，
  底部 3px primary 指示条带顶部圆角，标签状态层为直角；标签栏容器为 surface，下方 outline-variant 分隔线。
- 用户正文使用柔和色调表面，助手正文直接排在画布上；思考、工具与工具分组卡片使用完整四边轮廓和 12px 圆角。
- 窄窗口（≤1100px）会话标题区按 M3 top app bar 排两行：标题与尾部操作同一行，主标签在第二行。
- 卡片统一按 M3 card 使用 12px（corner-medium）：工具卡片、审批与提问卡片、设置分组以及外观中的可选卡片。
- 栏间拖动分隔按 M3 drag handle：12px 宽的栏间距内居中 4×48 全圆角手柄，颜色 outline，悬停与按下为 on-surface；
  栏间距按需求窄于 M3 的 24px 容器宽度，由皮肤令牌 `--workbench-splitter-width` 提供。工具面板收起时不保留右侧分隔栏。
- 执行记录保留四列表格与原有展开操作，使用 12px 圆角色调容器、柔和表头和圆形状态标记。
- 会话变更列表和 Git 提交展开后的文件行不绘制边界线，保留悬浮、焦点、选中反馈及差异预览。
- Composer 使用 28px 圆角与单线边框，聚焦时为 3px primary 描边，附件采用 8px chip；textarea 和提及绘制层保持相同文字度量。
  不改变发送快捷键、输入法处理、菜单、文件引用、粘贴、草稿及队列行为。
- badge 按 chip 使用 8px 圆角色调表面。模型矩阵按 M3 数据表使用 4px 圆角容器，以留白代替表格分隔线；
  当前模型使用柔和圆角底色，当前强度使用主色胶囊与勾选，未选可用项使用圆形标记，
  强度由列标题表达。Fast 使用胶囊开关，不绘制条形刻度、充能角标或扫光。
  桌面矩阵按密集表格：行与按钮高 40px、表头 44px、强度列最小 44px、列间距 2px，模型列约 120px；
  常规弹层内完整显示默认项及 low / medium / high / xhigh / max / ultra，长模型名省略并保留完整标题。
  触屏保持 44px 点击高度；更窄窗口保留横向滚动、固定模型列、默认选择、不可用项与键盘操作。
- 输入框按 outlined text field：4px 圆角、outline 描边，悬停为 on-surface，聚焦为 3px primary（1px 边框加 2px 内描边，不改变布局），
  错误为 error；不使用粗左侧信号边。单选、复选与开关保留原生键盘语义。
- 菜单按 Expressive 菜单：16px 圆角、surface-container-low、elevation 2、2px 内边距；菜单项最小 44px、间距 2px，
  圆角 4px，首末项外侧 12px，选中项为 tertiary-container 与 12px 圆角。
- 管理、确认、全局搜索、宿主面板与子 Agent 对话框使用 surface-container-high、28px 圆角与 elevation 3，无描边与顶部信号条；
  对话框标题 24px/400，正文为 on-surface-variant。设置分组为 outlined card：surface 底色与 outline-variant 描边。
  五类设置、全局搜索、恢复入口由宿主固定区域提供；Agent 审批在会话区域呈现，选择由宿主复核。
- 侧栏支持按窗口记忆的收起状态，收起后为 80px 窄导航栏（M3 navigation rail），顶部操作行保留 16px 上边距。展开时顶部切换按钮与新建会话并排；
  收起时上下排列，切换按钮位置固定。保留顶部切换、新建会话、工作区与会话入口，以及底部插件与设置。
  展开恢复原列宽，列表保持挂载以保留滚动位置；收起时隐藏列表、筛选和导航拖动分隔条，
  此时有等待审批或输入的会话，工作区与会话入口显示提示标记。
- 审批卡片使用警告色调表面，命令以等宽圆角代码块显示。卡片高度受可用空间限制，长命令详情独立滚动，
  操作按钮在窄窗口换行并始终可达。
- Agent 提问一次显示一题，标题、分页和底部操作固定在滚动内容外；规则见 [UI 架构](../ui-architecture.md#固定宿主区域)。
- 模型目录声明 `current-model` 时使用两个顺序选择器：先模型、后推理强度，复用 Select；规则与 ak-ui 相同。
- 回答中的网页、邮件与工作区文件链接显示对应类型图标；文件链接在右侧宿主预览面板打开，
  面板使用表面色、左侧分隔线和投影，当前行以悬浮底色加主色描边标出。
- Composer 选区使用 38%（官方禁用态透明度档）的主色背景，保证在提及绘制层之上可见；全局搜索命中使用 tertiary-container。
- 应用通知按 Snackbar：inverse-surface 与 inverse-on-surface、4px 圆角、最小 48px、elevation 3；
  图标为 inverse-on-surface，success / info / warning / error 由图标形状、标签和 live region 角色区分。
- 减少动态效果偏好继续生效。窄桌面窗口保持所有操作可达，沿用现有区域切换方式。

设置分区统一将标题和说明置于内容表面之外；Node 运行时、环境检测及插件管理沿用相同结构，分组内行共享外轮廓。全局搜索类别与范围分行排列，命令使用说明作标题、原始语法作辅助信息，插入提示只在命令分组显示一次。

## 验证

运行 `pnpm run verify`，并使用内置外观浏览器探针检查 ak-ui 与 Material 3 的浅深主题、
设置切换与重载、草稿/附件/焦点保留、菜单、Git、审批及布局。
外部呈现回归继续覆盖未提供 surface 的继承和故障恢复。浏览器原生 IPC 替身只验证 UI 合同，
不证明真实 Agent 执行、操作系统授权或原生持久化。

可复现的浏览器入口：

```sh
node probes/default-appearance-browser.mjs
node probes/material3-browser.mjs
node probes/material3-palettes-browser.mjs
node probes/material3-controls-browser.mjs
node probes/material3-spec-audit-browser.mjs
node probes/material3-records-browser.mjs
node probes/ak-ui-browser.mjs
node probes/sidebar-collapse-browser.mjs
node probes/approval-layout-browser.mjs
node probes/user-input-pagination-browser.mjs
node probes/toast-browser.mjs
node probes/file-links-browser.mjs
node probes/presentation-app-browser.mjs
AIBO_BUILTIN_KIT=material3 node probes/presentation-app-browser.mjs
node probes/presentation-full-skins-browser.mjs
AIBO_BUILTIN_KIT=material3 node probes/presentation-full-skins-browser.mjs
```

Material 3 工作台、设置与窄窗口截图默认写入 `/tmp/aibo-material3/`。

配色设置与六个工作台主题截图写入 `/tmp/aibo-material3-palettes/`。

`material3-spec-audit-browser` 用 `probes/fixtures/material3-official-tokens.json`（从 `@material/web` 官方令牌生成，标注版本）
逐组件比对渲染结果（包括行操作菜单）：按钮、图标按钮、连接按钮组、开关、复选框、单选框、输入框、菜单、对话框、遮罩、Snackbar、
主标签、FAB、导航栏、导航抽屉项与焦点框；唯一调整是上文声明的密度档位。报告写入 `/tmp/aibo-material3-audit/audit.json`。

此外 `probes/lib/material3-token-scan.mjs` 在各探针的每个截图状态（工作台、全部设置分区、六个配色、工具卡片、执行记录、
变更与提交历史、审批、提问、全局搜索、通知、控件、模型矩阵、菜单、收起侧栏与对话框）扫描全部可见元素：
颜色必须是颜色角色或其官方状态/禁用/遮罩透明度，圆角在形状阶梯上或全圆，字号在字阶上、字重为 400/500/700，
阴影为 elevation 1–3 或焦点环，可交互元素高度为官方组件尺寸或上述密度档位。豁免仅限：配色预览色块（内容本身就是其他配色），以及高度规则中的拖动分隔条容器与卡片
（M3 不规定二者的高度；手柄 4×48 与卡片圆角、颜色仍由审计检查）。

静态检查 `test/material3-token-conformance.test.mjs`（随 `pnpm run verify` 运行）覆盖探针打不开的界面：
Material 3 样式表中的每一条颜色、圆角、字号、字重与阴影声明，经主题目录和样式表内的别名解析后，
必须落到颜色角色（或其官方透明度档）、形状阶梯、字阶、400/500/700 与 elevation 1–3；描边环与边线也必须用颜色角色。

右侧辅助区采用固定工具轨（方案 B）：按 M3 窄导航栏，轨道固定宽 80px、surface 底色，入口 56px、间距 4px，
24px 图标位于 56×32 圆角指示器中，选中为 secondary-container；悬停或键盘聚焦均不展开，
名称通过图标提示和可访问名称提供。选中入口用选中底色，当前各面板可见视图另有小点标记。面板标题与更多操作
合为一行，添加视图在工具轨的加号中搜索。面板标题的更多菜单、工具图标右键或 Shift+F10 提供在下方打开、浮动、移回主面板、
调整工具轨顺序与移除；浮动面板保留移动、缩放和停靠。收起保留工具轨，再次打开恢复原列宽。
工具轨排序独立于分屏归属；布局与插件生命周期继续遵守[会话右侧工作区合同](../ui-architecture.md#会话右侧标签工作区)。
