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
- 新配色调整主色、选中容器、文字与中性表面，不改变几何、排版、交互或成功/警告/错误的语义。
- ak-ui 的颜色令牌和原有两张主题卡片保持不变；外部皮肤继续使用已有主题列表。

## 组件外观

- 经典蓝沿用设计稿；森林绿、紫罗兰各自提供主色与六级浅深表面，保留独立的成功、警告、错误语义色。
  `material3/themes.json` 是颜色与形状的唯一数据源，`--md-sys-*` 映射到宿主语义令牌，`--md-aibo-*` 提供本地密度、排版与动效。
- 保留现有桌面三栏位置、列宽调节、标准/专注/审查布局、紧凑标题栏与 760px 阅读栏。
  桌面导航仍至少 44px，Git 文件行仍为 36px，元信息不低于 12px。
- 主按钮采用圆角填充样式；新建会话采用 primary-container 色调表面和 16px 圆角。
  次要、描边、危险和禁用操作保留各自语义；键盘焦点必须清晰可见。
- 导航选中使用圆角容器填充，去掉左侧信号边；主标签沿用底部 3px 指示条并增加圆角端点。
- 用户正文使用柔和色调表面，助手正文直接排在画布上；思考、工具与工具分组卡片使用完整四边轮廓和 12px 圆角。
- 执行记录保留四列表格与原有展开操作，使用 12px 圆角色调容器、柔和表头和圆形状态标记。
- 会话变更列表和 Git 提交展开后的文件行不绘制边界线，保留悬浮、焦点、选中反馈及差异预览。
- Composer 使用 24px 圆角与单线边框，附件采用 8px chip；textarea 和提及绘制层保持相同文字度量。
  不改变发送快捷键、输入法处理、菜单、文件引用、粘贴、草稿及队列行为。
- badge 使用 6px 圆角色调表面。模型矩阵使用 16px 圆角色调容器，以留白代替表格分隔线；
  当前模型使用柔和圆角底色，当前强度使用主色胶囊与勾选，未选可用项使用圆形标记，
  强度由列标题表达。Fast 使用胶囊开关，不绘制条形刻度、充能角标或扫光。
  桌面矩阵按钮高 36px、强度列最小 44px、列间距 2px，模型列约 120px；
  常规弹层内完整显示默认项及 low / medium / high / xhigh / max / ultra，长模型名省略并保留完整标题。
  触屏保持 44px 点击高度；更窄窗口保留横向滚动、固定模型列、默认选择、不可用项与键盘操作。
- 输入框使用 8px 圆角轮廓和等宽边框，不使用粗左侧信号边；聚焦和错误状态强调完整边框；单选、复选与开关保留原生键盘语义。
- 菜单使用 12px 圆角和抬高的表面，管理与确认对话框使用 28px 圆角。
  五类设置、全局搜索、恢复入口由宿主固定区域提供；Agent 审批在会话区域呈现，选择由宿主复核。
- 侧栏支持按窗口记忆的 56px 收起状态，顶部操作行保留 16px 上边距。展开时顶部切换按钮与新建会话并排；
  收起时上下排列，切换按钮位置固定。保留顶部切换、新建会话、工作区与会话入口，以及底部插件与设置。
  展开恢复原列宽，列表保持挂载以保留滚动位置；收起时隐藏列表、筛选和导航拖动分隔条，
  此时有等待审批或输入的会话，工作区与会话入口显示提示标记。
- 审批卡片使用警告色调表面，命令以等宽圆角代码块显示。卡片高度受可用空间限制，长命令详情独立滚动，
  操作按钮在窄窗口换行并始终可达。
- Agent 提问一次显示一题，标题、分页和底部操作固定在滚动内容外；规则见 [UI 架构](../ui-architecture.md#固定宿主区域)。
- 模型目录声明 `current-model` 时使用两个顺序选择器：先模型、后推理强度，复用 Select；规则与 ak-ui 相同。
- 回答中的网页、邮件与工作区文件链接显示对应类型图标；文件链接在右侧宿主预览面板打开，
  面板使用表面色、左侧分隔线和投影，当前行以悬浮底色加主色描边标出。
- Composer 选区使用 35% 透明度的主色背景，保证在提及绘制层之上可见。
- 应用通知使用反色表面、8px 圆角和圆形状态图标，按 success / info / warning / error 着色。
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
