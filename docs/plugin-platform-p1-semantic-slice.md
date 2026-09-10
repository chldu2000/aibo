# P1：Git 只读语义切片实施记录

> 日期：2026-09-11 · 状态：P1 已实施，自动检查与原生 WebView 脚本链路通过。

## 使用入口与范围

在桌面应用选择一个工作区，通过命令面板的「工作区变更（只读）」打开。无需创建或启动 Agent session。可切换中央表格和侧栏列表；侧栏模式在旁边展示详情。关闭工具后回到原工作台，插件管理入口也会退出该工具，保持可达。

本批只添加受控 Git 读取，不迁移 Git 执行到进程外，不修改现有 Git 写入、Provider 路由、会话/历史及 PluginView v1 协议。主 UI 随应用构建；P3 才接能力包安装。

## 代码与责任

| 落点 | 责任 |
| --- | --- |
| `contracts/semantic-{view,action}.experimental-v1.schema.json` | 独立实验性 snapshot/action schema；允许 collection/detail，拒绝未知字段、布局和可执行扩展 |
| `src/lib/presentation/contract.ts` | JSON 数据类型，不包含 DOM、框架类型、函数回调或具体 API |
| `src/lib/presentation/git.ts` | GitPage → 语义 snapshot 纯投影；文件属性与动作含义保持独立于布局 |
| `src/lib/presentation/git-controller.ts` | 窄端口调用、15 秒 UI 超时、过期结果丢弃、实例释放与错误恢复 |
| `src-tauri/src/semantic_git.rs` | 与调用 WebView 绑定的只读视图实例、身份/版本/动作验证、Git 数据读取与分页 |
| `src/lib/workbench/` | 可信 Svelte 装配、两个本地 Web adapters；不导入具体 API，入口由 App 注入 |
| `src/lib/ui-kit/.../SemanticView.svelte` | 必需 composite 的 runtime proxy、两套皮肤与共同语义 markup；视觉样式归 kit |
| `scripts/build-semantic-validator.mjs` | 生成浏览器可运行的校验代码，避免桌面 CSP 下运行时编译 schema |

`open_semantic_git` / `act_semantic_git` / `release_semantic_git` 是可信桌面 bridge，不是通用插件 Broker。宿主调用已有 `workspace_changes` / `workspace_file_diff` 实现，与原 Git API 复用同一读取机制。

## 已冻结的 P1 行为

### 扩展点与身份

第一批仅登记 `workspace.tool`；未知扩展点在 schema 验证时拒绝。贡献 ID 使用命名空间字符串，必须与 context 中的 contributionId 一致；Git 注册为 `dev.aibo.git.changes`。每个打开实例只呈现一个工作区的一份贡献，允许多个独立实例；贡献数量与排序不要求占用物理侧栏位置。

Git 工具的适用条件是已选择、已登记的工作区；未选择时命令禁用。命令面板是没有常驻位置时的入口。文件按路径升序，同一路径暂存项在前；展示排序由该只读切片固定，不增加表达式语言。关闭时释放实例，未知/已释放 generation 的动作不能重新激活实例。动态贡献安装/卸载属于 P3，本批只验证已构建贡献的关闭与不可用状态。

每个 context 包含 workspaceId、contributionId、宿主生成的 generation 和 revision。调用者身份由 Tauri WebviewWindow 提供，消息不能指定 caller。generation 是 P1 视图实例代际，不冒充 Agent runtime generation，也不实现 P2 的整窗 renderer 切换代际。

revision 表示宿主发布的视图状态版本，不是 Git commit 或磁盘内容 hash。成功动作推进 revision；旧版本、其他工作区、其他 WebView、过期或释放的实例被拒绝。只读 open-diff 读取目标的最新内容，仍执行路径范围检查；文件变化可以返回最新数据或不可用/错误，不能静默读取其他文件。

### 动作

| ID | 语义与受控操作 |
| --- | --- |
| `refresh` | 重新捕获当前工作区；产品 controller 可重新 open 获取新实例以恢复过期/失败状态 |
| `open-diff` | 单选当前已发布页面中的 itemId，宿主映射为 path/staged，读取差异 |
| `back` | 返回同一实例保存的集合页与 offset；UI 恢复有效选择/焦点 |
| `next` / `previous` | 在当前集合快照中翻页，不允许越界，也不能在 detail 中执行 |

message 只含 context/actionId/itemId；非 open-diff 的 itemId 必须是 null。宿主拒绝额外字段、未声明动作、伪造文件项、其他页面的项及无效上下文。P1 不接受 renderer 指定 method、路径或 CSS，也没有写入动作和确认弹窗。

加载期间控件禁用以避免重复提交，关闭和布局切换仍可用。controller 的请求序号独立于宿主 revision，保证工作区切换或 dispose 后的迟到响应不能覆盖新页面。读取不能实际取消时仍丢弃过期结果；15 秒 UI 超时不是底层 Git 进程已被终止的承诺，底层沿用现有执行机制。

### 数据与资源

- 每页 50 项，最多保留 10,000 项；超限以 truncated 标明部分结果，不伪装成完整列表。暂存/未暂存同一文件是两个稳定 item ID。
- 文件路径及 previousPath 各最多 4,000 字节；一般显示字符串最多 8,192 Unicode 字符。最多 16 个属性、5 个动作。
- diff 沿用既有 200,000 字节读取上限及 available/truncated/reason 语义；新协议 content 最多 210,000 字符以容纳标记，序列化 snapshot 最多 1,000,000 UTF-16 code units。不可读取的大文件/二进制内容明确不可用，不伪造截断数据。
- 已登记实例最多 128 个，空闲超过 30 分钟失效；超限返回 busy。底层 Git capture 的资源行为仍沿用原实现，以上上限不宣称覆盖整个进程内存或未完成查询的全部开销。
- 状态为 ready/loading/empty/error/unavailable。分页、截断和错误有显式可见说明；错误可刷新。只读切片没有用户表单字段，validation 在 schema、枚举、唯一 ID 和 action 选择边界执行。
- 工作区读取沿用现行策略：从已登记 workspace ID 解析根目录，读访问不要求写入信任；diff 通过 canonical target 检查拒绝越界和 symlink 逃逸。这里不扩大写入权限，也不宣称已实现 P3 的插件权限协商。

### 交互与框架边界

中央模式使用带列标题的表格，侧栏模式使用文件按钮列表；每个文件的路径、状态、范围均可读。Tab 到按钮，Enter/Space 激活，disabled 使用原生属性。打开详情聚焦标题，返回聚焦原文件（失效时回合理入口）；差异使用原生只读多行文本框，支持键盘滚动和复制。error 使用 alert，普通状态使用 status，加载容器有 aria-busy。新视图不引入动画，reduced-motion 下无新增动效。

能力模型没有布局字段；layout 只存在于可信本地 PresentationProps。Svelte 与 DOM adapter 都消费相同 fixture、输出同样的 action，支持 update/dispose。DOM 样例只验证合同，不发布为第二套完整工作台；P2 的草稿/整个 renderer 切换恢复不属于本批完成项。

## 验证与证据

```sh
pnpm run verify
cargo test --manifest-path src-tauri/Cargo.toml
pnpm run probe:semantic-ui
pnpm run probe:semantic-desktop
```

首次运行浏览器 probe 需安装对应 Chromium：`pnpm exec playwright install chromium`。默认截图及 results.json 输出到 `/tmp/aibo-p1-screenshots`，可用 `AIBO_SEMANTIC_SCREENSHOTS` 指定位置；页面使用禁止动态执行的 CSP。

自动覆盖：schema 正反 fixture、枚举/重复 ID/超限拒绝、另一个贡献 ID、过期 action、逆序结果、超时和实例释放、纯数据传递依赖/无 DOM 类型、真实临时 Git 仓库的无 session 读取、伪造身份、分页、失效、截断与 symlink 越界。Rust 和浏览器验证消费同一份 schema/fixture。

浏览器 probe 覆盖中央/侧栏 × 两套皮肤的数据、动作、Enter/Space、焦点恢复、disabled/loading、empty/error/unavailable、部分内容，以及实际 GitWorkbench 组合的详情/返回/切换/关闭。DOM adapter 对同一 fixture 的 action 做逐字段等价检查并验证 dispose。该浏览器 probe 的工作台使用窄端口 fixture。另以 `probe:semantic-desktop` 启动独立应用标识的真实 Tauri WebView，创建临时 Git 工作区，经 App 命令面板执行只读工具；四种组合均读到真实 diff，返回与插件管理可达，数据库没有创建 Agent session。测试使用 WebView 内脚本触发 DOM 事件，不声称是人工物理输入。

本批结果：`pnpm run verify` 架构 20/20、Node 111/111、类型检查与构建通过；Rust 全量 101/101 通过（包含新增 5 项）；浏览器四组合与第二 renderer 通过；原生 WebView 四组合通过。既存 Rust dead-code 警告保留。

[浏览器记录](./baselines/plugin-platform-p1/browser-results.json) · [原生记录](./baselines/plugin-platform-p1/native-results.json)

| 皮肤 | 中央 | 侧栏 | 工作台详情 |
| --- | --- | --- | --- |
| shadcn | [截图](./baselines/plugin-platform-p1/shadcn-central.png) | [截图](./baselines/plugin-platform-p1/shadcn-sidebar.png) | [截图](./baselines/plugin-platform-p1/shadcn-workbench-detail.png) |
| Material 3 | [截图](./baselines/plugin-platform-p1/material3-central.png) | [截图](./baselines/plugin-platform-p1/material3-sidebar.png) | [截图](./baselines/plugin-platform-p1/material3-workbench-detail.png) |

截图来自真实浏览器渲染的脱敏 fixture；原生记录来自临时真实 Git 仓库。原生 probe 的独立应用标识会打印在日志中，临时 Git 仓库会清理，独立应用数据保留用于诊断，不接触用户现有 Aibo 数据。曾有两次原生 probe 在 DOM 切换等待/工作区 canonical 路径选择器处失败，调整 probe 为语义标签定位及等待 Svelte tick 后通过；未将这些 probe 时序问题改为产品权限豁免。大 diff 测试使用暂存文件验证截断，未跟踪大文件沿用既有不可用策略。

可访问名称、原生键盘控件与焦点已做自动验收；未进行人工屏幕阅读器朗读。P0 例外没有扩展到 P1；本批也不宣称通过 P2 的整窗切换/草稿恢复或第三方 UI 安装验收。
