# P4 退出条件核对

本表按实施清单逐项记录核对结果。分批实现记录中的“仍待完成”描述的是当时状态；当前结论以代码、测试及实际探针的覆盖范围为准。未核对项保持未完成，不能由单项通过推导整个 P4 已完成。

## 呈现协商与失败恢复

**结论：协商与分层降级项已完成核对。**

| 要求 | 当前实现 | 验证证据 |
| --- | --- | --- |
| 缺必需核心语义拒绝启用 | `renderer-descriptor.ts` 要求 collection/detail/settings/inspector 全部存在；`PresentationSurface.svelte` 在切换预检时调用协商 | `renderer-negotiation.test.mjs` 拒绝缺失、重复、未知核心语义及不兼容协议声明 |
| 专业呈现只按明确合同匹配 | `renderer-negotiation.ts` 按 ID、版本、语义类型匹配；`presentation-adapters.ts` 再查可信构建中的实际实现 | `renderer-negotiation.test.mjs`、`presentation-adapters.test.mjs` 覆盖版本不匹配、错误语义类型和缺实现 |
| 可选增强缺失局部回退 | 协商保留完整快照，选择当前核心适配器；Surface 显示降级原因 | [双皮肤实际探针](./baselines/plugin-platform-p4/specialized-presentation-browser.json)覆盖版本不匹配、专业挂载和更新失败、全文与动作保留 |
| 核心呈现也不可用时给出说明 | 生命周期错误经 `onError` 和切换 Promise 传到 Surface 的 `role="alert"`；不允许已卸载呈现继续发动作 | `presentation-lifecycle.test.mjs` 新增专业/核心连续失败回归，验证错误、旧通道失效、快照保留和再次恢复；说明的 DOM 接线已核对，双重故障尚无独立浏览器注入探针 |
| 失败不能阻止后续恢复 | 生命周期队列吸收已报告的失败，后续切换继续使用最新快照与恢复状态 | 同一回归验证更新后的 revision、焦点、恢复后动作，以及旧通道冒用新 generation 被拒绝 |

这里的核对证明协商与控制器恢复逻辑，不替代独立宿主恢复入口的桌面验收，也不宣称任意第三方前端可加载。默认 Presentation Plugin 仍随可信构建发布。

本批验证：`pnpm run verify` 通过（25 项架构检查、168 项 Node 测试、类型检查及生产构建）；`node probes/specialized-presentation.mjs` 复跑通过，两套皮肤的全部断言与已有归档一致。构建仍提示主 chunk 超过 500 kB，未调整告警阈值。本批未修改 Rust。

## 实际专业呈现与数据保留

**专业呈现验收项已完成核对。** 当前实际增强为 detail 带行号阅读，collection/settings/inspector 继续使用核心呈现。`svelte-adapter.ts` 的专业/核心实例共用 SvelteRoot → `$lib/ui-kit.SemanticView` 路径；增强仅决定文本阅读形式，没有嵌入另一套皮肤。

上一批复跑的 `specialized-presentation` 验证两套皮肤中完整文本、属性、读写动作身份、禁用状态、版本不兼容，以及首次挂载/更新失败后的 6,000 行全文。协商测试比较完整快照；`semantic-git.test.mjs` 拒绝禁用动作和不在集合中的选择。collection 选择/返回/焦点由[全部核心视图探针](./baselines/plugin-platform-p4/core-semantic-views-browser.json)覆盖，本轮原生 Git 探针继续验证真实集合选择、详情和返回。专业 detail 没有另建选择模型。Timeline 与 Composer 仍为可信构建中的专业组件，未作为第三方标准语义呈现开放。

## 标准贡献与独立宿主入口

标准贡献通过 `list_semantic_contributions` 进入 App 的通用命令列表。入口按 contribution 身份生成，不按 Provider 或皮肤分支；可用性同时受安装诊断、作用域和当前选择约束。安装后的数据由 `InstalledWorkbench` 送入公共 PresentationSurface，新增标准语义贡献不需要修改皮肤实现。

`git-plugin-native` 探针在真实隔离 App 安装 Git 能力包、独立声明包及 semantic-catalog，覆盖两套皮肤中的集合/详情，以及 workspace.tool、settings.page、command 的实际通用入口。session.context/session.action 的作用域与执行合同由 `semantic_plugins::tests::all_registered_extension_points_have_scoped_read_only_views` 覆盖；该原生探针刻意不创建 Agent 会话，不将它描述为这两个扩展点的桌面验收。

本轮修复原生探针对旧 textarea 呈现的单一依赖，使其同时读取当前带行号详情与核心只读文本。补充断言要求不兼容贡献、卸载 Provider 后的独立视图仍出现在命令列表中，禁用且显示“依赖或语义版本不可用”；检查覆盖两套皮肤。

**标准贡献入口项已完成核对。** [本轮原生证据](./baselines/plugin-platform-p4/contribution-entry-native.json)两次 App 启动均通过，包含重启保留绑定、卸载后缺依赖诊断。外层探针退出码为 0；清理隔离 App 时子进程的 ELIFECYCLE 不表示断言失败。原生客户端使用 DOM 操作验证实际 IPC 与状态链，鼠标命中/遮挡由独立 `host-shell-browser` 验证；本轮证据不扩展为 Windows/Linux 桌面支持。

独立宿主控制已核对以下证据，整项仍需结合审批与停用路径完成汇总：

- `p2-boundaries.test.mjs` 解析 App AST，要求插件管理、设置、诊断、执行/会话/能力历史和 Agent 审批区域位于可替换槽位之外；宿主回调不依赖 renderer generation，插件管理操作保留宿主上下文检查。
- `host-shell-browser.mjs` 在实际 App 使用 Playwright 鼠标点击，验证插件管理、执行/会话/能力历史入口、布局切换后的 DOM 身份和进出焦点。它证明浏览器中入口可点击，不替代原生审批。
- `workbench-recovery-browser.mjs` 原先仍使用已移除的 `children` 属性，复跑在寻找草稿时超时。改为当前 `content` 槽位后，两套皮肤均验证恢复按钮、捕获阶段快捷键、强制挂载失败的可见提示、草稿保留及再次恢复。
- 原生 Git 探针验证管理与审计面板跨布局保持实例；真实调用完成后，插件停用/卸载且信任撤销，宿主仍能读取并显示同一 invocation 的持久记录。

本批 `pnpm run verify` 全部通过（25 项架构检查、168 项 Node 测试、类型检查及构建）；两项浏览器探针和两轮原生探针均退出 0。未修改 Rust 实现；现有 Rust 编译警告和主 chunk 大小提示保留。

## 尚需逐项核对的 P4 范围

- 独立插件管理、审批、历史、停用及默认工作台恢复。
- 项目任务/Git 服务边界、受控写入、日志及资源限制。
- 直接与插件间 Capability 写入、审批预检执行边界。
- 页面生命周期、过期上下文及权限复核。
- 整体布局、全部核心视图、键盘、焦点、无障碍标签及减少动态效果。

以上已有多批实现和专项证据，列表表示尚未完成本轮逐项归档，不表示需要重新实现。
