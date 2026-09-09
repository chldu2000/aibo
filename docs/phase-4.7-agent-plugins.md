# Phase 4.7：Agent 支持插件化

> 状态：实施中（P4.7A、P4.7B 已完成）
> 平台：macOS arm64 首发基线；Windows 后续验证
> 前置：Phase 4.5 与 Phase 4.6 已完成的权限、会话、工作台能力和自动化门禁
> 后续：Phase 5 `@` 与 Handoff v1
> 工期：第三方测试插件最小闭环完成后估算

## 1. 目标与边界

把 Aibo 建设为 Agent 插件宿主：新接入一种 Agent 等同于安装一个插件，无需修改 Aibo 源码或重新编译。现有 Codex/Pi 支持作为随应用分发的内置插件，与第三方插件共用协议、注册表、监管和渲染流程。

插件决定展示内容、业务行为和视图结构；Aibo View SDK 提供布局与语义组件；当前皮肤决定视觉和交互反馈。不同插件可以提供会话树、任务看板等不同视图，不要求使用同一种布局。

本阶段包含本地插件包安装，不包含公共插件市场、云同步、远程插件宿主、多 Agent 编排或 Handoff 实现。不开放任意 Svelte/JavaScript/CSS 注入主 WebView；自定义画布只预留版本化能力位置，隔离机制与安全评审完成前不开放执行，也不将其视为标准视图的强一致性保证。

## 2. 运行时架构与契约

```text
插件视图描述 + 数据 → Aibo View Renderer → UiKitAdapter → 当前皮肤
                              │ 通用命令 / 标准事件
                          Aibo Core
                 Registry / Session Router / Supervisor
                              │ stdio JSON-RPC，逐行 JSON
                  ┌───────────┼───────────┐
              Codex 插件    Pi 插件     外部 Agent 插件
                  │           │             │
              App Server    Pi SDK      CLI / SDK / API
```

- Core 保留工作区与信任校验、权限策略、状态机、SQLite、附件与 artifact、变更快照、事件广播、generation 隔离和进程退出恢复。插件不直接访问 Aibo 数据库或调用 Tauri。
- 插件负责厂商协议转换、原生会话操作、能力发现及版本化恢复数据。Codex Rust 逻辑可提取为独立可执行文件，Pi SDK host 可演进为插件入口，不强制统一实现语言。
- 插件清单声明 manifest 版本、全局唯一 pluginId、插件版本、平台、协议兼容范围、入口、依赖、Agent 贡献和视图需求。区分 pluginId、agentId、Aibo sessionId 与厂商原生 ID。
- Agent Runtime Protocol 定义握手、诊断、创建/恢复/关闭会话、发送/取消 turn；模型、队列、分支、树、审批、用户输入、压缩、Skills 和 Goal 使用版本化可选能力。
- 清单描述可发现能力，握手确认实际运行时能力，会话状态决定当前可执行操作；Core 执行前再次校验。扩展操作使用命名空间与输入输出 schema，不开放无约束的任意方法转发。
- 插件事件作为不可信输入校验；Core 分配权威事件 ID、序号与会话关联。协议规定请求关联、超时、取消、消息大小、重复事件及背压处理；stdout 用于协议，stderr 用于受限且脱敏的诊断。
- 进程隔离不等于沙箱。权限明确区分 Core 代理执行、操作系统隔离和 Agent 原生保证；不能把插件自报能力当作强制保证。无法落实 requested profile 时明确拒绝或返回 unsupported，不静默放宽权限。

## 3. 视图协议与皮肤统一

Plugin View Protocol 与 Agent Runtime Protocol 独立版本化。插件贡献声明式组件树、数据绑定、动作 ID、配置字段、模型选项和标准交互请求，宿主验证后渲染，并把动作路由回已声明的能力。

首批 View SDK 从现有 Codex/Pi 视图提炼布局、面板、工具栏、表单、树、列表、代码/Diff 和标准时间线；以第三种差异化视图验证组合能力，再补充必要组件，避免先实现通用 UI 框架。

- 插件使用受约束的语义属性，例如 tone、density、间距档位和图标名称；不传颜色值、任意 class/CSS、皮肤 ID 或具体组件库属性。
- Renderer 的视觉组件统一来自 `$lib/ui-kit`。新复合控件扩展 `UiKitAdapter`，每套皮肤实现同一契约；业务模块继续保持框架独立，不因 Agent 插件破坏现有 UI 架构规则。
- 宿主负责键盘导航、焦点、禁用/错误/等待反馈、空态和窄窗口适配。品牌 Logo 作为校验后的资源，功能图标由皮肤映射。
- 安装和运行时校验视图 schema、SDK 版本、组件能力、资源引用及动作绑定；拒绝未知执行内容。对缺失组件提供明确的宿主降级视图，不渲染未验证内容。
- 交互状态以稳定视图/节点 ID 管理；切换皮肤保留选中项、表单草稿和会话状态，不重启 Agent。
- 将新视图契约、架构测试与 `docs/ui-architecture.md` 在实现时一并更新，不削弱现有规则以通过测试。

## 4. 安装与数据兼容

安装流程为：本地插件包 → 结构/路径/平台/协议/资源校验 → 暂存解包 → 原子安装 → 注册 → 启用与探测。拒绝路径穿越、逃逸链接、身份冲突及不兼容入口；定义来源、完整性校验与用户启用记录，不在探测前运行未获启用的插件代码。

插件安装与 Agent 本体安装分开诊断：插件可携带 SDK，或声明本机 CLI/运行时依赖；缺失依赖不应伪装为安装成功且可运行。

插件版本并存，活跃会话固定使用原版本；升级默认影响后续启动。定义恢复数据版本、迁移与回滚规则，卸载先处理活跃进程并保留 Aibo 历史投影。插件缺失时仍可查看历史，恢复执行提示安装兼容版本，不自动替换 Agent。

移除 TypeScript Agent 封闭联合类型和数据库 agent CHECK 的硬编码限制，通过新增 migration 迁移已有会话与 binding。AgentEvent v1 已冻结且枚举封闭，新增契约版本并兼容读取旧事件；pluginId、agentId、插件版本与恢复数据版本的映射必须可验证。架构 ADR 显式记录进程边界和契约变化，不改写历史迁移或静默修改冻结 schema。

## 5. 实施切片

| 切片 | 状态 | 交付 | 退出条件 |
| --- | --- | --- | --- |
| P4.7A 契约与设计 | 已完成 | ADR、清单、运行时/视图 schema、能力与错误模型、binding 迁移设计 | 有可回放的请求/事件/视图样例，明确版本与权限边界 |
| P4.7B 最小外部插件闭环 | 已完成 | Registry、Supervisor、统一会话 API、最小 Renderer、本地安装；现有 Manager 暂经内部适配层路由 | 仓库外测试插件无需修改或重编译宿主即可安装、交互、取消、恢复并显示标准视图；自动化检查与 Tauri 窗口人工 smoke 均通过 |
| P4.7C 内置插件迁移 | 待实施 | 抽回 Core 职责；Codex/Pi 迁为独立插件；泛化模型、命令、树、审批和 Goal 等入口 | 内置与外部插件走同一路径，Phase 4.5/4.6 能力回归通过，生产业务路径不再按 Codex/Pi 分派 |
| P4.7D 视图与生命周期补全 | 待实施 | 差异化视图、两套皮肤、依赖诊断、版本并存、升级/卸载、历史兼容 | 皮肤切换保留状态，异常包与不兼容版本可解释，卸载后历史可读 |
| P4.7E 验收与开发者交付 | 待实施 | 插件开发文档、样例包、协议测试 harness、迁移与恢复证据 | 完成下述门禁，Phase 5 可仅依赖统一会话和能力契约 |

P4.7A 的契约、迁移设计和回放证据见 [Phase 4.7A 记录](phase-4.7a-plugin-contracts.md)。内部适配层仅为迁移手段，不能作为内置插件迁移的最终验收结果。

P4.7B 的宿主接线和异常场景检查见 [Phase 4.7B 检查记录](phase-4.7b-host-wiring-check.md)。自动化门禁与 Tauri 窗口人工 smoke 均已通过，本切片完成。

P4.7D 已开始实施生命周期与视图补全：插件安装记录现在保留已卸载墓碑；卸载先关闭该 Plugin Release 的活跃会话和进程，再移除包文件，同时保留 session、timeline、event、view 与固定 release 关联。相同 release 可按原 installation ID 重装，且重装后默认禁用。声明式 binding 与无需二次确认的扩展 action 已接通 `operation.invoke`：宿主核对固定 release、当前 generation、manifest、握手能力及输入/输出 schema，拒绝任意方法转发。Core 另提供按标准 capability 调用的统一入口，并要求每项 capability 在固定 release 中唯一映射到一个 namespaced operation；内置 Codex 的 Goal get/set/clear 已通过 `goal.manage` 端到端接入。宿主现在解析 manifest 的 executable/runtime 依赖，明确展示缺失的必需/可选依赖，缺失必需依赖时禁止创建会话；脚本插件可由声明的本机 runtime 启动，无需把 runtime 复制进包。业务层对旧 Goal API 的切换，以及依赖版本与认证探测、标准 action、受控资源和完整升级验收仍待后续切片完成。

P4.7C 已开始迁移内置 Agent：Codex 与 Pi 的首个随应用嵌入 Plugin Release 会在启动时幂等安装并启用，经统一 Registry、Supervisor 和 Runtime v1 路径分别启动 Codex app-server 与 Pi RPC，基础创建、流式文本、取消、关闭与 recovery binding 已由独立进程适配。Core 为每个固定 release/session 分配包外的持久 runtime data 目录，Pi session 文件不写入不可变插件包或 workspace。Codex Goal、模型、推理强度、Skills、审批及用户输入已迁入 `goal.manage`、`model.select`、`model.reasoning`、`skill.list`、`approval.respond` 与 `user-input.respond`；模型和推理选择会传入后续 turn，交互请求则保留 Provider request ID 并经 Core 等待状态投影后响应。Pi 模型、推理强度、命令、队列、压缩和树读取已分别迁入 `model.select`、`model.reasoning`、`command.list`、`queue.manage`、`compaction.run` 与 `session.tree`，并由各自 Provider fixture 验证。旧 Manager 和生产工作台仍保留，需继续迁移树导航、附件及变更投影，并将业务调用切至统一 capability 后移除专用分派。

## 6. 验收门禁

1. **安装即接入**：在独立目录构建第三种测试 Agent 插件，安装到既有 Aibo 构建；发现、新建、流式消息、中止、重启恢复和差异化视图不需要修改宿主源码或重新编译。
2. **内置能力保真**：Codex/Pi 的 profile、模型/推理强度、命令、Skills、Plan/Goal、审批/用户输入、树/队列、附件、变更审阅、checkpoint 和草稿按各自能力回归，无支持能力退化或权限放宽。
3. **协议与隔离**：覆盖进程崩溃、超时、取消竞态、旧 generation、重复/乱序/非法/超大事件、多会话路由、背压和不兼容协议；不污染其他会话。
4. **视觉一致性**：同一插件视图在 shadcn 与 Material 3 的明暗模式中验证；覆盖键盘焦点、空态/错误/禁用、长文本和窄窗口。切换皮肤不丢交互状态，非法样式/脚本/动作引用被拒绝。
5. **生命周期与兼容**：旧数据库迁移与 v1 事件读取通过；安装失败不留下半注册状态；升级保留活跃版本；卸载/缺失插件后历史可读；不兼容恢复数据返回可操作错误。
6. **工程验证**：每个实现切片执行 `pnpm run verify`；Rust 变更补充对应测试，插件协议/安装/恢复补充集成验证。真实 Provider 验收与离线 fixture 分别记录；不可用项明确列出，不将模拟成功当作真实通过。

最终交付包括插件运行时、两个内置插件、本地安装管理、视图协议与 Renderer、第三方测试插件、兼容迁移、开发者文档及验收记录。Handoff 的快照、来源、权限和持久化仍由 Core 负责，Phase 5 不重新引入厂商专用分派。
