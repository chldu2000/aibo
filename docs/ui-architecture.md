# UI 架构与组件库扩展

## 默认工作台：Aibo ak-ui

默认视觉已收敛为 `ak-ui` 一个注册项，提供 `light` / `dark` 两种主题，默认浅色。
实现采用 ak-ui 的 **system** 强度，并以 [交互设计稿](design/ak-ui-redesign.html) 为视觉基准：
侧栏不显示 Logo 或标语，以新建会话开始；导航、对话、上下文及管理面板在每个主题下保持统一明暗。

- `kits/ak-ui/themes.json` 是默认颜色、字体、间距和几何令牌来源；`ak-ui.css` 导入固定版本
  `@yunyoujun/ak-ui/tokens.css`，通过 `--ak-*` 与现有 `--aibo-*` 语义角色适配，不在运行时加载 CDN。
- `kits/ak-ui.ts` 注册完整 `UiKitAdapter`，复用已有 Svelte 控件的语义与行为，替换按钮、工作台、
  管理中心、确认弹窗和状态标记的视觉实现。旧 `shadcn` / `material3` 内置 adapter、组件目录和 CSS 已删除。
  仍使用的组合控件归入 `kits/ak-ui/`，无皮肤专属视觉的行为组件留在 `kits/shared/`。
  独立呈现包继续通过安装机制使用；不删除外部包或旧外观偏好的兼容迁移。
- `kits/ak-ui/Icon.svelte` 以设计稿的 24 单位网格与 1.6 单位描边实现完整语义图标集；
  发送采用上箭头，插件采用四格，设置采用矩形滑块，继承文字颜色并保留按钮可访问名称。
  插件提供的品牌标识保持原始路径；目标栏、模型和设置控件也统一使用 ak-ui 图标。
- `appearance-selection.ts` 仅迁移 `aibo.appearance.v1`：旧 `light` / `daylight` 转为浅色，
  其余已知旧主题转为深色。未知或损坏偏好回退到默认主题。外部包选择、消息、草稿、权限和工作区布局不参与迁移。
- `UiWorkbenchChromeProps.auxiliaryOpen` 是可选的宿主布局信息，缺省 `true`，不承载会话业务。
  窄屏在工作区、会话和辅助区域之间切换显示，既有内容保持挂载；桌面保留可调整列宽与标准、专注、交换侧栏布局。
- 会话导航的执行记录使用固定列清单（状态、命令/工具、耗时、时间），可展开原始参数或输出；
  变更入口打开已有 Git 面板，文件选择继续在中央展示真实差异。
  设计稿中的示例消息、用量和差异不会写入正式应用。
- `UiManagementCenterProps.restoreTriggerFocus` 缺省为 `true`。关闭普通设置后焦点回到触发器；
  设置期间请求更换呈现时为 `false`（包括包仍在异步激活的情况），将焦点与选区恢复交还宿主呈现状态存储，避免弹窗抢走编辑器焦点。
- 管理入口、审批及恢复快捷键仍由宿主持有；外部插件缺少的 surface 继承新的默认实现。

新增回归入口：`test/appearance-selection.test.mjs`（偏好迁移、无效值、主题表面与文字对比度）、
`test/default-ui-kit.test.mjs`（唯一注册项、旧入口兼容与未知选择）、
`probes/ak-ui-browser.mjs`（真实 App 主题、草稿、管理弹窗、响应式区域及减少动态效果）。
外部包继承与故障回退继续由 `probes/presentation-app-browser.mjs`、
`probes/presentation-full-skins-browser.mjs` 验证。探针使用替身 IPC，不能替代原生桌面授权或真实 Agent 验收。

### 侧栏密度与悬浮状态

- Git 面板按仓库选择/刷新、分支/上游/同步、变更/历史/审查、提交输入、文件分组顺序排布。
  单仓库也显示选择器；提交框常驻变更页，没有已暂存文件时禁用提交。批量暂存放在分组标题，
  分支管理保留在分支按钮下，远端刷新在分支展开区，暂存栈移到文件列表之后。文件分组使用通栏色带，
  行内展示状态、文件名、目录及增删统计；窄面板截断名称而保留操作入口。
  分组标题保持原有高度，数量默认可见，悬停或键盘聚焦时由批量操作覆盖；文件操作使用“暂存/取消暂存”文字。


- 会话条目仅在活动执行（运行、启动、压缩）时显示圆环动效，其余状态只改变 Agent 图标颜色。
  待审批、待输入、失败、已中断显示警告或错误标签并替代时间；正常和归档条目显示时间。
  所有状态保留悬浮提示和无障碍名称；减少动态效果时圆环保持静态。

- 工作区和会话行各预留一个 44px“更多”按钮；“在此新建会话”进入工作区菜单。悬浮、键盘聚焦
  和菜单打开时显示操作；触摸输入下常显，名称不会被操作覆盖或因悬浮改变宽度。
- 次要操作使用原生 Popover 顶层菜单，不受侧栏滚动裁剪；保留原有信任、目录、移除、归档、
  读取线程和改名回调。Escape 返回触发按钮，点击外部关闭。Agent 选择器对齐触发按钮下沿。
- 上下文以单层分区排版，统一 16px 水平边距、12px 分区留白与 8px 标题间距；能力组采用
  标签/内容两列，长标识截断并保留完整值。Git 分支、HEAD 与同步状态紧凑排列。新增菜单保持至少 44px 的点击高度；
  Git 仓库选择和工具栏紧凑按钮通过外扩命中区域保持至少 44px 点击高度。
- `probes/ak-ui-density-browser.mjs` 覆盖长名称、悬浮前后几何、菜单焦点和路由、多 Agent、
  多仓库、浅深色、窄桌面与信息区高度，避免仅用静态无悬浮截图验收。

### 字号、选中与表单（2026-09 改版）

视觉目标以 [交互设计稿](design/ak-ui-redesign.html) 为准。

- 字号只使用三级令牌：`--aibo-type-body`（14px，消息正文）、`--aibo-type-ui`（13px，控件）、
  `--aibo-type-meta`（12px，元信息），由 `themes.json` 提供；`base.css` 以同值作为外部主题的回退。
  皮肤 CSS 与皮肤组件不得出现小于 12px 的字号，`test/ui-style-boundaries.test.mjs` 检查此下限。
- 选中只有两种语言：标签页（侧栏、Git、会话视图、窄屏区域切换）使用底部 `--ak-line-strong` 信号条并加强文字，
  不改底色、不加分隔线；列表与导航使用左侧信号条加选中底色。`aria-pressed` 开关只用选中底色。
  普通按钮和主操作按钮悬停不绘制底部信号条；保留各按钮的底色反馈和键盘焦点轮廓。
- 表单遵循 ak-form：方角、1px 边框加 4px 左侧边，聚焦时整圈边框变为焦点色并加 3px 光晕；
  Composer 作为一个整体表单字段，不使用切角或额外装饰条，内部文本框不再绘制第二个焦点框。
- Git 变更文件行使用设计稿的 36px 高度，文件状态徽标为 18px 方形；文件名完整优先，目录从左侧截断。
  仓库选择与提交输入框为 36px，刷新、同步、审查和提交按钮为 32px，文件分组标题及暂存栈标题为 36px；
  分支菜单中的输入与创建按钮按相同密度处理，菜单列表仍保留原有行高。工作区、会话行与 Git 页签保持 44px 最小高度，Git 提交历史
  保持两行信息与至少 44px 高度，不套用紧凑文件行规则。
- 已信任工作区使用成功语义；变更计数使用中性徽标，黄色只表示主操作或需要处理的事项。
- `ak-ui.css` 不写原始色值，颜色统一来自主题令牌；禁止全局 `*` transition 覆盖。
- 消息正文使用 14px/1.75；默认完成状态不占徽标，运行、排队、中断和失败仍可识别。
  会话头部在宽桌面约 64px，窄屏标签另起一行，底部状态栏隐藏。
- Composer 使用原生 `field-sizing: content`，限制最大高度并保留内部滚动；手机附件仅占一行，
  横向滚动容器限制在附件列表内，不能使整个页面横向溢出。
- 单一内置皮肤显示信息行；主题卡片使用原生 radio。设置关闭沿用右上角按钮和 Escape，
  返回原触发器或由宿主恢复呈现焦点；不再额外提供“完成”页脚。
- Agent 标签与图标取自插件声明；选择器可以展示已安装但不可用的提供者及原因，禁用其入口。
  会话创建仍使用独立的就绪集合校验，不把展示状态作为授权。
- Git 文件统计通过可选 `stagedStats` / `unstagedStats` 传递，分别来自原生 numstat；旧数据、二进制、
  冲突和未跟踪文件可缺省，不能当作零行。悬浮/键盘聚焦时显示暂存操作，触屏常显。
- `base.css` 仍承载共享布局和外部呈现缺失 surface 的回退；只有没有消费者的旧样式才删除，
  不以默认 ak-ui 覆盖了某个声明为由删除共享行为。删除共享样式时同步检查脚本里的类名选择器，
  共享层不得依赖某一套皮肤的类名判断模态状态，改用原生 `dialog[open]`。
- 每个断点条件在 `ak-ui.css` 中只出现一次；媒体查询规则必须排在同选择器的无条件规则之后，
  否则该规则永远不生效。`test/ui-style-boundaries.test.mjs` 同时检查条件唯一和这种遮蔽。
- 主题选择使用原生 radio，radio 铺满整张卡片且视觉隐藏（保留键盘焦点与 `:focus-within` 描边），
  选中由卡片边框、左侧信号条和勾选标记表达；色板是唯一的颜色预览，不能隐藏。卡片 64px、只显示主题名。
- 管理中心对话框 `min(880px, 100vw - 32px) × min(620px, 100dvh - 64px)`，顶部 3px 信号边；标题行单行 20px，
  不用 muted 底色；栏目导航是 44px 单标签行、贴边信号条；内容区 `16px 24px 24px`，分组和标题不再各自内缩 20px；
  设置行 56px、`8px 16px`、方角、raised 底色。对话框正文 13px。关闭按钮保持真实 44px 控件，
  因此标题行比设计稿高 12px，这是已记录的命中区边界，不是遗漏。
- 手机区域切换在 `WorkbenchChrome.svelte` 与皮肤共用 `max-width: 760px` 断点；两者不一致会在 760–900px 之间
  出现标题已换行、区域仍三列的中间态。
- 阅读区只有一条内容栏：宽度 `--workbench-content-width`（760px），左右留 `--workbench-content-inset`
  的水平留白。消息流、Composer 与两者之间的次级条（目标、用量、重试、队列、草稿状态）共用这条栏并居中对齐，
  不各自设定外边距。内容栏的水平留白必须是固定令牌，不能用随视口缩放的 `clamp()`，
  否则留白会先吃掉栏宽、使 `max-width` 永远不生效。
- 消息流用 `display: grid` 加单一 `gap` 控制节奏，条目自身不带外边距；工具与执行记录需要更紧的间距时，
  从 gap 里减，不是在 gap 之上再加一层外边距。
- 窄屏断点为 `max-width: 760px`，与设计稿一致：会话标题独占一行，会话视图标签移到其下一行并可横向滚动。
- 底部状态栏是纯文本行，高度 28px，不受 44px 命中区下限约束；一旦放入可交互元素就要回到 44px。
- 侧栏行贯穿整个面板宽度，选中行的 3px 信号条贴在面板边缘；侧栏本身不留内边距，
  只有新建会话按钮带 12px 外边距。会话行 28px 缩进写在行自身的内边距里，不放在分组容器上，
  否则选中底色和信号条会随分组一起内缩。
- 侧栏行的悬浮是行级的：工作区行和会话行在鼠标落在行内任意位置（含“更多”区）时整行填 `--aibo-hover`，
  内部按钮自身不再填色、不画底部内嵌线；选中会话在悬浮时保持选中底色和信号条。
  base 层给行容器的 `--aibo-surface-hover` 与侧栏底色相同，在 ak-ui 下不可见，不能拿来当悬浮反馈。
- Inspector 使用 panel 表面（比画布浅一档）并带左侧分隔线；标签条内缩 8px、标签等分。
  默认宽度 340px（`workbench-layout-storage.ts`，应用层、与皮肤无关）；用户已保存的宽度不受影响。
- 消息元信息 12px；工具组是无内边距的带边框列表，组摘要行 44px、13px、左右 12px，展开后的工具摘要行 36px。
- 新建会话按钮通过 `clip-path` 切角，不再叠加底色三角；键盘聚焦和禁用时取消裁剪以保留完整轮廓。
- 执行记录四列宽度在所有行保持一致，命令/工具列按余量伸缩并截断，展开后原文完整显示。
  时间来自记录的 `createdAt`；终态记录的正值 `updatedAt - createdAt` 显示为观测间隔（悬浮说明），
  不是提供者上报的 CPU 时间。缺失、无效、同时间戳快照或未结束记录的耗时显示“—”，不伪造 0 秒。
  展开状态以会话和条目共同标识，旧记录缺少时间字段也能阅读。
- Git 提交历史逐行贯穿面板宽度并以细线分隔：标题和相对时间在首行，短哈希与作者在次行；
  长标题在时间前截断，完整标题与时间保留悬浮提示。选中行使用左侧 3px 信号条和选中底色，悬停保留选中反馈。
- Composer 自身没有内边距：文本区 `12px 16px`、工具条 `4px 8px 8px`、附件条 `8px 12px 0`，
  附件为 32px 方角 raised 芯片、22px 缩略图、30px 移除按钮。手机端 Composer 左右各留 8px（消息流留 12px），与设计稿一致。
- 通过“+”或粘贴加入的附件只以芯片显示（名称加 `sizeLabel` 大小，由应用层格式化后经 `UiAttachmentListProps` 传入，
  kit 不引用应用代码），Composer 不再显示“上下文 n 项 约 xxB”汇总行。
- `@` 引用在文本行内渲染为小标签：`.composer-mention-layer` 是文本区背后的镜像层，按插入规则（`@` 到下一个空白）
  切分草稿并把引用包成 `<mark class="composer-mention">`；文本区自身字形透明、只保留光标与选区，并把滚动同步给镜像层。
  镜像层必须与文本区盒模型完全一致（内边距、边框、字体、行高、换行、滚动条槽），标签不得增加水平内边距，
  否则光标与绘制文字错位。机制放在 `base.css`（外部皮肤同样得到对齐的文本），ak-ui 只负责镜像自己的文本区盒子和标签配色；
  `probes/composer-input-browser.mjs` 断言两者盒模型、字形透明、标签与滚动同步。
- Inspector 各分区贯穿面板宽度，分隔线通铺，内容 `8px 16px 16px`，不再是内缩的卡片。
- 窄屏区域切换条不留内缩，标签等分、13px。
- 除 Git 面板已按设计稿收紧的控件外，发送、头部工具、其他分区刷新等控件保持真实 44px，因此这些工具条与分区标题比设计稿的 32px 控件各高约 8–12px；
  这是命中区边界的一部分，不再逐项列出。
- `probes/ak-ui-browser.mjs` 在桌面和手机两个视口把实际应用与设计稿并排测量，断言内容栏宽度、
  节奏与 Composer 对齐一致。跨视口测量前必须等布局稳定，否则读到的是上一个视口的留白。

逐项进度与验证边界见 [修复记录](design/ak-ui-repair-progress.md)。

### 色彩层级

统一明暗不再要求各区域只有细微色差。ak-ui 的 system 模式使用四个中性表面：
画布承载阅读区域，muted 区分导航和分区标题，panel 承载内容，raised 区分编辑器与浮层。
浅色全部保持浅底，深色全部保持深底；边界线清晰区分相邻区域，避免仅靠透明背景划分。
画布采用 ak-ui 官网的浅底 `#e9ebe7` / 深底 `#111315`，周边表面使用中性灰。
信息蓝和主操作黄直接引用已安装的 ak-ui 1.1.0 `--ak-color-blue`（`#22bbff`）与
`--ak-color-yellow`（`#ffd802`）；浅色焦点及蓝色文字使用同库的
`--ak-color-dark-blue`（`#0075a8`），避免亮蓝在浅底上对比不足，黄底按钮始终配深色文字。
官网来源：[ak-ui](https://ak-ui.yyj.moe/) 与 [Token 合同](https://ak-ui.yyj.moe/guide/tokens)。
底色是官网配色，蓝/黄/深蓝是库令牌；各层中性灰和浅蓝/深蓝选中底色是 Aibo 的适配。
蓝色及线条表示当前页签、会话与焦点；黄色用于主操作；警告、成功、危险分别使用
独立的黄色、绿色、红色文本及底色，不把所有状态都映射成同一种强调色。

Git 分支信息采用扁平工具栏，分组标题以中性色带与文件内容区分；选中页签使用底部信号条和加强文字，不增加底色。
上下文、对话、工具输出、管理导航和设置行复用相同表面规则。状态标签保留原有文字、
图标和语义，不依赖颜色辨识。新颜色只归属内置主题令牌和皮肤样式，不修改外部呈现包。
主题对比度测试覆盖正文、辅助信息、成功/警告/危险和主操作；浏览器探针检查真实分区
底色、选中态、明暗一致性及交互回归。

## 新增工作区的默认信任

宿主“工作台设置 → 工作台 → 工作区”提供“新增工作区默认信任”，初始开启。
原生 `workspace_preferences` 单例表保存该偏好，`read_workspace_preferences` /
`save_workspace_preferences` 只由宿主管理界面调用。界面仅在原生保存成功后确认开关值；
读取失败时禁止修改并提供重试，浏览器预览不保存原生设置。

`add_workspace` 在插入时直接读取这项数据库偏好；所有添加入口共用此行为，不接收呈现插件传来的信任值。
迁移、修改偏好、重复添加已有目录均不改变已有工作区的信任或权限代际。单个目录仍可在“更多”中调整信任，
上下文保留信任说明，侧栏名称旁不再显示状态圆点。默认信任不替代运行时能力、执行配置或逐操作审批检查。

`test/workspace-preferences.test.mjs` 验证读取、保存、失败回退和异步竞争；
`probes/workspace-preferences-browser.mjs` 验证真实 App 的开关与创建入口（替身 IPC）；
Rust `workspace_preferences::tests` 使用临时 SQLite 数据库验证迁移、重启、重复添加和手动撤销后的状态保留。

## 当前 Presentation 架构

根据 [ADR-0008](adr/0008-unified-presentation-plugins.md)，皮肤与 Presentation
统一为一种插件，主题、控件、语义视图和工作台是可选定制范围。UiKitAdapter
继续作为内部完整视觉合同。外部包已支持独立安装与隔离执行，双皮肤 0.3.0
已完成 P0–P4 验收，见[交付说明](presentation-release-0.3.0.md)与
[退出审计](presentation-plugin-exit-audit.md)。下文带阶段编号的内容保留实施语境，
阶段性未完成描述以最终审计为准；旧 skin/Presentation 分层不表示两种独立产品插件。

P1 外部包数据合同位于 `packages/plugin-protocol/src/presentation-package.ts`，
对应 `contracts/presentation-package.v1.schema.json`。平台无关的包校验位于
`src/lib/presentation-runtime/package.ts`，资源读取由调用方注入；生成验证器
不在运行时编译 schema。合同已接入 App 的“安装皮肤插件”入口，与能力包的
安装和执行资格分开校验。

P2b 可执行包使用 `presentation-runtime/sandbox.ts` 装配：静态隔离文档运行宿主
绘制桥，包代码仅在可终止 Worker 中计算视觉树。该树有明确标签、属性、事件和
资源范围，与能力插件的业务语义数据分离；不是将 Svelte Component 序列化到
消息中。主 WebView 不执行包代码。Tauri CSP 的 worker-src 明确允许 blob Worker，
隔离文档另加 connect-src none 等限制，不扩大主文档脚本或网络来源。

P2c 的 `PresentationHost` 与 `WorkbenchPresentation` 都是宿主生命周期装配，
不作为另一种用户可选插件。App 向前者传递数据与动作回调，并将原工作台作为
继承内容；外部主题的视觉 token 在 UI kit 内应用到工作台，不能进入宿主管理
区域。安装/选择的串行事务由框架无关的 presentation-package-controller 持有，
原生存储与 UI 挂载通过注入端口连接。完整角色覆盖进度以重构清单为准。

独立 semantic 角色由 UI kit 的 SemanticView runtime 门面接入，UiKitAdapter
仍提供完整默认实现。只有激活后的窗口内注册可以进入外部语义 renderer，安装
声明本身不加载代码。四类预检通过后才提交选择；每个实际实例继续校验快照格式，
失败时保留原 props 降级。专业/核心动作都使用宿主快照身份，不接受插件任意 IPC。

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
4. `src/lib/ui-kit/kits/ak-ui/` 提供默认视觉，复用 `src/lib/components/ui/` 的已有基础行为。

应用的视觉 CSS 也属于 UI kit 边界：`src/lib/ui-kit/kits/base.css` 提供跨皮肤
共享的语义样式与动效，`ak-ui.css` 负责默认工作台的覆盖；
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
当前默认提供浅色与深色，原 Zinc、Blue、Emerald、Light、Ocean、Sage、Violet、Daylight 均按上述规则迁移。

默认皮肤的颜色、字体、间距和几何由 `kits/ak-ui/themes.json` 定义，再映射到
基础控件的 `background`、`foreground`、`primary`、`border` 等语义别名。
重复视觉决策优先使用 `--ak-*` 令牌；正文和辅助信息应保持可读尺寸，不能用缩小
警告、状态或文件名换取紧凑。目标、队列、输入框共享内容边界；文件名优先显示完整，
目录作为次级信息；面板以矩形和细线为主，控件可采用 `--ak-radius-subtle`。

旧内置 Material 组件及其构建插件、Material Symbols、Lucide 和 shadcn CLI 依赖
已移除。仍使用的本地基础原语保留于 `components/ui`；这不代表保留旧皮肤注册。
开发入口仅支持默认 `ak-ui`，外部皮肤走呈现包安装机制。

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

## 能力与呈现边界

旧 Agent View 协议的渲染组件、动作 IPC 和视图轮询已删除。能力插件提交能力结果与会话领域事件，由宿主验证并投影；呈现插件消费宿主的语义快照和动作合同。SemanticView 与 WorkbenchPresentation 继续通过 UI kit 装配，管理入口和默认呈现恢复由宿主保有。

插件管理面板的新建会话入口从 session scope 的 aibo.session.open 能力贡献发现，不读取旧 manifest.agents。皮肤不拥有能力选择、会话状态或执行权。test/plugin-management.test.mjs 检查旧视图入口缺席及能力贡献发现，现有语义呈现测试继续检查合同、降级和动作权限。

侧栏新建会话轮盘和外置工作台同样从该贡献目录发现 Agent，只显示已安装、已启用、可运行且贡献依赖就绪的提供者。创建动作携带安装实例和 contribution ID，宿主在执行时再次校验；安装、启用、卸载、窗口聚焦和打开轮盘时刷新目录，轮盘打开期间每五秒检查依赖就绪状态。轮盘每圈最多六项，新增 Agent 无需修改页面或皮肤。

Agent 品牌图标属于能力插件：Manifest v2 的 capabilityProvider 可声明 `icon: { path: "M…" }`，坐标固定为 24 × 24、长度不超过 8192 字符，仅接受 SVG path 命令和数字，不接受 SVG 文档、URL、脚本或样式。宿主校验后将纯数据传入 `AgentStatusMark.icon` 及导航合同，所有皮肤用 currentColor 渲染；缺省图标使用通用菱形。Codex、Pi 的路径与版权说明由各自插件持有，UI kit 和外置呈现包不维护品牌映射。会话列表和会话引用使用对应安装实例的图标。`test/ui-style-boundaries.test.mjs` 检查此边界，manifest 和会话提供者测试覆盖校验、就绪过滤与失效动作。

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
并由当前皮肤 CSS 按需覆盖。边界测试会阻止应用层继续新增视觉声明；新增的
共享表现规则应放入 `base.css`，只属于某个皮肤的规则放入对应的 skin 文件。

## 当前拆分边界

- `App.svelte` 保留 API 装配、Agent 事件入口、跨面板状态和页面生命周期；控制器通过依赖注入承载可测试的业务动作。
- `WorkspaceSidebar`、`TimelinePanel`、`Composer`、`Inspector`、`SettingsPanel`、`WindowTitlebar` 和 `AppOverlays` 只负责展示与用户事件转发。
- `view-models.ts` 负责领域对象到 UI 窄模型的纯函数投影；新增领域字段不会自动泄漏到页面组件。
- `AlertDialog` 也属于 kit adapter 的契约。当前 ak-ui adapter 提供原生 dialog 实现，外部 kit 可以提供自己的弹窗实现。
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
+`SemanticView` 是 `UiKitAdapter` 的新增必需成员，由 runtime proxy 转交当前皮肤；当前 ak-ui 实现，视觉/焦点/disabled 样式留在 kit 内部，未引入 optional 豁免。`PresentationProps` 中的 layout 和 onAction 是可信本地 renderer 参数，不属于能力数据合同。
+
+Svelte 与最小 DOM adapter 均提供 mount/update/dispose 并消费相同 fixture。默认产品入口使用可信 Svelte 工作区组件，adapter 验证入口位于 `probes/semantic-ui.html`；最小 DOM renderer 不作为产品工作台发布，也不加载第三方脚本。JSON schema 验证器在开发阶段生成，运行时不调用 eval/Function，保持现行桌面 CSP。
+
+具体协议和验收见 [P1 实施记录](archive/plugin-platform-p1-semantic-slice.md)。

## P2 宿主状态与整窗呈现生命周期

插件工作台复用主会话的列表、选择、草稿及时间线投影。窗口导航使用独立存储键；可恢复状态按工作区/contribution 分离，草稿与核心历史仍使用 Core session 存储。

`presentation/presentation-contract.ts` 只定义 JSON 快照与动作；`app/presentation-controller.ts` 通过注入的本地端口管理预检、generation、挂载、清理和失败恢复，不依赖 Svelte、DOM 或具体 API。`workbench/PresentationSurface.svelte` 将其接到本地 Svelte adapter，切换期间使用 inert 限制交互，视觉仍由 UiKitAdapter 提供。宿主装配组件本身不引入新皮肤。

`WorkbenchPresentation` 经 `$lib/ui-kit` 导出为可信宿主装配，复用生命周期控制器切换标准/专注会话布局，dispose 后真正重新挂载整个 App 可视子树。App 根状态、Agent 订阅与执行保持在子树之外；切换/默认恢复入口也在子树之外。`workbench-contract.ts` 是 JSON 上下文与动作，Svelte snippet 和本地函数端口不进入公共协议。此实现不加载第三方 UI 脚本，不代表 P4 Presentation Plugin 发布已完成。

App 中所有业务回调和可写绑定经 generation、当前工作区及会话检查；`test/p2-boundaries.test.mjs` 通过 Svelte AST 检查这些入口并禁止 Shell 导入 Agent 生命周期 API。切换期间 inert，挂载失败回到标准呈现，焦点使用语义 ID。App/Git 提交说明、分支名和插件表单由宿主持有，并在窗口命名空间持久化；会话 Composer 草稿继续使用 Core session 持久化。默认与外部皮肤继续提供同一视觉合同，新增 CSS 仅控制布局。

验收包括两套皮肤的模型矩阵、两种 Git 布局、真实桌面流式切换/应用重启/窗口隔离，以及浏览器故障注入。详见 [P2 记录](archive/plugin-platform-p2-agent-state.md)。

## P3 安装目录与激活诊断

插件管理面板允许安装记录没有旧 `agents` 数组，显示宿主返回的激活诊断，并在不可运行时禁止启用；已启用插件始终保留禁用入口。现有 v1 新建会话和卸载入口保留。Registry 返回的统一 contributions 是数据目录，不由管理面板执行；声明式贡献自动挂载将在 Broker/扩展点合同就绪后接入。此批不修改 UiKitAdapter，也不添加皮肤分支或视觉样式。

P3 第二批增加宿主注入窗口身份的 capability IPC 与类型化 API，输入不接受 caller、permission 或 workspacePath。只读 capabilityProvider 可独立激活；App 不负责执行或管理进程，不因 capability 的名字选择 Provider。语义贡献自动呈现仍待后续实施，当前管理面板继续显示未支持贡献的激活原因。

第三批由宿主返回包依赖诊断及受影响 contribution ID，管理面板展示固定版本和不可用原因：必需依赖失效阻止启用，可选依赖失效只提示相关功能停用，保留其他功能的启用入口。安装卡片以插件显示名提供可访问标签；继续复用 UiKitAdapter，不新增皮肤样式或契约字段。

P3 第五批通过 `InstalledWorkbench` 和纯数据端口接入已安装语义贡献。App 从宿主目录生成工作区工具命令，按 installation/contribution 标识打开页面；不根据 Git 名称或皮肤选择渲染实现。快照仍经 PresentationSurface 和 UiKitAdapter 校验、挂载与切换，新增组件仅使用已有 Button/Card，CSS 只包含布局。目录变化关闭失效工具，卸载后不保留可执行动作；导航状态按窗口/工作区/贡献/release 隔离。既有 P1 固定只读命令退出主界面，参考端口与测试保留。


## P3 稳定语义贡献

安装贡献由宿主解析 application/workspace/session 上下文，并通过统一命令入口打开。页面只传语义 scope、数据和动作，不指定皮肤或固定物理面板。SemanticView 继续是 UiKitAdapter 必需成员；默认与外部呈现共同支持 collection/detail、只读 settings 和 inspector，未增加 optional 例外，也未放宽 app 层样式规则。

稳定合同为 contracts/semantic-view.v1.schema.json，原 experimental-v1 schema 独立保留；生成验证器同时读取两者，不能用新字段重新解释旧版本。settings.page 的 workspaceId 为 null，session.context/session.action 必须有 sessionId 和所属 workspaceId。宿主 lease 验证当前上下文、revision、窗口与启用状态后才调度只读能力。P4 再接入编辑、写入审批及任意呈现插件。

架构检查继续覆盖纯数据边界、双皮肤必需成员和 workbench 视觉边界；test/semantic-stable.test.mjs 验证稳定/旧版本读取、作用域伪造与通用 inspect 选择。双 renderer 与双皮肤证据见 [P3 收尾记录](archive/plugin-platform-p3-completion.md)。

## P4 呈现协商边界

[ADR-0007](./adr/0007-presentation-core-and-fallback.md)将必需核心语义与可选专业呈现分开。renderer-contract.ts 只包含纯数据描述；app/renderer-negotiation.ts 验证描述符并选择专业呈现或相同数据的核心视图。当前默认呈现通过可信构建模块登记，工作台和语义视图均在预检时验证合同；没有新增任意代码加载通道或 UiKitAdapter optional 成员。

workbench 的架构检查递归覆盖子目录，包括 plugins 中的可信呈现模块；新目录不能绕过皮肤隔离、纯布局 CSS 或 API 依赖限制。工作台已改为命名槽位装配；正式专业呈现和完整布局退出矩阵仍需后续验收。

### P4：宿主区域与呈现实例边界

`App.svelte` 直接持有命令面板、窗口标题栏、插件管理、执行历史、会话历史、插件调用历史、设置和诊断；这些组件位于
`WorkbenchPresentation` 的命名槽位之外，不随 renderer generation 销毁。
插件管理打开时仅隐藏工作台内容，恢复控件仍可访问；关闭管理后显示同一工作台。
插件管理操作通过宿主上下文门检查工作区和会话，窗口控制不依赖呈现实例授权。
呈现内部的回调与可写绑定继续通过 generation gate。架构测试分别验证两种边界，
禁止将宿主组件重新放回可替换 snippet。执行历史控制器按独立选择的工作区读取
任务与工作区写入记录（含 Git 与整轮恢复），按时间/类型/ID 的稳定游标翻页；关闭只释放读取订阅，停止请求使用原工作区/run ID，工作区写入
仍由宿主核对调用窗口。历史游标中的 `git` 保留为旧写入来源键，不代表工作区必须使用 Git。会话历史使用只读 Core 消息分页接口，包含归档会话，选择不改变工作台会话；能力生命周期审计另有只读宿主入口，窗口身份由 Tauri 注入，不依赖 Provider 或作用域资源仍存活。任一来源读取失败时禁止向更早处推进游标，避免遗漏记录。
默认呈现插件 `DefaultPresentationActions.svelte` 根据 conversation/navigation/diagnostics/appearance
语义区域选择入口：专注图标位于会话标题，会话历史位于工作区工具区，执行历史收入诊断，
导航位置与恢复默认呈现收入外观设置。各面板只提供可选 snippet，App 注入宿主操作；
入口选择不进入业务模块，也不新增常驻布局控制行。按钮与图标复用 UiKitAdapter 已有原语，
`focus` 图标语义由当前皮肤映射，具体外观仍由皮肤决定。后续呈现插件可替换这些区域的入口选择。

宿主持有命令面板的历史、专注与恢复命令；Ctrl/⌘+K 在宿主管理页同样可用。
恢复的 Ctrl/⌘+Shift+Backspace 捕获监听和错误提示中的恢复按钮位于呈现实例之外，
不受呈现卸载、暂停或代际门控影响。正常工作台不常驻显示恢复按钮。
历史进入时聚焦标题，Escape 返回入口焦点；原诊断入口已卸载时回到标题栏诊断按钮。

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

现有 UiKitAdapter.SemanticView 的本地 props 增加语义选项 `detailPresentation: plain | numbered`，当前 ak-ui 通过 SemanticView 包装呈现。专业视图继续显示全部属性、状态、截断提示和原动作；行号为辅助视觉，屏幕阅读器不会将行号混入文本。安装视图允许切换到通用阅读，不改变快照、输入和宿主权限。

专业视图最多生成 5,000 个文本行节点，首次挂载或更新超出限制时由呈现生命周期控制器回退到完整文本的核心视图，保留当前布局。限制只影响呈现方式，不截断底层内容。专业实现的限制与宿主快照大小限制分别验证。

槽位第二参数提供 `growthDirection: 1 | -1`，表示分隔条向右移动时目标区域宽度的增长方向。方向由呈现中的实际顺序计算，App 的列宽偏好更新不再假定导航固定在左侧。布局重新挂载时宿主清理旧拖动监听，旧指针移动不能继续修改新布局。standard/focus/review 都可作为窗口级持久布局，独立恢复入口始终返回 standard。

### P4：减少动态效果

`kits/motion.css` 属于 UI 层，统一处理 `prefers-reduced-motion: reduce`，包括皮肤控件、伪元素及 body 浮层。近零时长保留组件完成事件，取消延迟、无限循环及平滑滚动；各皮肤继续提供运行状态的静态反馈。App 和业务模块不根据动效偏好改变执行行为。浏览器探针同时验证普通模式存在动效及减少动态效果模式的实际计算样式，媒体参数本身不作为通过证据。

### P4：可用焦点恢复

工作台呈现同时保存焦点标识与“曾获得焦点”的状态。原目标不再可用时，恢复到可见、可交互控件；禁用、hidden/inert/aria-hidden、无布局区域的目标不能接收恢复焦点。聚焦后检查 activeElement，不能因为找到同名非交互容器就停止回退。工作台被宿主管理区域暂停时不抢焦点；这一规则不改变业务动作的代际和上下文校验。

### P4：快照读取能力必须显式声明

RendererDescriptor.semanticVersion 描述必需核心语义，snapshotSchemas 描述实际快照格式。未声明后者的旧 renderer 只能读取原只读格式；v1.1 写动作需要显式 opt-in。描述符验证拒绝未知、重复或缺少稳定 v1 的列表，协商在选择专业实现之前检查格式支持。默认可信呈现明确声明 experimental-v1/v1/v1.1；该声明不改变原生审批与 Capability 权限。版本支持表见 ADR-0007。

## 会话能力迁移中的执行边界

通用会话发送、取消、恢复和关闭入口必须拒绝没有插件绑定的旧会话，不能回退到原生执行。调用者窗口身份传入 SessionHost，再由共享能力 Broker 执行。呈现层继续消费宿主事件；执行失败事件也必须先持久化，再通知界面。`test/p2-boundaries.test.mjs` 检查这些通用入口；其他旧专属入口仍在迁移中，本规则不表示旧运行时已完全退役。

前端能力门面、会话树控制器与模型配置服务不再接收旧执行回退。无插件绑定的历史会话拒绝能力调用和模型配置写入；其历史展示仍可独立读取。对应回归见 agent-facade.test.mjs 和 model-configuration.test.mjs。

旧 PluginHost 实现已删除。SessionHost 只能调用共享 Broker，不能创建插件进程；架构检查禁止重新接入旧 Host 或在会话宿主中直接启动进程。旧 Agent 视图动作暂保留拒绝执行的 IPC，后续随旧呈现 API 一并删除。

Codex/Pi 原生管理器已删除。线程目录通过 workspace scope 的能力贡献读取，
会话快照和分支通过会话绑定的能力调用；App 的原生兼容 API 重导出层也已删除。
架构检查禁止重新编译旧管理器。

## 外部 Presentation 控件

PresentationHost 通过内部上下文限定外部控件的生效范围。ModelMatrix 与
AgentStatusMark 的 runtime 包装层消费当前统一 Presentation 选择，经纯数据
投影进入隔离运行时；应用层仍使用相同 UiKitAdapter 接口。宿主设置和审批没有
此上下文，因此保留可信控件。

外部控件的 null 返回、运行失败及未声明角色均继承完整默认实现。公开数据类型
位于 plugin-protocol，不包含 Svelte、DOM 或回调。宿主保留模型动作权限校验和
状态标记的可访问名称、父行点击与焦点行为。这个首批目录不代表所有内部控件均
已开放外部替换。

### 外部工作台导航与宿主确认

工作台导航通过公共纯数据合同和宿主生成的事件目录接入。App 只投影状态和调用
既有导航/会话/工作区控制器，不接受皮肤提交的任意 API 名称或操作参数。搜索和
改名输入采用宿主逐快照维护的本地编辑许可，权限与目标身份在执行前重新解析。

AppOverlays 属于独立宿主区域，与审批及设置一样位于 PresentationHost 和
WorkbenchPresentation 之外。归档、Pi 分支导航确认和应用通知不再装入可替换的
overlays 槽位；该槽位仍承载可替换的 Pi 会话树。确认期间暂停默认与外部工作台。
架构测试检查宿主组件的整个祖先区域，而不只检查 snippet，防止它们被外部整窗
替换隐藏；保留六个工作台槽位的回调门禁。

### 会话投影与回答草稿

外部整窗呈现通过 PresentationConversation 读取会话/Composer 数据，操作目录用
不透明 token 绑定宿主选定的目标。目录随当前业务状态重算并撤销旧条目，输入
许可不得跨会话或问题轮次复用。包可定制回答的视觉，但不会获得直接的能力调用。

用户问题回答草稿由 App 持有。TimelinePanel 通过 props 和受 guard 包装的回调
读写同一份草稿，外部工作台通过操作目录读写；它们不各自持有随皮肤销毁的答案。
结束请求的草稿及时清理，当前会话以外的回答不进入当前呈现快照。

### 工作台 Git 投影

GitPanelState 复用公共 PresentationGitDrafts 数据合同。App 将已有 Git 状态及
差异预览投影给外部工作台，用宿主操作目录回调已有控制器；默认面板继续消费
同一份草稿。外部包不能提交自由路径、分支或写命令名称。

会话和 Git 目录共用 action-directory：在当前作用域分配不透明句柄，移除条目
或离开作用域即撤销，回到原作用域也不复用。点击保持严格 revision，本地输入
只对当前目录的明确 input 条目开放。业务权限仍由各目录及原生执行边界校验。

### Inspector 预览生命周期

Inspector 的产物预览由注入式 artifact-preview-controller 持有，默认组件通过
props 展示并转发 toggle，不再拥有独立异步读取状态。外部工作台读写同一宿主
预览。控制器校验当前会话、产物身份与读取代际，关闭或移除后撤销迟到结果。

App 的会话差异读取核对会话、轮次、路径和请求代际；Inspector 操作目录再从
当前变更集和已显示差异绑定文件/hunk 动作。视觉实现不能把任意路径或索引送入
原生写入。原生审批和内容复核保持原有执行边界。

### 工程动作编辑器

ProjectActionsPanel 不再持有编辑草稿或保存生命周期。Inspector 从 App 传递公共
PresentationProjectEditor 和语义回调，App 将编辑交给注入式控制器；默认面板和
外部呈现共用状态、校验与保存结果。编辑期间的 parse/保存错误归属该工作区，
迟到结果不得覆盖其他工作区。运行/取消回调同样由 App 持有，不依赖皮肤实例。

### 能力视图归属宿主

InstalledWorkbench 是纯展示组件：接收 InstalledWorkbenchState 与语义回调，不再
直接持有 InstalledPort、租约或恢复循环。App 按贡献/作用域创建宿主控制器，独立
于 Presentation 生命周期；验证器及能力控制器仍按需加载。切换皮肤不会重开能力
视图，显式关闭时释放租约。默认与外部呈现消费相同完整快照和视图偏好。

外部工作台的语义动作从已验证快照构造，经过目录和原 InstalledController 两层
上下文检查。格式兼容同时覆盖独立 semantic 角色与整窗 workbench 角色；不得因
外部工作台存在而忽略 snapshotSchemas 声明。

### 独立皮肤主题数据

shadcn 和 Material 3 的主题定义分别归属 `packages/presentation-shadcn/themes.json`
与 `packages/presentation-material3/themes.json`。这些元数据供独立包构建读取，宿主不再注册对应的旧内置适配器。包独立实现四核心语义、公开模型/状态控件及完整工作台，未提供的范围继续继承
宿主默认实现。固定宿主区域继续使用可信适配器。

双皮肤 0.3.0 的 workbench 使用独立 `@aibo/presentation-workbench` 0.2.0 固定模块，
皮肤拥有三栏布局样式；同包声明继续驱动主题/控件/语义视图。固定宿主区域保持
在 PresentationHost 外。主题随更新发送前必须转成纯数据，不能把框架代理对象
交给跨 Worker 消息桥。整窗激活不是完整功能/视觉与原生验收已完成的证据。

时间线分组规则归属 `packages/presentation-workbench/timeline-model.js`，内置时间线
通过兼容导出消费同一规则。公共会话快照的可选 `groupSystemItems` 是宿主提供的
展示提示，缺省不分组系统消息；皮肤不根据 Agent 标识选择分组行为。规则保持
推理、分支摘要与压缩摘要独立。架构检查继续验证这些边界并验证内置导出指向共享实现。

外置编辑器的主修饰键 Enter 操作由受限 `primaryEnter` 字段绑定现有 click token，
可信桥处理键盘事件并保留输入法组合/禁用/只读保护；业务动作仍由宿主目录解析。
皮肤仅选择显示和绑定宿主已经提供的发送或队列引导动作。

工作台导航和辅助列宽度由宿主维护，默认呈现与独立皮肤共用。外置布局控件
通过 `PresentationLayoutAction` 更新同一数值；隐藏的默认网格无法测量时使用
宿主窗口宽度计算上限。皮肤通过受限尺寸提示消费该值并拥有窄屏排布规则。
范围滑块与分栏边界拖动共用同一宿主调整令牌。

分栏手势声明为受限 `PresentationNode.resize`，仅用于 button，提供数值边界、
方向和已有 input token。可信桥在稳定根节点捕获指针，允许同作用域重绘后继续
拖动；控件移除、令牌变更、失焦或指针取消时停止。皮肤拥有分隔线外观与窄屏隐藏
规则，宿主动作目录仍负责范围限制及当前作用域验证。

宿主通过 `workbench-layout-storage` 按窗口保存导航/辅助列宽度、辅助面板开关与
当前视图。记录不包含皮肤身份；默认和外置呈现更新同一状态。读取时校验字段与
尺寸边界，存储不可用时维持内存状态；在较小桌面窗口恢复时重新计算可用列宽。

独立工作台消费宿主 standard/focus/review 布局选择。focus 只装配内容区域；
review 反转区域顺序和分栏增长方向。模式切换经宿主既有 WorkbenchPresentation
控制器提交及持久化；外置皮肤不维护第二份布局选择。旧顺序的调整令牌在模式
改变后失效，切换中不发布布局动作。

问答草稿由宿主按窗口缓存，以会话、请求、问题和轮次的完整键匹配。缓存不创建
待回答请求，不授予提交权限；只有实时请求进入现有动作目录后才显示匹配草稿。
初始空请求列表不清空未重新绑定的缓存，已观察到的请求结束时清除对应草稿。

建议列表的外观和过滤属于皮肤，宿主仍决定路径/命令动作是否存在。受限建议
引用由可信桥处理键盘与 aria-activedescendant，不能引入新的动作身份；宿主
继续按当前 revision 和上下文校验点击。每棵视图限制引用总量，避免重复引用
造成额外绘制放大。

命令分类是受限列表内的纯显示筛选，不调用 Worker 业务入口或宿主动作。分类
按钮不得复用带事件绑定的按钮，分类选项必须属于原列表；各分类保留自己的
24 项结果上限。路径建议的主修饰键确认优先级与内置 Composer 保持一致。


默认与外置 composer 通过语义键共享焦点/选区；消息与分组通过可见锚点映射
不同滚动容器。状态由宿主按窗口内工作区/会话保存，不含正文。两皮肤的桌面
会话历史与编辑区独立滚动，能力页面保持自身滚动布局。命令筛选是选项列表外的
aria-pressed 按钮，编辑器关联真实 listbox；可信桥继续校验动作与引用范围。
外部 semantic 只声明核心语义，不冒充内置可选专业 adapter；存在专业偏好时
明确 core 降级，停用后恢复本地协商。数据、能力实例和动作身份不随呈现切换重建。

最终包、原生/浏览器证据和范围见 [退出审计](presentation-plugin-exit-audit.md)。

## 宿主管理面板

执行历史和插件调用历史使用必需的 `UiKitAdapter.HostPanel`。
宿主传入标题、返回/关闭回调及内容；ak-ui 通过共享生命周期实现和自身视觉规则
提供居中面板。固定标题栏、内容独立滚动、窄窗口适配和焦点管理均位于 UI Kit。
面板不属于可替换工作台，架构检查确保其在呈现释放后仍可使用。

标题栏只提供一个管理中心入口。外观、扩展和运行状态使用必需的
`UiKitAdapter.ManagementCenter`，App 只传当前栏目、三个语义内容 snippet 和导航回调，
不得判断皮肤或传入皮肤专用样式。ak-ui 采用紧凑侧栏导航和矩形内容表面。插件安装管理属于扩展栏目，插件创建的 Agent 会话
返回统一主工作台，不维护第二套消息时间线。Agent 或插件不可用时，标题栏入口可显示
宿主计算的需要处理状态，但具体视觉反馈仍由当前 UI Kit 决定。

默认工作台的列顺序、列宽、滚动和恢复仍由可信 Presentation 管理；三栏表面、区域
分隔、导航选中层级、时间线容器和 Composer 外形由必需的
`UiKitAdapter.WorkbenchChrome` 管理。ak-ui 使用细分隔、统一明暗和扁平内容流。该组合控件只接收
布局语义和既有工作台 children，不接收业务状态或皮肤专用 class，因而切换皮肤不会
重建会话、草稿或 Presentation generation。

暂停交互与隐藏布局分别控制：打开面板时默认及外部工作台保持挂载、可见且 inert，
动作仍受原有暂停校验约束。历史页进入调用历史时保留执行历史实例及页码；返回时
恢复该页滚动。关闭恢复触发焦点，Esc 关闭面板，返回按钮在面板内部导航。
宿主审批处于面板上层并保留键盘访问；设置、命令面板及确认窗口优先处理键盘。

隔离绘制桥同步宿主祖先节点的 inert/hidden 状态，暂停内部输入和焦点恢复，避免
迟到重绘在管理面板打开时抢走焦点。`node probes/host-panels-browser.mjs` 验证双皮肤
及真实外部 Worker 的居中/窄屏布局、历史返回、折叠详情、草稿和审批键盘访问；
该探针使用原生 IPC 替身，不代替真实桌面验收。

### 设置分组

`UiKitAdapter.SettingsSection` 是必需的设置组合控件，接收分组标题、条目描述、
语义图标、快捷键及操作意图，通过 `onAction(itemId, actionId)` 发回用户意图。
工作台布局、皮肤包管理与诊断历史入口均使用这一合同，不在 App 中决定按钮的
拉伸、颜色、圆角或字重。ak-ui 使用分隔设置行和紧凑按钮，并自行处理窄窗口换行。
外部包未覆盖的宿主管理区域继续继承可信 UI Kit；外部 CSS 不能跨隔离边界
覆盖管理或恢复入口。新增可信皮肤可以替换此适配器而保持相同数据与操作合同。

## Agent 设置表单

`UiKitAdapter.AgentSettingsForm` 接收协议描述、当前作用域草稿、继承值和语义回调。
`runtime/AgentSettingsForm.svelte` 跟随当前皮肤，皮肤拥有表单表面、字体、
选择器和焦点反馈；共享字段结构位于 `kits/shared/AgentSettingsForm.svelte`。
应用层只选择目标和转发动作，`agent-settings-controller.ts` 通过注入的读写端口管理
草稿、加载和保存。配置权限、字段校验、作用域解析和原子保存均由 Rust 宿主负责。
参见 [Agent 设置协议](agent-plugin-settings.md)。这增加内部必需控件，外部呈现包未
提供定制时继承完整默认 adapter，不要求现有外部包增加控件声明。

### Composer goal bar

`UiKitAdapter.GoalBar` receives an objective, localized status/usage labels and an
optional clear callback. Both built-in skins own its appearance and expandable
text. The app places it immediately above the composer, based on `goal.manage`
capability data. A goal's lifecycle is separate from turn execution: an active
goal on an idle session is awaiting continuation, not evidence of a running tool.
Installed presentation workbenches render the same goal inside the composer.

Goal controls are capability-gated: `goal.pause` exposes pause through
`goal.manage { action: "pause" }`, and `goal.resume` exposes the host-owned resume
intent. The goal bar emits semantic callbacks; neither skin calls the provider.
A completed, cleared, unknown, or budget-limited goal has no resume action.
An explicit resume may retry a blocked or usage-limited goal; the provider still
enforces the native limits. Pending operations disable duplicate controls.

### 子 Agent 的任务与过程

`SubagentCard` 和 `SubagentDialog` 是 `UiKitAdapter` 的语义控件，两套内置皮肤都提供实现。应用只传入任务、状态、最近活动和打开/关闭回调，不选择皮肤或提供视觉参数。详情沿用消息 Markdown、工具输出和思考摘要的展示方式；原生 modal dialog 提供焦点约束、Escape 关闭和返回触发按钮，关闭不会停止任务。阅读历史时保留滚动位置，实时更新以“有新内容”按钮提示。

Codex 插件把父子线程关联转换为 `subagent.updated` 和 `subagent.message`。这两个事件使用父会话身份、空 `turnId` 和经过宿主校验的 `payload.rootTurnId`，防止子线程完成事件结束父回合。派发调用完成不等于子任务完成。已知子线程的通知实时更新过程；只读 `thread/read` 补齐错过的消息和没有广播的状态。父回复提前结束时，宿主执行流保留到已知子任务结束或读取明确失败，避免丢失尾部记录。

任务卡片存入主时间线，过程消息独立保存在事件历史中。`get_subagent_history` 只读取本地持久化历史，合并相同子线程 item 的最新内容，因此归档、重启或插件不可用时仍可回看。分叉会话保留分叉边界内的子任务过程。单条过程内容沿用有界输出策略，超过 48,000 个字符以省略号标记；界面展示提供方公开的思考摘要。

第一版接入 Codex 的结构化子 Agent 协议，其他提供方可以通过相同事件契约接入。普通文本中的“子 Agent”描述不会被推测成真实任务。协议字段以本机 `codex app-server generate-ts --experimental` 和 [App Server 官方文档](https://learn.chatgpt.com/docs/app-server) 为依据。

### Host waiting queue and optional steering

Session queue eligibility follows the pinned Runtime 2.1 lifecycle contract, not
Agent IDs. Public session `queue.manage` is host-projected; `queue.steer` separately
requires negotiated native steering. Composer and both local/external timelines
hide running send-now without it. External conversation action directories apply
the same gate, and the native host rechecks before accepting or claiming a message.
Provider queue events cannot replace host-owned durable snapshots. No UI kit or
skin owns queue persistence, delivery, attachment identity or uncertain recovery.


### Model context window selector

`UiKitAdapter.ModelContextSelect` receives only current option ID, model-specific option descriptors, disabled state and an onSelect callback. The runtime proxy selects the active implementation; both built-in skins own their dropdown styles. Composer places the control in the model header beside Fast and computes capability/lifecycle gating. External workbench presentations receive the same model metadata and a validated `selectContextWindow` change action. No provider identity or skin ID is used to infer support.

## 协商后的 Agent 功能

页面不通过 Codex/Pi 名称决定功能。`Session.capabilities` 是宿主在会话开放时取
插件声明、已安装 manifest 的版本化契约与运行时握手的交集；Broker 每次调用继续
检查权限、安装绑定和运行时 generation。可选功能契约见
`contracts/session-features.v1.json`，基础生命周期和工作区目录见
`contracts/session-capabilities.v1.json`。不认识或契约不匹配的功能不进入有效能力列表。

默认 Svelte 界面与外部 Presentation 使用同一组有效能力控制分支、树、压缩、模型、
目标和命令。树与分支时间线是两个独立契约：`session.tree` 提供导航，
`session.timeline` 提供当前分支的 `branch` 条目（含可选结构化 `parts`），并启用
普通系统条目的分组；分支总结和压缩总结仍单独显示。宿主在回合开始前冻结分支，
再叠加本回合的持久化消息，防止正在执行时刷新历史阻塞或混入别的分支。
`session.snapshot` 是远端线程摘要，不能替代分支时间线。

导航只接收由有效能力投影的 `canSyncSnapshot`，继续不暴露完整能力或传输字段。
权限与模式菜单接收宿主校验后的 `executionProfile.sessionControls`（来自绑定插件的清单声明）；
选项 ID、文案、配置补丁及可选命令别名归插件所有，前端只传回选项 ID。未声明不补默认菜单。
插件的名字和自报权限标志不
产生原生执行权。原生执行器必须有绑定到具体安装与贡献的宿主授权；声明标准
工具回复和写入契约的第三方可以使用 Core 的工具代理，实际写入仍受工作区信任、
执行配置、Broker 权限与审批约束。没有协商的执行器只提供只读模式。

斜杠命令由有效能力生成，公共宿主命令适用于所有绑定会话。插件发现的命令不再
用内置品牌枚举过滤；`AgentCommand.insertionText` 定义需要插入的文本（例如技能的
`$name `），未提供时使用 `/name `。工作区远端会话目录使用
`aibo.session.catalog`，聚合支持该契约的可用插件，不固定选择 Codex。

附件由 `UiKitAdapter.AttachmentList` 渲染，接收文件名、类型、预览和可选移除回调。
输入框只展示未发送附件；用户消息通过文本中持久化的附件 ID 展示对应文件，
不能按 turnId 批量关联（插话可能共用轮次）。预览缓存属于当前会话，切换后丢弃
迟到响应；预览失败仍保留文件名称。读取入口仅接收会话和附件 ID，校验所有权、
工作区边界、格式、大小及哈希，不接受前端提供的文件路径。

### Git 仓库选择器

`UiKitAdapter.RepositorySelect` 接收仓库名称与相对路径、当前选择、展开状态、搜索文本、禁用状态及语义回调。应用层负责仓库切换和历史入口；UI kit 负责浮层布局、列表层级、搜索输入、选中标记、键盘导航与焦点恢复。默认 ak-ui 注册共享的可访问交互结构，并在自身样式中定义表面、边框、圆角和颜色。名称与路径相同时不重复显示；不同路径的同名仓库保留次级路径。

Git 提交历史由宿主按仓库分页读取，默认展示最近 16 条，在列表底部通过“加载更多提交”逐页追加。分页加载失败保留已显示的提交并允许重试；切换仓库会取消旧结果，后台元数据刷新保留仍属于当前历史的已展开页。

横向内容标签（侧栏 Git/上下文和 Git 变更/历史）采用 ak-ui `ak-tabs` 的等宽列表、分隔线、选中底线与可见键盘焦点。已有面板关系和受控状态由应用保留；方向键、Home/End 在标签间切换。会话视图导航沿用同一视觉节奏，使用 `tablist` / `tab` / `tabpanel` 表达当前面板；竖向管理目录保留独立的方向与标记。

### 会话模式与权限标识

`UiKitAdapter.SessionControlMark` 只接收选项的 `kind`、声明的 `profile` 和紧凑显示标志。UI kit 根据策略含义选择图标和语义色，不根据 Agent 名称、选项 ID 或显示文案推断权限。菜单和当前设置按钮复用同一标识；同时选中的权限与会话模式分别显示。默认 ak-ui 和独立外部皮肤提供眼睛、审批盾牌等图标，深浅主题注册 `--aibo-session-info/plan/write/elevated` 色彩。未识别的自定义策略使用中性设置图标，完整文件访问优先保留警示标识。此分类只用于显示，不授予或更改执行权限。

### 旧内置 UI 清理回归

默认 ak-ui 皮肤的表单样式由 `src/lib/ui-kit/kits/ak-ui.css` 统一管理：独立输入框、
多行输入和原生选择使用直角、加重左边线及清晰的聚焦/校验/禁用状态；复选框和
单选项保留原生或 ARIA 语义，开关保留轨道形状。搜索和消息输入嵌在已有容器时，
由容器显示蓝色焦点边线，避免双层边框。列表选中项使用 ak-ui 蓝色浅底和左侧蓝色
标记；标题栏开关仅使用蓝色底色与图标区分激活态，主要操作仍使用黄色。布局与交互参照
[ak-ui 官网](https://ak-ui.yyj.moe/) 和 [Damocles](https://gitee.com/chldu/damocles)；
`probes/ak-ui-controls-browser.mjs` 在明暗主题下验证这些表单状态和键盘操作。

架构测试针对当前注册的 ak-ui 适配器，同时保留独立 shadcn / Material 呈现包的
主题及图标合同检查。`test/default-ui-kit.test.mjs` 防止旧目录、专用依赖或导入重新进入
宿主，并保留旧设置迁移覆盖。`probes/ak-ui-density-browser.mjs` 检查可读字号、
文件名、分区对齐、明暗主题、悬浮及触屏操作；`probes/ak-ui-controls-browser.mjs`
检查迁移后的目标、子 Agent、模型选择和设置控件。外部包继承、失效恢复仍由
呈现包浏览器回归覆盖。
