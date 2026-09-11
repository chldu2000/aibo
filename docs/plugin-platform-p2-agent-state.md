# P2：统一 Agent 路径与 UI 状态

> 2026-09-11，P2 已完成。首批为 `b5c94e0`；本记录汇总后续实现与最终验收。完整证据及范围见 [P2 退出矩阵](./baselines/plugin-platform-p2/completion-matrix.md)。

## 已收敛的调用与状态

首批建立 `agent-facade.ts`：能力选择操作，session 绑定选择插件传输；未声明能力被拒绝，失效插件不会退回其他 Provider。队列、树和插件命令读取已经接入，关闭使用统一 API。前端不再把 queue/tree/sandbox 能力解释成 Pi 或 Codex 身份。

第二批把插件工作台的会话列表、选中会话、草稿和时间线接入主会话状态。插件安装列表仍是应用级状态；会话列表使用 `workspaceSessionMap`，草稿使用已有 SQLite 持久化和 `composerDrafts` 缓存，时间线使用同一宿主投影。插件工作台发送也复用消息控制器，不再维护另一条发送路径。轮询通过现有带请求代际的列表刷新实现，避免重复水合会话详情。

发送成功只消费发起请求时的原 session 草稿；不会因用户已经切换会话而清空另一个编辑器。插件视图文档保留独立 session 上下文，迟到视图不能显示到另一会话。

## 执行方式与 Provider 身份解耦

原先 Rust 也把 queue/tree 推断为 Pi。首批直接删除推断时，Echo 写入测试无法进入审批：测试借用了 Pi 的执行配置，读取配置又按 Provider 重算。第二批通过宿主持久化执行方式解决这一依赖，没有删除审批断言。

| 执行方式 | 决定来源 | 行为 |
| --- | --- | --- |
| `CodexNative` | 可信内置装配的兼容映射 | 保持现有原生执行配置 |
| `CoreProxy` | 宿主明确保存的执行配置 | 工作区信任、profile 和逐次审批共同约束代理工具 |
| `Unnegotiated` | 未明确配置的外部插件 | 默认只读、禁用命令，无原生沙箱承诺 |

`execution_profile_agent` 已删除。读取、更新和恢复配置使用已保存的执行方式；握手的能力声明只更新能力清单，不能变更执行方式。内置名称别名映射仍属于兼容装配，不是能力推断。Echo 等价测试现在明确指定 CoreProxy，经过真实 Rust 宿主的文件、命令、审批与恢复流程。

迁移 `0024_execution_enforcement_backend.sql` 给现有配置增加内部字段，保留旧表和历史格式。迁移按内置身份、宿主已保存的 **enforced** 写入/命令配置确定后端，不把 requested 配置升级成授权，也不信任外部 Agent 的 native-sandbox 声称。该字段不进入现有 wire profile，前端或插件无法通过 profile JSON 直接指定它。新增迁移测试覆盖既有 Core 授权、仅申请未获准、外部原生沙箱声称以及内置配置恢复。

## 状态存储规则

| 状态 | 键与范围 | 保存/恢复策略 |
| --- | --- | --- |
| 会话草稿 | Core session ID；预览/离线缓存 `aibo.composer-drafts.v1` | 保留已有 250ms SQLite 写入队列与即时缓存；成功消费时立即保存删除；不按年龄或最近 50 条自动丢弃 |
| 窗口会话选择 | `aibo.selected-session.v2.<window label>` | 选择变化时保存；仅主窗口读取旧共享键；显式空值避免旧选择复活；会话存在性由现有刷新控制器检查 |
| Git 浏览状态 | `aibo.presentation-state.v1.<window label>.<workspace/contribution>` | 记录成功选择、详情、页偏移和本地布局；离开后保留，重新打开时先查询并校验目标；30 天未使用的导航不恢复 |
| 工作台呈现 | `aibo.workbench-presentation.v1.<window label>` | 成功挂载后保存标准/专注布局；失败恢复标准；默认恢复入口在可替换子树之外 |
| Git 提交说明、分支名与旧面板浏览选择 | `aibo.workbench-drafts.v1.<window label>` 内按 workspace ID 分组 | 输入变化后由宿主保存；提交/创建成功仅清除仍匹配原提交值的草稿；草稿不按年龄丢弃，历史目标重新校验 |
| 插件表单与展开状态 | 同一窗口 drafts 键，字段按 session/view/node 身份隔离 | 宿主持有并传给 PluginView；输入变化保存，整窗/皮肤切换及重启恢复；无宿主 interaction 时保持原 runtime 本地行为 |
| 焦点 | 呈现快照的语义目标 ID | 切换时恢复有效目标，详情定位标题；不保存 DOM 对象，不要求应用重启后恢复原焦点 |

Git 恢复会重新获取所需分页，再打开仍存在的同一 item；目标失效则返回集合，不改开另一个文件。导航缓存不可用时使用内存状态。布局属于本地宿主恢复状态，不进入公共 semantic-view 合同。多个窗口导航互不覆盖；同一 Core session 的草稿继续使用现有共享持久化，尚未新增多窗口同时编辑的冲突解决协议。

## 呈现生命周期

新增 JSON-only `PresentationSnapshot` / `PresentationAction` 与独立的本地 `Renderer` 接口。控制器依次执行预检、使旧 generation 失效、dispose、mount、更新为最新快照。预检失败保留仍可用的旧实例；挂载失败回到默认 renderer；超时后到达的实例会被清理，不能覆盖 fallback。

通道绑定实例所有者，同时验证 generation、当前视图上下文、动作与目标。旧实例即使伪造新 generation 也不能发送动作。挂载期间发生的数据更新会在挂载完成时补齐；切换区域暂时不可交互，避免用户点击仍留在 DOM 的旧按钮。

生命周期同时接入 **Git 语义视图** 和 **整个 App 工作台**。`WorkbenchPresentation` 提供标准/专注会话两种可信本地呈现，真正销毁并重新挂载可视组件；根 App 状态、Agent 监听及 turn 执行留在宿主。所有页面业务回调及可写绑定经 generation 与工作区/session 上下文检查，旧控件不能跨实例或跨会话执行。切换与默认恢复入口位于可替换子树之外。

`workbench-contract.ts` 只传 JSON 上下文，Svelte snippet 和回调属于可信本地 adapter；这不是第三方可执行 UI 的安装接口。局部及整窗呈现共用预检/销毁/挂载/失败恢复控制器，布局不按皮肤分支，不改变现行 UiKitAdapter 的必需成员规则。整窗挂载失败、宿主持续接收流式数据、草稿和语义焦点恢复通过浏览器故障注入；真实 Tauri Echo 流式过程中切换验证 Agent 不重启、turn 完成和历史保留。

## 最终证据

最终 `pnpm run verify` 通过：23 项架构检查、129 项 Node 测试、类型检查及构建；`cargo test --manifest-path src-tauri/Cargo.toml` 为 102/102 通过。

- [浏览器结果](./baselines/plugin-platform-p2/browser-results.json)：两套皮肤 × 两种布局、键盘与焦点、第二 DOM renderer，以及 A→B→A、组件卸载后布局/详情恢复、目标删除后返回集合。
- [恢复截图](./baselines/plugin-platform-p2/restored-detail.png)：重新打开工作区 A 后恢复侧栏详情。
- [原生结果](./baselines/plugin-platform-p2/native-results.json)：真实 WebView → Tauri → 临时 Git 仓库四组合通过，未创建 Agent session。
- [整窗与真实 Provider 结果](./baselines/plugin-platform-p2/workbench-native-results.json)：真实 App 两次进程启动、两窗口隔离、Echo 流式整窗切换、Codex/Pi 配置/审批/取消/恢复/归档及 Pi 树/队列。
- [失败恢复结果](./baselines/plugin-platform-p2/workbench-lifecycle-results.json)：挂载失败回退、连续流、草稿/插件表单/焦点恢复、旧 generation/session 动作拒绝。
- [早期 Provider 结果](./baselines/plugin-platform-p2/provider-results.json)：Codex 真实 transport、smoke、resume 通过；Pi 刷新凭据后真实 smoke 通过，返回 `AIBO_PI_PLUGIN_SMOKE_OK`。

Pi 失败信息原先被适配器简化为 “Pi turn failed”，冒烟脚本只等待成功终态，最终表现为超时。本批保留 Provider 的有界错误信息，并在收到失败终态时立即结束探针；fixture 回归通过，真实复跑明确返回 “Provided authentication token is expired.”。用户重新登录后已补跑通过；历史失败保留在证据中，用于区分凭据问题与权限迁移。

## 统一路由与兼容退出条件

默认和显式创建统一调用 `createAgentSession`，旧 Codex/Pi API 名称保留为委托。此次修复旧包装器丢弃 `requestedProfile` 的问题，评审会话也传递原有只读配置。创建、发送、取消、恢复及关闭由持久 binding 决定 Host 路径；失效绑定不会回退到另一个 Provider。目标、压缩、命令/技能、树/队列、模型及推理设置通过 facade 检查声明能力。创建超时仅接纳唯一新增匹配会话；用户已切换工作区时只缓存结果，不抢回当前选择。

| 显式兼容模块 | 保留原因与退出条件 |
| --- | --- |
| Rust `compatibility.rs` | 旧无绑定 Codex 执行与原生线程读取/fork、旧 Pi history-only；待旧会话迁移或明确退役执行后删除，不能伪造新线程恢复旧历史 |
| Rust `plugin_host/compatibility.rs` | Codex **1.0.0** 握手能力补全、空且无历史线程恢复、Pi recovery/profile 翻译；待对应旧 release 不再恢复、恢复合同替代且回归通过后退出 |
| `app/compatibility/legacy-capability.ts`、`legacy-model-configuration.ts`、`legacy-tree.ts` | 无绑定会话的目标/技能/命令、原生 Codex 默认推理语义、旧 Pi 树；旧数据迁移或只读退役后删除 |
| `app/compatibility/agent-kind.ts`、`builtin-agent-creation.ts`、`command-dispatch.ts` | 冻结内置名称、默认创建配置与 slash 命令词汇；待贡献命令与默认 Agent 配置具备等价装配合同后替换，不以能力推断 Provider |
| `lib/compatibility/agent-api.ts` | 组合根注入上述原生历史/fork/tree 和旧能力端口；随相应旧调用退役移除 |

`test/p2-boundaries.test.mjs` 检查通用 IPC 优先 binding、创建保留 profile、页面不调用专用发送/模型接口，并逐一解析 App 的回调/绑定以检查代际防护；既有架构测试继续禁止新工作台中的 Provider/皮肤分支。兼容模块不代表获准删除旧协议、历史和管理恢复入口。

## 后续阶段边界

P2 没有剩余退出项。P3 才实现 Manifest v2、通用 Broker、无 session runtime、提供者冲突选择和能力/声明式贡献安装。完整 Presentation Plugin 发布、所有核心语义视图和 v1 view 非 `never` confirmation 在 P4。多窗口同时修改同一 Core 草稿的冲突解决协议仍不属于本阶段；窗口导航与表单草稿隔离不等于改变 Core session 共享语义。

P0 的 B01/B02 已由能力路由和默认插件创建解决。B04 中 Echo 未实现的 queue 和 Provider 原生 approval 能力声明已删除；真实 Core 工具审批仍由宿主负责并通过测试，不虚构 fixture 功能。B05 的既有偶发测试失败保留原始记录，本轮 102 项通过，不据此宣称根因已修复。

## 审批与用户输入统一入口

页面和审批控制器调用 `resolve_agent_approval` / `resolve_agent_user_input`，不再根据 Agent 名称或审批 kind 选择 Pi/Codex。宿主按会话插件绑定调用；旧命令保留为兼容委托，无绑定会话仍使用原有兼容执行路径。

Core 工具审批保留 v1 的 `pi-tool:` 请求命名空间（与 Provider 身份无关），由 Core 待处理表消费；过期请求不会落入插件审批操作。其他审批通过会话绑定的 `approval.respond` 能力处理，用户输入通过 `user-input.respond`。宿主内部以不可由 wire JSON 指定的事件来源区分 Core 工具审批和插件原生审批：前者不需要插件声明原生审批 operation，后者仍校验协商能力。兼容命名空间不能供插件自己的原生审批使用。

修复错误会话响应会消费原请求、重复请求覆盖待处理记录的问题。Echo 真实宿主测试验证跨会话响应被拒绝、原请求仍可完成、重复完成被拒绝，以及文件和命令审批均通过统一宿主入口。

审批迁移批次的 `pnpm run verify` 及 Rust 全量通过；`test/approval-routing.test.mjs` 覆盖统一控制器的失败保留和跨会话隔离。

## 模型配置迁移与矩阵勾选修复

手工验收发现 Codex 插件会话的矩阵始终勾选“默认”。对演进前 `b6f09fb` 和当前代码输入相同数据，都能复现：插件返回 `high`，矩阵仍从旧执行配置读取空值或旧值。该问题早于 P0–P2；原有冒烟未覆盖矩阵选中状态。

- `model-configuration.ts` 统一模型、推理强度和组合设置；绑定会话使用 `agent-facade`，Pi/Codex 的 `/model`、`/thinking` 和矩阵共用此路径。组合设置先校验所需能力和模型支持强度；仍是两个操作，第二步失败时重新读取实际配置，不假装已回滚。
- `modelConfigurationState` 以插件模型目录为绑定会话的显示依据，不再用旧执行配置覆盖插件返回的强度。语义状态从 App 传给 TimelinePanel/Composer，两种皮肤继续使用现有 ModelMatrix 控件。
- 插件 v1 没有通用的重置推理强度操作。原“默认”格在插件链路实际只设置模型、保留强度，因此统一标为“保留”。旧无绑定 Codex 会话的“默认”仍清除显式强度，由 `compatibility/legacy-model-configuration.ts` 实现。退出条件是旧 Codex 会话完成迁移或转为只读历史；其他无绑定会话拒绝配置操作。
- Pi 原专用接口负责写入恢复所需的执行配置。此保存逻辑移到 Host 的 `invoke_capability` 成功响应之后，校验当前 generation，并只更新模型相关字段；旧命令仍作为兼容入口。恢复用配置副本不再作为插件矩阵的显示来源，也不根据 Agent 身份重新推导权限或执行后端。

模型迁移批次的 `pnpm run verify` 及 Rust 全量通过。`test/model-configuration.test.mjs` 覆盖陈旧 profile、设置后读取、能力预检、Pi 统一路由和旧 Codex 默认语义。Echo 的真实宿主测试覆盖统一设置、无效值拒绝、权限不变以及进程重启后的模型/强度恢复。

`node probes/model-configuration-browser.mjs` 挂载真实 Composer 并经生产配置服务更新：两套皮肤均验证初始 high、切换 medium、保留、重新挂载 medium；[浏览器结果](./baselines/plugin-platform-p2/model-matrix-results.json)，[shadcn 截图](./baselines/plugin-platform-p2/model-matrix-shadcn.png)，[Material 截图](./baselines/plugin-platform-p2/model-matrix-material3.png)。此浏览器测试使用确定性能力传输，不宣称覆盖真实 Provider 的完整模型矩阵。
