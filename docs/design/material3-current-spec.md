# Aibo 内置 Material 3

以 [Material 3 交互设计稿](material3-redesign.html)为视觉基准，在现有工作台上增加一套内置外观。
本规范定义 Material 3 独立拥有的完整视觉；状态、功能与布局所有权继续遵循 [UI 架构](../ui-architecture.md)。
默认 ak-ui 的规则见 [ak-ui 规范](ak-ui-current-spec.md)。

## 接入与兼容

- 注册 ID 为 `material3`，主题为 `light` / `dark`；入口是工作台设置 → 外观 → 界面皮肤。
- ak-ui 仍为默认选择。切换内置皮肤保持当前明暗偏好，选择保存于原有外观存储键。
- 旧 Material 3 的 `ocean` / `sage` / `violet` / `daylight` 偏好继续迁移到 ak-ui；新增主题不恢复旧实现。
- 两种内置 adapter 共享无皮肤的行为组件，保留有状态组件身份；图标和状态图形分别实现。
  共享组件不得携带具体皮肤样式，Material 3 不继承 ak-ui CSS 或 `--ak-*` 令牌。
- 外部呈现包继续独立安装，未提供的 surface 继承当前内置选择；故障自动回退同样使用该选择。
  设置中的“恢复内置皮肤”继续显式选择默认 ak-ui。切换与恢复不得丢失宿主拥有的数据。

## 组件外观

- 使用设计稿中的蓝色主色、六级浅深表面和独立的成功、警告、错误语义色。
  `material3/themes.json` 是颜色与形状的唯一数据源，`--md-sys-*` 映射到宿主语义令牌，`--md-aibo-*` 提供本地密度、排版与动效。
- 保留现有桌面三栏位置、列宽调节、标准/专注/审查布局、紧凑标题栏与 760px 阅读栏。
  桌面导航仍至少 44px，Git 文件行仍为 36px，元信息不低于 12px。
- 主按钮采用圆角填充样式；新建会话采用 primary-container 色调表面和 16px 圆角。
  次要、描边、危险和禁用操作保留各自语义；键盘焦点必须清晰可见。
- 导航选中使用圆角容器填充，去掉左侧信号边；主标签沿用底部 3px 指示条并增加圆角端点。
- 用户正文使用柔和色调表面，助手正文直接排在画布上；工具分组使用 12px 圆角。
- Composer 使用 24px 圆角与单线边框，附件采用 8px chip；textarea 和提及绘制层保持相同文字度量。
  不改变发送快捷键、输入法处理、菜单、文件引用、粘贴、草稿及队列行为。
- badge 使用 6px 圆角色调表面；模型矩阵使用圆角状态容器和勾选，不呈现 ak-ui 的充能角标。
- 输入框使用 8px 圆角轮廓和等宽边框，不使用粗左侧信号边；聚焦和错误状态强调完整边框；单选、复选与开关保留原生键盘语义。
- 菜单使用 12px 圆角和抬高的表面，管理与确认对话框使用 28px 圆角。
  五类设置、审批、全局搜索、恢复入口仍由宿主提供。
- 减少动态效果偏好继续生效。窄桌面窗口保持所有操作可达，沿用现有区域切换方式。

## 验证

运行 `pnpm run verify`，并使用内置外观浏览器探针检查 ak-ui 与 Material 3 的浅深主题、
设置切换与重载、草稿/附件/焦点保留、菜单、Git、审批及布局。
外部呈现回归继续覆盖未提供 surface 的继承和故障恢复。浏览器原生 IPC 替身只验证 UI 合同，
不证明真实 Agent 执行、操作系统授权或原生持久化。

可复现的浏览器入口：

```sh
node probes/material3-browser.mjs
node probes/material3-controls-browser.mjs
node probes/ak-ui-browser.mjs
node probes/presentation-app-browser.mjs
AIBO_BUILTIN_KIT=material3 node probes/presentation-app-browser.mjs
node probes/presentation-full-skins-browser.mjs
AIBO_BUILTIN_KIT=material3 node probes/presentation-full-skins-browser.mjs
```

Material 3 工作台、设置与窄窗口截图默认写入 `/tmp/aibo-material3/`。
