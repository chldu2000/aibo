# 会话能力迁移实施记录（历史）

以下按批次保留当时状态，当前结论见 [迁移说明](../capability-session-migration.md)。

# 会话能力迁移

状态：进行中。旧插件宿主、原生执行管理器及旧视图入口已删除；写入批准与功能等价的宿主验收、剩余接口清理及发布验收仍待完成。

## 目标与授权范围

将 Aibo 收敛为插件宿主、能力插件和呈现插件。保留 Codex/Pi 的工作台功能，但不再为 Agent 维护独立运行协议与执行通路。用户接受旧会话只读，也接受不保留旧数据兼容性；本次不要求无感迁移旧原生会话。

宿主拥有工作区、会话身份、审批、历史、执行记录和恢复入口。会话是业务模型，不是特殊插件运行机制。Codex/Pi 原生引擎属于能力插件内部实现。呈现插件消费宿主快照和语义动作，不拥有审批凭据或执行事实。第三方动态前端加载不在此次迁移范围。

## 必须达到的结果

- Codex/Pi 以 v2 能力贡献登记、发现、绑定和执行，所有调用走统一 Broker 与进程监督。
- 创建、恢复、关闭、发送、中断、增量输出、工具活动、审批、用户输入和执行配置具有能力契约。
- 模型/推理强度、Skills、Plan、Goal、Pi tree/queue 等现有可选功能通过契约发现和路由，保留不支持时的明确反馈。
- 会话状态、草稿、事件投影和原生恢复信息有明确所有者。重启不伪造成功，不自动重放未知副作用。
- 旧会话最多提供只读历史，旧 Agent runtime、v1 可执行插件支持、旧原生无绑定执行和前端兼容路由被删除。
- Timeline/Composer 使用会话呈现合同；宿主管理、审批、历史与默认呈现恢复保持独立可达。
- 更新 SDK、支持矩阵、当前架构说明和架构检查；不把保留旧运行链路的绿色测试当作迁移完成证据。
- 完成 `pnpm run verify`、适当 Rust 回归、真实子进程的会话/审批/恢复测试及可用环境中的桌面验证。无法执行的原生模型验收必须明确记录原因。

## 实施顺序

1. 统一能力协议承载流与执行中控制。
2. 定义会话能力合同，将宿主会话投影和工具审批接到 Broker。
3. 将内置 Codex/Pi 改为能力提供者，并逐项验证功能等价。
4. 切换创建入口、配置、控制及呈现路由，旧会话停止执行。
5. 删除旧 Host、协议、兼容实现及失效探针；更新当前文档并执行最终验收。

## 当前实现

第一步已加入 Capability runtime **2.1**，显式协商，不改变 2.0 的语义：

- `capability.invoke` 可在最终结果之前发送 `capability.event`，带宿主初始化身份、调用身份及从 1 开始的连续序号。
- `capability.control` 只作用于调用者拥有的活动 invocation。Broker 从该调用恢复实例、作用域、固定插件版本和权限，不接受控制请求提供这些授权字段。
- 控制操作必须由同一能力贡献声明、符合输入输出 schema、不能增加权限，不能作为新的写操作绕过批准。
- SDK 在调用结束、关闭或截止后拒绝继续发事件；控制处理器收到同一取消信号。事件数量、单条大小和宿主累计大小有上限。
- Broker 验证事件身份与顺序，将其写入独立能力历史；先处理已到达事件再结算最终结果，避免丢失结尾事件。
- 2.1 传输复用现有能力进程清理和队列上限；旧 Agent 协议暂存只为后续迁移期间保留功能，不属于目标架构。

证据入口：`test/capability-interactive-runtime.test.mjs`、`plugin_runtime::tests::interactive_capability_stream_and_control_share_one_generation`、`capability_broker::tests::interactive_broker_persists_stream_and_controls_only_the_callers_pinned_invocation`、`capability_broker::interaction::tests`。

这些测试证明 SDK/传输/Broker 基础能力，不证明 Codex/Pi 已迁移。该批次尚无会话合同、桌面会话事件接线或旧执行通路删除的完成证据；后续进度见下一节。

本批验证：`pnpm run verify` 通过（25 项架构检查、180 项 Node 测试、类型检查及生产构建）。Rust 完整运行 215 项通过，1 项因沙箱禁止 `ps` 失败；该进程清理测试在所需权限下单独复跑通过。SDK 的截止时间与累计事件大小收紧后，8 项运行时专项测试再次通过。既有大于 500 kB 的构建提示保留。

## 会话能力提供者迁移进度

后续批次新增 `contracts/session-capabilities.v1.json` 与纯数据 SDK 会话类型。
共享契约包含 open、turn、受批准的 turn.write、close、cancel 和 tool.respond。
共享契约只能在 session scope、runtime 2.1 下使用；清单必须保留宿主定义的输入输出
schema、effect 与权限。普通能力的 120 秒上限保持，会话 turn 可声明最多 12 小时；
宿主取消和进程终止仍生效。会话 turn 输入限额单独提高到 256 KiB，其他能力仍为 64 KiB。

`src-tauri/capability-plugins/codex/` 与 `pi/` 中新增真正的 v2 能力包源码。
原生引擎模块不接受旧 JSON-RPC 方法，也不生成 `agent/event`、`view/render` 或
`aibo/tool-request`。共享 `session-provider.mjs` 是能力实现内部的领域代码，复用
Capability runtime 2.1 的唯一传输，不新增一条会话专属运行协议。

- open/恢复只接收宿主 scope、workspace context 和私有数据目录，输入不能替换这些路径。
- turn 等待原生完成后才结算 invocation；流式事件与控制属于同一 invocation。
- 可写执行 profile 不能通过只读 turn 运行，必须拥有批准后的 workspace.write 权限。
- 模型、推理强度、Skills、Goal、Pi tree 等操作保留各提供者的已声明 schema，结果追加恢复快照。
- Pi Core 工具改为 `workspace.requested` 领域事件与 tool.respond 控制，不再使用旧反向 RPC。
- Broker 增加宿主观察回调：事件先持久化再交给领域投影；回调失败终止 invocation，取消和截止仍能打断回调。

进程测试 `test/session-capability-providers.test.mjs` 通过独立临时能力包启动 Node，
使用模拟 Codex App Server 和模拟 Pi SDK 验证流式、审批、用户提问、配置、模型/Skill/Goal
操作、跨进程恢复、Pi 消息标识、Core 读取链与禁止未批准写入。每项输出都按实际清单校验。
`session_contract::tests` 验证两个能力包的清单没有 Agent 贡献并拒绝篡改共享 schema。
Broker 的实际进程测试补充持久化先于宿主回调及投影拒绝的终止验证。

**尚未切换桌面应用。** 当前安装入口仍装载旧包，新包尚未接入发布打包；宿主会话管理、
事件投影、工具执行与批准、前端创建/控制/呈现路由仍需要切换。旧目录和旧 Host 仅在过渡中保留，
必须在替代链路完成后删除。尚不能宣称真实模型、完整功能等价或整个迁移已经验收。

本批完整验证：`pnpm run verify` 通过（25 项架构检查、184 项 Node 测试、类型检查及构建）；
Rust 217 项全部通过。本次 Rust 使用所需权限运行，包含需要 `ps` 的进程清理测试。

## 桌面会话宿主切换进度

工作区已将 AppState 的插件会话入口换为 SessionHost，与普通能力共用 Broker；
内置安装源改为 v2 Codex/Pi 包。通用发送、取消、恢复、关闭入口传入窗口身份，
无绑定会话直接返回 history_only。旧 provider 专属 IPC、旧 Host 和前端兼容层仍待删除，
因此这不是迁移完成声明；上节“尚未切换桌面应用”描述的是上一批次状态。

新增宿主领域事件及 v2 会话绑定合同。宿主负责事件投影、Pi Core 工具执行和审批、
恢复信息保存及轮次变更记录。恢复保存失败按执行失败处理，宿主失败事件和状态在
同一事务中保存，再通知界面，避免只发临时通知而留下无法重建的历史。

`session_host::tests::capability_session_projects_tools_and_recovers_after_process_restart`
通过真实 Node 能力包和模拟 Pi SDK 验证宿主工具读取、消息与事件入库、跨进程恢复、
窗口间取消隔离及中断事件持久化。该测试不代表真实模型或完整 Codex/Pi 功能验收。

## 旧插件宿主与传输退役

旧 `plugin_host.rs` 及其兼容模块已删除；此前旧 Host 专属回归随其实现退役，
新会话链路由 SessionHost/Broker 的真实进程测试覆盖，尚需补齐写入批准与功能等价验收。
共享 PluginRuntime 只接受能力协议 2.0/2.1，不再识别 Agent 事件、view/render 或旧反向工具请求。
传输回归改用能力 echo 包，并显式验证旧事件和旧工具请求被拒绝。
v1 清单仍可读，但启用检查明确拒绝，启动时取消旧安装的 enabled 标记。

归档归属 SessionHost；模型发现、Goal 与 Skills 通过能力契约调用。
前端旧能力、会话树和模型配置执行回退及模块已删除。
CodexManager 的线程列表、读取与分支功能尚待迁移；旧内置包源码、旧呈现接口、
原生特定快捷 IPC 与剩余协议资源仍需清理。这些剩余项完成前不能宣称整个目标已达成。

本批验证：Rust 完整回归 208 项通过（`--test-threads=4`，包含需要 `ps` 的进程清理测试）；
随后新增旧会话退役测试，SessionHost 两项回归均通过。退役测试验证旧包不可启用、
旧会话发送/恢复被拒绝且不产生轮次、历史文本保留，以及归档/取消归档不会恢复执行资格。
`pnpm run verify` 通过 25 项架构检查、185 项 Node 测试、类型检查和生产构建。
默认全量 Node 并发曾有两个未修改的测试文件停留不退出；四项测试单独运行正常。
最终通过临时 PATH 中的 Node 启动包装将 `node --test` 并发限制为 4，未修改测试断言、
超时或仓库脚本。原生模型与桌面交互验收仍未完成。

## 原生线程职责迁移

Codex 的 session.snapshot、session.fork 与工作区 thread.list 已声明为能力，
不再由 Rust CodexManager 创建原生进程。CodexManager、PiManager 及其源码已删除；
Pi 模型元数据转换移到纯函数模块 session_models，不包含运行时状态或进程控制。
旧 Rust 适配器的专属测试随实现退役，现有能力进程与宿主会话回归验证替代路径。

SessionHost 分支使用持久化的原生轮次 ID，不按轮次位置猜测映射。它在轮次准入锁下
验证完成边界、调用固定插件的分支能力，然后在事务内复制绑定、配置、边界内轮次与
消息。新分支有独立宿主和原生身份；首次恢复失败时已保存的分支仍可重试。

一个 Codex 包包含会话与工作区目录两个贡献。SDK 的 serveCapabilities 只在首次初始化
选择已声明贡献，同一进程代际不可切换。目录读取不创建会话；宿主尊重已有提供者绑定，
仅在尚未绑定且只有一个提供者时选定它，不因已有绑定失效自动换版。
Codex 能力插件在创建和恢复时验证原生返回的审批策略、沙箱与显式模型，拒绝降级。

证据：session-capability-providers.test.mjs 的快照/分支/目录/沙箱回归，
session_host::tests::codex_branch_uses_native_boundary_and_copies_host_history_and_profile。
这些测试使用真实 Broker/Node 子进程与模拟原生引擎，不宣称真实模型验收完成。

## 旧视图入口与编译资源退役

插件管理面板按 session scope 的 `aibo.session.open` 能力贡献生成创建入口，
不再读取旧 `manifest.agents`。旧视图轮询、动作 IPC、UiKit PluginView 合同及各皮肤
实现已删除；工作台草稿忽略历史 plugin 表单字段，保留 Git 草稿。呈现继续使用
WorkbenchPresentation 合同和宿主默认呈现。

Rust 不再编译旧 Agent runtime、视图和会话绑定的 schema 验证器；v1 清单验证器仅用于
识别历史安装元数据。桌面资源不再携带旧 `pi-sdk-host.mjs`，保留新 Pi 能力包需要的
锁定 SDK bundle。旧宿主脚本源码和旧行为探针尚在，不能据此宣称清理完成。

本批 `pnpm run verify` 通过；新增协议退役 Rust 回归通过，插件管理与草稿专项六项
通过。完整前端验证仍使用临时 Node 并发限制包装，仓库测试脚本未改变。

## 旧 Codex 包与 Pi 对比探针退役

旧 Codex 执行包源码和专用 v1 测试已删除。能力进程测试覆盖原生工具事件顺序、
推理摘要、Goal 清除，以及未产生首次 rollout 时的恢复与配置保留。v1 安装元数据
回归继续使用 Echo/Pi 历史清单，不依赖旧 Codex 可执行包。

Pi 的旧宿主对比探针及脚本入口已删除，替换为 `test/pi-capability-workflow.test.mjs`：
直接通过能力协议验证命令、Skills、推理配置、执行中队列控制、重试事件、树导航和
压缩结果。导航架构检查改为检查当前能力引擎。旧 Pi 包及其其余探针尚待迁移删除。

## 旧 Pi 执行源码退役

旧 Pi 包、独立 SDK host 和对应启动/恢复/模型 smoke 探针已删除。新 Pi 引擎移除了
CLI RPC 备用实现，只持有锁定 SDK 会话；SDK 事件仍按当前 provider 身份过滤。
旧 CLI 专用的延迟进程退出测试随该分支退役，统一 Broker 负责插件进程代际隔离。

新增能力工作流回归覆盖取消后继续发送、缺失/迟到的消息完成事件、长文本、结构化
历史及私有推理过滤、树导航往返、恢复时 profile 优先级、图片读取、写入和命令的
宿主响应控制。安装的真实 SDK 无凭据创建/关闭也通过。工具测试在协议边界模拟宿主
响应，不证明实际文件写入或审批正确；这部分仍需 SessionHost 集成验收。

`pnpm run probe:session:capabilities` 替代旧 Agent 专用探针入口。历史阶段记录与冻结
基线可以提及已删除文件，但 README 和当前支持矩阵指向能力架构。

## 宿主实际写入与审批验收

新增 SessionHost 集成回归通过真实 Broker/Node 能力包操作临时工作区文件，验证：
无轮次确认不执行、拒绝轮次确认不产生工具写入、工具审批等待时不提前写入、
其他窗口不能消费审批、拒绝工具审批不写入、批准后文件内容正确、已消费的审批
不能再次执行，以及重启恢复不重放之前的写入。

信任撤销场景发现并修复了等待泄漏：Broker 在作用域撤销后可能连错误工具响应也
拒绝。SessionExecution 现在在响应控制失败时取消所属调用，使宿主轮次结束，
避免插件无限等待。回归在审批等待期间撤销信任，验证目标文件保持原值且轮次结束。

本批四项 SessionHost 集成回归通过；`pnpm run verify` 通过 25 项架构检查、183 项
Node 测试、类型检查和构建。尚需命令执行取消、剩余专用 IPC 的身份传递与最终发布验收。

## 调用身份与命令取消

剩余 17 个 Pi/工作台快捷 IPC 已改为传入实际 WebviewWindow 身份，包括创建、发送、
配置、队列、树与时间线读取。SessionHost 中隐含 main 身份的便捷调用方法已删除，
架构检查禁止它们重新进入 IPC 路由；宿主主动卸载/关闭工作区仍按活动调用所属者清理。

新增 Unix 宿主命令集成测试：先确认轮次，再确认命令，观察命令实际启动后取消，验证
延迟的后续命令没有执行。该测试发现可写调用的 outcome_unknown 会把主动取消记录成
失败；现在宿主以自身取消标记记录 interrupted，并保留原始错误原因。命令取消专项通过。

本批验证中曾出现 Vite 样式扫描与 Rust 编译并发的 ENOENT：扫描到的 rustc 临时目录
被编译器移除，导致前端测试报告失败后仍保持进程。该未修改测试单独运行通过；确认并
终止对应测试子进程后获取了完整错误。后续前端验证与 Cargo 编译顺序运行，未修改断言。

## 未使用的专用 IPC 删除

已删除 24 个无前端调用的 Codex/Pi 专用 IPC 及其 API 导出：创建、发送、取消、关闭、
审批、用户输入、模型/推理配置、队列、压缩、命令/Skills、Goal、reload 和 snapshot。
前端原有通用会话/能力路由继续承担这些行为；线程目录、分支和 Pi 树等仍被使用的
查询/导航入口保留。移除 App 中无用的专用导入，架构检查改为禁止旧入口存在。
Rust 编译通过；此项不是通过保留兼容转发来满足协议退役。

## 原生桌面能力探针

新增 `pnpm run probe:session:desktop`，使用独立应用标识和临时 Git 工作区，保留隔离
数据目录供审计。它通过真实 WebView/Tauri IPC 验证内置 v2 Pi/Codex 包创建、快照、
时间线读取、停用/启用插件后的进程恢复及关闭；两套皮肤的工作台挂载通过。
2026-09-12 的成功记录为 `/tmp/aibo-session-native-result.json`，应用标识
`local.aibo.sessionprobe.1789221526940`。没有发送模型请求，也未验证物理键盘或读屏。

真实 Codex 暴露了离线 fixture 未覆盖的限制：原生线程读取可以提供元数据，但当前
引擎拒绝 `includeTurns:true`（list_turns is not supported yet）。会话快照不再请求
轮次列表；原生未给出轮次时 turnCount 为 null，清单明确允许未知值。分支仍要求
原生轮次边界可验证，不能绕过检查。新增该原生行为的离线回归通过。

旧 semantic-desktop 探针依赖已不存在的命令入口，本次运行失败；不将其历史结果
用作迁移完成证据。当前会话探针的成功不代表真实模型完整功能等价。

完整 Rust 回归 186 项通过（包括需要 ps 的进程清理测试），快照合同专项通过。
前端 CodexThreadSnapshot 同步允许 null；时间线和读取提示明确显示原生轮次未知。
