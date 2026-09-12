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

## 整体交互验收

本轮重新检查各探针的实际断言，并顺序运行以下浏览器验收。没有把“设置了减少动态效果”或“没有脚本错误”当作交互要求已完成的证据。

| 清单要求 | 命令与实际覆盖 |
| --- | --- |
| 整体布局切换 | `node probes/workbench-reorder.mjs`：实际 App、两套皮肤、导航左右重排、两侧鼠标/箭头键调整、拖动期间恢复后旧事件失效、重载保留布局 |
| 全部核心语义视图 | `node probes/semantic-ui-browser.mjs`：collection/detail/settings/inspector；集合/详情覆盖双皮肤与中央/侧栏，settings/inspector 覆盖双皮肤与 Svelte/DOM；集合/详情状态覆盖加载、空、错误、不可用、部分结果和截断 |
| 键盘与焦点 | 核心视图探针验证 Enter/Space、详情标题及返回条目焦点；`node probes/workbench-lifecycle.mjs` 验证两套皮肤中被移除、隐藏、禁用的焦点目标，以及 Tab 可继续导航 |
| 状态与生命周期 | 生命周期探针验证草稿/插件表单、挂载失败后恢复、模拟流继续、旧 generation/会话动作拒绝；核心视图探针验证工作区 A/B/A 和失效详情目标恢复 |
| 屏幕阅读器标签 | `node probes/workbench-accessibility.mjs` 读取 Chromium AX 树：双皮肤三种布局，恢复按钮和唯一 main landmark；全部核心视图控件名称、只读属性与错误 alert |
| 减少动态效果 | `node probes/reduced-motion.mjs`：正常动画/过渡必须实际存在；reduce 时检查全部已挂载节点和伪元素的计算样式，双皮肤分别 444/363 组，布局操作仍可用 |

布局探针本轮连续两次失败，定位为鼠标事件后过早读取布局：右侧导航即时宽度为 276px，下一帧为预期 316px。命中元素和 pointer 事件正确；另一侧也出现相同现象。修复仅让探针等待精确目标宽度，保留原数值、方向与 1px 容差；旧拖动无效的断言额外观察渲染帧，避免漏掉迟到影响。独立修复复跑和整组原始验收均通过，临时诊断日志已移除。

浏览器结果仍与各专项归档的语义结论一致：[工作台重排](./baselines/plugin-platform-p4/workbench-reorder-browser.json)、[焦点与生命周期](./baselines/plugin-platform-p4/workbench-focus-browser.json)、[核心视图](./baselines/plugin-platform-p4/core-semantic-views-browser.json)、[无障碍树](./baselines/plugin-platform-p4/workbench-accessibility-browser.json)、[减少动态效果](./baselines/plugin-platform-p4/reduced-motion-browser.json)。浏览器证据不代替原生执行、系统偏好或完整人工 VoiceOver 体验认证；原始清单要求的是可验证的屏幕阅读器标签。

本轮也复跑 `node probes/workbench-accessibility-native.mjs`，在隔离 macOS App 中创建真实工作区：双皮肤 × 三布局均无未命名应用按钮；系统关闭/最小化控件具有明确系统角色描述和可执行动作。每套皮肤通过原生 AXPress 按下恢复按钮后，实际 WebView 均返回 standard。[原生结果](./baselines/plugin-platform-p4/workbench-accessibility-native.json)已更新为本轮记录，外层退出 0。语义视图探针另补空态/不可用说明的显式可见断言，避免只挂载 fixture 却不核对提示。

**整体布局、核心视图、键盘、焦点、屏幕阅读器标签、减少动态效果与双皮肤验收项已完成核对。** 这些结果不推导全部本机能力跨平台支持；发布平台矩阵仍归 P5。

本批 `pnpm run verify` 通过（25 项架构检查、168 项 Node 测试、类型检查及构建）。生产主 chunk 约 520 kB 的提示仍存在；未调整阈值。没有修改产品实现或 Rust；本批改动为探针观测时机、空态断言及验收归档。

## 受控写入与页面生命周期

| 清单要求 | 当前实现与直接验证 |
| --- | --- |
| 项目任务/Git 领域服务与宿主控制 | `lib.rs` 的任务和 Git 命令调用 `project_actions`、`workspace_git`，Core 恢复调用 `core_turn_git`；窗口只提供宿主身份和原生确认。任务工作目录规范化检查、执行记录、日志脱敏/截断、可选会话 artifact 保留在宿主服务；`controlled_process` 限制执行时间和输出并清理后代。任务/Git 无窗口服务测试、目录越界/信任拒绝和 noisy/timeout 进程测试直接覆盖这些边界；artifact 保存调用仍在宿主服务中，不由插件或 UI 决定存储路径 |
| 重复请求与作用域写冲突 | `project_actions` 和 `workspace_write_runs` 在副作用前保存意图与请求身份；相同请求读取原结果，改变输入/调用者拒绝；`workspace_writes` 按规范化工作区路径互斥。`duplicate_requests_execute_once_and_survive_definition_deletion_and_restart`、`duplicate_requests_do_not_repeat_effects_and_preserve_results_and_errors`、`tasks_and_git_share_workspace_exclusion_without_blocking_other_workspaces` 用实际文件和数据库验证 |
| 取消、超时和未知结果 | 持久取消信号进入受控进程；开始执行后的取消/超时不宣称撤销已有更改，未知结果不自动重试。任务取消测试、Git commit hook/同步 transport 超时测试、`cancelled_git_commit_preserves_effects_output_and_caller_scope` 和结算失败/重启测试保留已知输出与副作用；待审批恢复为拒绝，执行中恢复为未知 |
| 通用 Capability 写入与调用链 | `capability_writes`、Broker 与共享写入上下文保留原窗口、声明权限、scope、精确 release 和父/根关系，每层单独批准。`capability_write_chain_tests` 覆盖三层写入、共享占用、固定依赖、伪造 generation、未声明依赖、read→write / write→read→write 拒绝、取消与 deadline、子未知不能被父成功掩盖、重启与无副作用重放 |
| 审批预检执行边界 | `workspace_git_approval` 使用安全 Git 读取策略及宿主文件哈希；带正向对照的 `preflight_never_runs_fsmonitor_filters_or_diff_drivers_but_approved_git_can` 验证批准前不运行过滤器等程序，批准后实际 Git 可运行。缺失 promisor 对象不触发 lazy fetch；隐藏编辑/子模块/大文件均有测试。Capability 的依赖发现读取元数据，版本程序仅在批准后通过受控进程执行；`approved_version_probe_cancellation_stops_descendants_before_settlement` 验证取消收尾 |
| 离开页面仍保留执行与结果 | `write_semantic_contribution` 由宿主任务持有写入，页面 release 仅失效视图和读取。`semantic_write_survives_page_release_and_reopens_settled_results` 在实际副作用后释放页面，覆盖完成、取消、崩溃、非法输出及重开数据库后的原结果重放；独立历史关闭不会取消执行，控制器测试拒绝迟到读取/停止结果 |
| 过期上下文和权限重新确认 | 任务/Git/Capability 均在批准后重新计算上下文，变化则拒绝原请求；新请求才能重新确认。语义写 proof 检查 lease、TTL、revision、包摘要及读/写绑定；`installed_write_uses_cached_input_and_replays_after_release` 覆盖等待确认时页面释放后无副作用，任务测试覆盖信任/定义改变，调用链测试覆盖子包停用/篡改 |

本轮完整 Rust 测试 **208 项通过**。上述测试使用真实临时工作区、SQLite 和子进程；注入批准回调用于精确控制时序，不将它们冒充真实原生按钮验收。原生探针另覆盖生产 IPC、原生批准和实际文件结果。没有给通用路由添加 Provider 分支；`p2-boundaries.test.mjs` 继续限制 Provider 专用装配位于兼容模块。

## 宿主控制与 P4 退出结论

宿主控制的结构与实际入口证据见前文。`PluginManagerPanel` 的禁用按钮只受 busy 与安装启用状态约束：`runnable=false` 阻止重新启用，不阻止禁用已启用的故障插件。注册服务只在启用时检查运行依赖，禁用后先阻止新调用，并失效相关语义视图、停止关联能力实例。新增 `plugin-management-recovery` 浏览器探针验证故障诊断、禁用/卸载回调身份及禁止重新启用；它使用真实组件与 fixture 安装状态，生产安装/停用的 IPC 与历史保留由前文原生贡献探针验证。

可信审批不由语义数据或呈现动作提供批准凭据。Agent 审批区域与回调保留在宿主，过期/重复/替换请求由 `approval-routing.test.mjs` 验证；既有 P4 第四批实际 Codex/Pi 宿主审批证据保留。写入批准使用最初窗口构造的原生对话框和不可反序列化回调；本轮原生探针验证实际允许/取消按钮。该边界建立在可信构建的呈现实现和纯数据安装贡献上，不宣称任意第三方前端已经安全隔离。

本轮专项证据：

- [任务/Git 原生写入](./baselines/plugin-platform-p4/write-exit-host-native.json)：6 次原生按钮操作；拒绝不执行、重复请求不重写、双皮肤历史停止按钮、已有提交/文件保留、后代延迟写入被停止。
- [插件间写入原生验收](./baselines/plugin-platform-p4/write-exit-chain-native.json)：两次 App 启动、6 次逐层原生按钮操作；子拒绝不执行、固定依赖、父/根持久关系、子取消传播未知、卸载与撤销信任后的历史和重放，外层检查无新进程/重复文件效果。
- [安装语义写入](./baselines/plugin-platform-p4/write-exit-semantic-native.json)：两套皮肤各一次原生批准；实际页面按钮、重复点击合并、读取刷新，以及文件恰好写入两次。
- [故障插件管理](./baselines/plugin-platform-p4/plugin-management-recovery-browser.json)：两套皮肤的实际鼠标按钮、故障说明、禁用/卸载身份、不可运行插件禁止重新启用。组件 fixture 不宣称模拟了真实插件崩溃；后端停用与独立宿主入口另有真实 IPC/布局验收。

三个原生 runner 和新增管理浏览器探针均退出 0；共 14 次原生按钮操作，隔离进程清理时的内部 ELIFECYCLE 输出不是测试失败。

最终 `pnpm run verify` 通过：25 项架构检查、168 项 Node 测试、类型检查与生产构建。结合本轮 208 项 Rust 测试及前述浏览器/原生证据，完成本阶段验证；未修改或削弱架构规则。

**P4 退出条件已满足。** 工作台可重排且宿主恢复/管理/审批/历史独立可达；专业增强缺失按当前核心语义降级，核心缺失拒绝启用；项目任务、Git 与通用写入经过可信批准、持久身份和副作用验收。代码/框架/视觉边界继续由架构检查约束，原始清单中的各项均有上述对应证据。

下一阶段为 P5：提取 SDK、在仓库外完成插件开发/安装链路、发布兼容与升级/数据恢复矩阵。Custom Surface 仍是有真实需求才实施的条件项。已有的 macOS 原生证据不替代其他平台发布验证；本机子进程控制不等同于任意本机代码的系统沙箱。主 chunk 大小提示作为性能后续保留，没有修改构建阈值，也不是本阶段原始退出条件。
