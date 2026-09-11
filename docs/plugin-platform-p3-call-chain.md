# P3 第四批：只读插件调用链

> 2026-09-11。接通能力插件之间的真实进程调用；[第五批](./plugin-platform-p3-git.md)已接通 Git 能力包与语义贡献安装。

## 调用规则

能力实验协议 2.0 新增插件 → Broker 的 `capability.call` 请求。旧的初始化、调用和结果信封继续有效，Agent v1 不接收新请求。插件请求包含父 invocation ID、generation、目标 plugin ID、contribution ID、能力版本和输入；宿主拒绝混合信封和额外身份字段。

插件只能调用当前 contribution 在 `packageDependencies` 中声明的直接依赖。目标使用已固定的安装 release，不读取工作区的能力提供者偏好；即使用户为同一能力选择了更新版本，也不会替换依赖绑定。目标贡献、契约版本、启用状态、包完整性、输入输出和 runtime 协商仍由 Broker 检查。

子调用沿用父调用的 scope、原始窗口身份及宿主解析的工作区。插件不能自行传入 scope、权限、路径、release、调用链或 deadline。子操作要求的权限必须属于父操作的有效权限；随后继续收紧为子操作声明的权限。因此不声明 `workspace.read` 的操作不会获得工作区路径，也不能通过依赖重新取得该权限。当前资源范围为同一工作区，后续 Git 包仍需完成路径级资源检查。

每层调用生成独立 invocation ID 和 generation。宿主向进程提供原始调用者、有效权限、完整调用链和绝对截止时间。子截止时间取父截止时间与自身 timeout 的较早值，宿主使用单调时钟执行；不能通过嵌套调用延长总执行时间。

## 取消、故障与限额

每个实例串行处理子调用，父调用等待子调用收尾后再继续。当前上限为 8 层活动调用（含根）、每次 invocation 最多 32 个子请求；重复子请求 ID 和再次进入当前链上的同一 release/contribution 被拒绝。沿用全局 32 个活动调用和每个 scope 实例单并发限制，超限返回 `busy`，不自动重试。

父调用取消、超时或进程退出后，后代调用停止并写入终态，父调用返回前不留下尚未收尾的子调用。取消检查间隔为 10 毫秒。另一个工作区的调用独立执行。子调用失败以宿主生成的结构化结果返回父插件，父插件可以处理可选失败；父调用本身取消或超时则结束整条分支。

运行时分别记录“主动停止”和“进程已退出”，避免将 Agent v1 的崩溃错误归为正常停止。不会将插件提供的错误原文转发到用户界面。

迁移 `0027_capability_call_chain.sql` 在调用审计中增加 parent/root invocation ID 与直接调用插件 installation ID。所有节点保留最初的窗口身份、作用域、release、generation、deadline 和终态；不记录输入输出正文。旧审计行的新字段保持空值，不推测历史调用关系。接纳前失败的独立审计仍待后续补齐。

## 验证

- `cargo test --manifest-path src-tauri/Cargo.toml`：128 项通过。新增 5 项真实进程测试覆盖三层调用、原始身份与审计关联、UI 新版本绑定不能改变依赖 release、伪造 generation/依赖/scope、权限扩大、父取消/超时/崩溃、其他工作区隔离、深度限制和无权限时不下发路径。旧 Agent 崩溃与 Echo/Codex/Pi 离线回归通过。
- `pnpm run verify`：23 项架构检查、134 项 Node 测试、类型检查和生产构建通过。新增协议测试拒绝额外身份字段、混合信封和 Agent tool 请求。
- `node probes/call-chain-native.mjs`：两次真实 App 启动，验证 WebView → Broker → 父进程 → Broker → 子进程的输出、原始窗口身份、固定 release、权限/工作区、过期 generation 拒绝，以及重启后调用和禁用依赖。[原生结果](./baselines/plugin-platform-p3/call-chain-native-results.json)。
- 原生退出后只读检查隔离 SQLite：4 个 completed 节点（两对父子）、2 个 permission_denied 父调用；子调用的 parent/root、原始窗口、直接调用插件、scope 和 deadline 关联均有效。0 个 Agent session/AgentEvent，无 running 残留。[审计结果](./baselines/plugin-platform-p3/call-chain-audit-results.json)。

原生脚本报告成功后主动结束 Tauri 开发进程；以外层退出码和 JSON 断言为准。未重新请求联网模型服务。

## 下一步

本批只开放既有 read 操作和 `workspace.read` 权限，不扩大写入能力。turn 关联、审批/幂等与结果未知、稳定实例身份、独立能力事件及完整升级/私有数据策略仍未全部完成。第五批已将 Git 只读实现迁入能力包，接通安装后的语义贡献呈现；接下来补齐生命周期与完整合同，再冻结稳定协议与兼容窗口，执行 P3 整体验收。
