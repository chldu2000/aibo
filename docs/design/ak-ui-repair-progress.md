# ak-ui 修复进度

来源：Claude Code 会话 `be4b158a-10ee-4e05-a617-5061ef366be4`，2026-09-23。
视觉参考：[交互设计稿](ak-ui-redesign.html)。采用 system 强度，保留现有品牌和表单规范。

## 已有阶段

- [x] 设计稿：`3facfd0`。
- [x] P0：`e6a96ce`，标签焦点、插件标识、附件布局、表单焦点、禁用按钮和背景色。
- [x] P1：`dee4dde`，14/13/12px 字号、单行密度、选中语言、ak-form、信任与计数颜色。
  接续时补查并修正了全局 transition、输入框自动增高及移动附件规则遗漏。

## P2：区域实现（`fd11cf7`）

- [x] 会话头部合并标签，保留能力驱动的动作，移除重复可信状态。
- [x] 消息使用自然作者名称和插件声明名称；完成状态不再重复标记；工具组显示调用数及异常/进行中状态。
- [x] 工作区只预留一个更多按钮；新建会话移入菜单，保留关闭和焦点返回。
- [x] 会话单行显示插件图标、标题、相对时间；异常/运行状态同时有文字。
- [x] Agent 选择器显示插件图标和就绪原因；不可用项禁用，创建路径仍独立验证 readiness。
- [x] 上下文取消重复标题和装饰竖线，键值左对齐，相对时间保留完整时间提示，合并刷新入口。
- [x] Git 单行文件、状态框、路径截断、真实增删行数与悬浮操作；历史字号统一，分页入口保留，多仓库去重。
- [x] 设置取消英文眉标和完成页脚，单皮肤信息行，主题使用原生 radio，打开时回到顶部。
- [x] 手机独立标签行、隐藏面包屑和底部状态、附件横向滚动、输入框自动增高。
- [x] Finder 文案空格及默认模型提示。

Git 统计由原生 `git diff --numstat -z` 产生，分别保存暂存/工作树统计；二进制、冲突、未跟踪及统计失败允许缺省，不伪造 0。只读扫描与已有 stage/unstage 动作保持分离。

验证：`pnpm run verify`；三个 ak-ui 浏览器探针；`presentation-full-skins-browser`、`composer-input-browser`、`composer-paste-browser`；`cargo test --manifest-path src-tauri/Cargo.toml --lib change_set::tests`（13 项）。浏览器使用替身 IPC，原生 Git 使用隔离临时仓库；不代表真实 Agent 或完整桌面发布验收。

## P3：整理与验收

- [x] 合并 18 组重复样式，恢复多行格式，移除旧设置容器和 Inspector 页脚规则。
- [x] 补充桌面/手机、浅色/深色的设计稿与实装截图对照，以及表单几何断言。
- [x] 同步架构文档及最终验证结果。


P3 额外修正：原生 radio 主题卡片不再过渡背景颜色，避免切换时新旧主题混色；未选择会话时仍保留工作区刷新入口。

最终验证包含 `pnpm run verify`（36 项架构检查、366 项 Node 测试、类型检查及构建）、上述 13 项原生测试，
以及 `ak-ui`、`ak-ui-density`、`ak-ui-controls`、`presentation-full-skins`、`composer-input`、`composer-paste`、
`presentation-git`、`presentation-inspector`、`presentation-navigation` 浏览器探针。
Inspector 夹具补齐仓库发现；导航探针针对原生模态框验证 inert、焦点和宿主拒绝暂停中的呈现动作，替换过时的“整个界面隐藏”假设。
构建仍提示已有的超过 500 kB 分块告警。

运行 `node probes/ak-ui-browser.mjs` 生成 `/tmp/aibo-ak-ui/comparison.html` 和四组截图；
同尺寸并列对照关注层级、密度、表单几何，而非将不同示例内容误作逐像素基准。

实现边界：控件保留实际 44px 命中区域，未使用会与邻居重叠的扩展伪元素；移动端以输入区小于 250px、
附件单行、页面不横溢出验收，不对不同窗口的阅读高度承诺固定增加 150px。共享 base 样式保留外部呈现回退消费者。

## P4：复核 P2/P3

复核 `fd11cf7` 与 `91b647a`。P2/P3 的主体确实落地：`ak-ui.css` 无原始色值、无低于 12px 字号，
Git 行数来自原生 `git diff --numstat -z` 且有制表符/改名/二进制的原生测试，
`pnpm run verify` 与三个 ak-ui 探针均通过。以下四项与记录不符，已修正：

- [x] 上一节“合并 18 组重复样式”未包含媒体查询：`@media (max-width: 720px)` 和
  `@media (hover: none), (pointer: coarse)` 各自仍分成两块，同一断点可以自相矛盾。已各自合并为一块。
  合并方向不能随意选：靠后那块 coarse 指针的 `.git-file-tail { display: flex }` 位于自身无条件规则之后，
  若上移到前一块就会被后面的 `display: grid` 覆盖，触屏操作入口随之失效，因此向后合并。
- [x] 主题卡片改原生 radio 时同时隐藏了色板和勾选标记，“主题色”只剩文字，没有任何颜色预览。
  恢复色板（圆角仍沿用皮肤的 `--ak-radius-subtle`），勾选标记由 radio 自身表达。
- [x] P3 删除 `base.css` 的 `.settings-overlay` 等规则，但共享的 `HostPanel` 仍用该类名判断
  上层是否有模态框。该选择器此后永不匹配，执行历史面板在管理中心或子 Agent 对话框打开时会抢走 Escape。
  改为原生 `dialog[open]`，共享层不再依赖某套皮肤的类名。
- [x] `Inspector.svelte` 移除页脚和上下文标题后残留 `Separator`、`sessionStateLabel` 两个未使用导入。

新增四项断言（`test/ui-style-boundaries.test.mjs`）：断点条件唯一、媒体规则不被同选择器的
后置无条件规则遮蔽、主题色板不得隐藏、共享层用原生 `dialog[open]` 而非皮肤类名。
其中三项在修复前的代码上确认失败；遮蔽那项在旧代码上本就通过，属于防止回归的前向约束，不代表抓到了缺陷。

验证：`pnpm run verify`（40 项架构检查、370 项 Node 测试、类型检查及构建，全部通过）；
`ak-ui`、`ak-ui-density`、`ak-ui-controls`、`presentation-full-skins`、`presentation-navigation` 探针通过。
导航探针首次失败是我把两个探针并行跑造成的端口冲突，单独重跑通过，与改动无关。
本轮视觉结论来自 CSS/标记审查与探针断言（计算样式、包围盒、溢出检查），未逐张查看截图。

## P5：对照设计稿收敛（`8789696`、`13cec5a` 及本节）

用 Playwright 在同一视口同时打开设计稿与实际应用，逐区域读取包围盒和计算样式，不看截图。

- [x] 阅读区：固定 24px 留白加 760px 内容栏，消息流 grid + 24px gap，Composer 与次级条共用同一栏；
  窄屏断点 720 → 760；状态栏 28px。探针新增桌面/手机内容栏断言，首跑复现了手机端 342 vs 366 的差异。
- [x] 侧栏与 Inspector：侧栏行贯穿面板、会话缩进移入行内边距、Inspector 用 panel 表面并默认 340px。
- [x] 管理中心：尺寸、标题行、栏目导航、内容留白、设置行、主题卡片和色板全部与设计稿一致；
  主题 radio 铺满卡片并视觉隐藏，勾选标记恢复（推翻 P4 “由 radio 自身表达”的做法，因其导致色板与
  radio 并列、卡片高出 17px）。手机区域切换断点 900 → 760，与皮肤对齐。
- 保留的有意差异：标题行关闭按钮是真实 44px 控件（标题行 68px 而非 57px）；Git 文件行 44px 而非 36px；
  应用列宽可拖拽，不复制设计稿 1100px 以下的 240/300 固定列宽。

验证：`pnpm run verify`（40/40、370/370、类型与构建干净）；`ak-ui`、`ak-ui-density`、`ak-ui-controls` 探针通过。
中途一次 ak-ui 探针失败是视觉隐藏的 radio 被色板遮住点击，改为铺满卡片后通过。
