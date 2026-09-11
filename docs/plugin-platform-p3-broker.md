# P3 第二批：Broker 与无 Agent 只读运行链

> 2026-09-11。已打通真实能力进程调用，P3.2/P3.3 仍在实施；这不是完整 Broker 或 Git 平台交付。

## 本批结果

启用依赖就绪的 v2 只读 capabilityProvider 后，宿主可以列举候选提供者、显式绑定某个安装 release，再调用真实进程。无需创建 Agent session，也不产生 AgentEvent。应用重启恢复的是绑定；进程按需重新启动并获得新 generation。

新增 `capability_broker.rs` 和迁移 `0025_capability_broker.sql`。`PluginRuntime` 复用原有有界进程传输，Agent v1 与能力实验协议 2.0 分别验证响应；v2 不能向旧 Agent 网关发送 tool request 或 AgentEvent。Registry 按真实支持范围允许只读提供者激活，继续拒绝尚未支持的 v2 Agent、语义视图、presentation 和写入能力。

## 调用合同

| 入口 | 用途 |
| --- | --- |
| `list_capability_providers` | 根据 scope、能力 ID 与精确契约版本列举启用且可用的提供者；不选择默认提供者 |
| `bind_capability_provider` | 保存安装 ID + contribution ID；只接受目录中的可用候选 |
| `invoke_capability` | 输入 scope/capability/version/requestId/input；调用者由 Tauri WebView 身份注入，不从请求读取 |
| `cancel_capability` | 通过当前窗口和 requestId 取消该窗口发起的活动调用；不能取消另一个窗口的请求 |

scope 支持 application、workspace 和 session。workspace/session 必须存在，关联工作区必须可信；路径由宿主数据库解析并置于运行上下文，用户输入不能覆盖。application 不获得工作区路径或 workspace.read 权限。session 的提供者必须属于其原有固定 installation；旧数据迁移改变 session pin 后，旧 Broker binding 失效。

窗口只拥有调用/取消身份；workspace/application 提供者配置是宿主共享配置，不按窗口各存一份。即使只有一个候选，也必须显式绑定；多个候选返回 `provider_selection_required`。新增 release 不改变已有绑定；失效绑定返回 `provider_unavailable`，不会自动调用新的安装。运行中的调用保留开始时选定的 release，修改配置只影响后续调用。

调用先校验 scope、声明、契约版本、权限与输入，再登记宿主生成的 invocation ID，关联固定 release、contribution、generation 和 deadline。插件初始化必须返回同一插件版本、generation 和声明中的 operation；结果必须带原 invocation/generation，通过输出 schema 和大小检查。过期或不匹配结果不会进入业务数据。

`requestId` 是窗口内取消关联键，不是幂等键；同一活动 requestId 不得重复。每次正式调用均有新的宿主 invocation ID，结束后重用 requestId 会执行新调用。Broker 不自动重试。

## 生命周期、限额与审计

- 进程复用键为 `(installationId, contributionId, scope)`，每个键最多一个活动调用；不同工作区使用不同进程与 generation。并发调用同一实例返回 busy，不排无限队列。
- 最多 32 个缓存实例、32 个已接纳的活动调用；空闲 5 分钟的实例在后续取用缓存时回收。缓存满且没有可回收实例时返回 busy。
- 输入最多 64 KiB，业务输出最多 256 KiB，沿用传输层 1 MiB 帧限制；进程标准错误只排空、不转发敏感原文。
- 操作 timeoutMs 覆盖已接纳调用的启动、握手和执行；宿主单调时钟执行超时，向进程传递绝对 deadlineUnixMs 作为上下文。目录查询/绑定准备不计入执行 deadline。
- 取消/超时清理当前 generation；因为一个实例只有一个活动调用，不会误杀同实例的其他调用。另一个工作区的进程继续执行。
- 桌面启停、卸载与工作区权限变更串行处理，避免重新启用与排空/卸载交错。禁用先阻止新调用，再取消该安装的活动调用并停止缓存进程；卸载先走同一取消路径，最多等待 6 秒排空。未排空时保留包并返回 busy，不继续删除。撤销工作区信任或移除工作区也取消对应作用域执行。
- 已接纳调用写入 `capability_invocations`，保存身份、release、generation、deadline 和终态，不保存请求/结果正文。应用启动将上次遗留 running 记录标为 interrupted；绑定和审计不会因卸载而消失。接纳前的参数/权限拒绝返回错误，本批尚未增加其独立审计记录。

当前只开放 read 操作和宿主 workspace.read 上下文；写操作和额外权限不通过激活；包依赖已由[第三批](./plugin-platform-p3-dependencies.md)接通。执行文件仍遵守现有可信本地插件边界，进程隔离不是 OS 文件/网络沙箱，能力声明也不是限制任意进程系统调用的机制。Git 包仍须实现并验证具体路径/资源范围检查。

## 验证

- `cargo test --manifest-path src-tauri/Cargo.toml`：117 项通过，包含真实 capability-echo 子进程、三类 scope、版本不符、伪造字段、错误输出/旧 generation、崩溃、超时、跨窗口取消拒绝、工作区取消隔离、信任撤销、release 绑定保持与 session pin 变化。既有 Echo/Codex/Pi 离线/Host 回归一起通过。
- `pnpm run verify`：23 项架构检查、131 项 Node 测试、类型检查和生产构建通过。
- `node probes/capability-native.mjs`：[原生结果](./baselines/plugin-platform-p3/broker-native-results.json)。独立应用数据目录、真实 WebView → Tauri → 能力进程，两次实际 App 启动，验证显式绑定、真实输出、宿主路径、伪造 caller 拒绝、取消、工作区隔离、重启恢复、禁用与卸载。未加载 Agent 工作台或 Git UI。
- [审计结果](./baselines/plugin-platform-p3/broker-audit-results.json)：原生 App 退出后只读检查隔离 SQLite，4 次 completed、1 次 cancelled；没有 Agent session 或 AgentEvent，没有残留 running。证据去掉临时目录和输入正文。

原生脚本成功报告后主动结束 Tauri dev 进程，子进程 ELIFECYCLE 日志不是验收失败；判定依据是外层退出码和 JSON 断言。本批没有重新请求真实 Codex/Pi 模型服务，联网 Provider 结果仍以 P2 记录为准。

## 仍需完成

1. 插件间调用的原始调用者、权限交集、调用链、嵌套 deadline/取消传播。包依赖图、环检测、可选贡献降级与依赖 release 固定已在第三批完成。
2. turn 关联上下文、审批、写入并发/幂等和结果未知，以及接纳前失败审计；v1 Agent 能力继续走 P2 facade，尚未改成 v2 runtime。
3. 稳定 instance ID、独立能力事件合同，以及完整生命周期/升级策略。当前进程复用键和 generation 能隔离调用，不等于这些合同已全部冻结。
4. Git 只读实现迁入能力包，安装语义贡献后自动呈现；settings/inspector 完整合同、扩展点可达性与稳定协议支持窗口。

P3 退出条件保持未完成；下一步应补 Broker 插件调用链，再将此运行链用于真实 Git 能力和语义贡献安装。
