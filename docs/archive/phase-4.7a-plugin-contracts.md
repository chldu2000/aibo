# Phase 4.7A：Agent 插件契约与迁移设计

> 状态：已完成（2026-09-08）
> 决策：[ADR-0001](adr/0001-process-isolated-agent-plugins.md)
> 后续：P4.7B 最小外部插件闭环

## 1. 交付范围

P4.7A 只冻结宿主与插件之间的边界，不实现插件安装、注册表、进程监管或 Renderer。交付包括：领域术语、进程边界 ADR、插件清单、运行时协议、声明式视图、`AgentEvent v2`、Native Session Binding、能力与错误模型、权限边界、迁移设计，以及第三种测试 Agent 的可回放闭环。

权威机器契约位于：

- `contracts/plugin-manifest.v1.schema.json`
- `contracts/agent-runtime-protocol.v1.schema.json`
- `contracts/plugin-view-protocol.v1.schema.json`
- `contracts/plugin-session-binding.v1.schema.json`
- `contracts/agent-event.v2.schema.json`

`fixtures/plugins/echo-agent.lifecycle.jsonl` 是协议样例和 P4.7B 的首个外部插件验收输入。

## 2. 当前基线审计

| 边界 | 当前实现 | P4.7A 决策 |
| --- | --- | --- |
| Agent 类型 | TypeScript、Rust 分派和 SQLite `CHECK` 封闭为 Codex/Pi | `agentId` 改为不透明、稳定、全局唯一字符串；生产业务路径不得枚举厂商 |
| adapter 进程边界 | Codex adapter 在 Rust Core；Pi 由 Rust 管理 SDK host | 厂商逻辑移到进程外 Agent Plugin；Core 仅保留监管和权威策略 |
| durable event | `AgentEvent v1` 的 agent/transport 枚举封闭 | v1 原样兼容读取；插件事件经 Core 校验、编号后写为 v2 |
| v1 实际漂移 | TS/Rust 已使用 `user_input.*`、`waiting_user`、`compacting`，权威 v1 schema 未包含 | 不回写或放宽冻结 v1；v2 收录当前语义，兼容层按历史实际值容错读取并记录诊断 |
| installation | `agent_installations` 同时表达 Agent 探测和安装 | 分离 Plugin Installation、Agent Contribution 和依赖诊断 |
| binding | 只保存 native ID、generation 和 adapter version | 保存固定 Plugin Release、Agent ID、协议版本和版本化 recovery data |
| UI | 页面按 Codex/Pi 能力和布局分支 | 插件只提交受限语义树；Renderer 只经 `$lib/ui-kit` 输出视觉组件 |

这里的“兼容读取”不等于修改旧 schema。旧数据可能包含历史实现曾写入但 v1 文件未列出的状态，读取器应将其作为已知历史变体投影并产生迁移诊断；新插件不得产生 v1 数据。

## 3. 标识和版本

- `pluginId`：反向域名形式的全局稳定标识，例如 `dev.aibo.echo`。
- `pluginVersion`：SemVer；与 package SHA-256 一起构成不可变 Plugin Release。
- `pluginInstallationId`：Aibo 为本机安装记录分配的 ULID。
- `agentId`：Agent Contribution 的全局稳定标识，例如 `dev.aibo.echo.agent`；升级不得改变。
- `sessionId`：Aibo 分配的 ULID，插件只能回显，不能创建或替换。
- `nativeSessionId`：插件/厂商拥有的不透明 ID，可以为空或因成功迁移而变化。
- `generationId`：Core 为一次受监管进程启动分配；插件消息不能自行声明权威 generation。
- Runtime、View、Event、Binding 和 recovery data 各自独立版本化，不能由 plugin version 推断。

## 4. 运行时协议

transport 是 UTF-8、LF 分隔的 JSON-RPC 2.0；每行恰好一个对象。stdout 仅承载协议，stderr 仅承载限量、脱敏诊断。初始化是每个 Runtime Generation 的第一条请求。

基础方法：

| 方法 | 方向 | 语义 |
| --- | --- | --- |
| `aibo.initialize` | Core → plugin | 协商 Runtime/View 版本，核对 Plugin Release，传入权限解析结果 |
| `aibo.diagnose` | Core → plugin | 检查入口、原生 Agent、认证及依赖，不创建会话 |
| `session.create` | Core → plugin | 为 Core 已创建的 Session 建立 native binding |
| `session.resume` | Core → plugin | 使用固定 Plugin Release 和版本化 recovery data 恢复 |
| `session.close` | Core → plugin | 关闭运行资源，不删除 Aibo 历史 |
| `turn.send` | Core → plugin | 发送结构化输入；接受响应不代表 turn 完成 |
| `turn.cancel` | Core → plugin | 幂等请求中止指定 turn |
| `operation.invoke` | Core → plugin | 仅调用 manifest 中已声明、带命名空间且输入已校验的扩展操作 |
| `aibo.shutdown` | Core → plugin | 有界优雅退出；超时后 Supervisor 可终止进程 |
| `agent/event` | plugin → Core | 提交待校验的归一化事件候选 |
| `view/render` | plugin → Core | 提交完整、递增 revision 的声明式 Plugin View |

Core 对请求设置超时和最大消息大小。重复 JSON-RPC 响应、未知 ID、未知 session、旧 generation、非递增 view revision 和超限消息均拒绝并记诊断。取消与完成竞态以 Core 已持久化的第一个终态为准，迟到终态不能逆转状态。背压时 Core 可以暂停读取或终止失控进程，但不能把一个插件的丢帧扩散到其他 Runtime Generation。

插件发出的 `agent/event` 没有 `eventId`、权威 sequence 或 generation。Core 验证其 Agent/Session/native binding 和 payload 后，分配这些字段并持久化为 `AgentEvent v2`。

## 5. 能力、扩展操作与错误

清单提供可发现能力，`aibo.initialize` 返回实际能力子集，会话状态决定当前可执行操作，Core 在每次请求前再次校验。标准 capability 使用 `session.*`、`turn.*`、`stream.*`、`model.*`、`command.*`、`approval.*`、`user-input.*`、`queue.*`、`compaction.*`、`skill.*`、`plan.*`、`goal.*` 和 `view.*` 命名空间；插件扩展必须使用 `ext.<pluginId>.*`。

最小闭环要求 `session.create`、`session.resume`、`session.close`、`turn.send`、`turn.cancel`、`stream.text` 和 `view.standard`。清单中的扩展操作必须声明 operation ID、所需 capability、输入 schema 和输出 schema；调用统一经过 `operation.invoke`，且 Core 必须核对当前 Plugin Release 的 manifest、实际 capability、输入 schema、会话状态和权限。协议不提供按任意 method 名转发的入口。

稳定错误 kind 为：`protocol_incompatible`、`manifest_mismatch`、`not_initialized`、`capability_unsupported`、`permission_denied`、`invalid_request`、`invalid_session`、`invalid_recovery_data`、`dependency_missing`、`timeout`、`busy`、`cancelled` 和 `internal`。JSON-RPC 数值 code 只用于协议分类，产品逻辑使用 `error.data.kind`；错误同时声明 `retryable`，面向用户的 message 必须脱敏。

## 6. 权限边界

插件清单只能请求权限，不能授予权限，也不能声称强制保证。初始化时 Core 为每项请求返回：

- decision：`granted`、`denied` 或 `unsupported`
- enforcement：`core-proxy`、`os-sandbox` 或 `agent-native`
- constraints：工作区范围、网络状态或命令策略等可审计限制

只有 `core-proxy` 和已经验证的 `os-sandbox` 能作为宿主强制保证。`agent-native` 必须在 UI 明示，不能被表述为 Aibo 沙箱。无法实现 requested profile 时拒绝操作或报告 unsupported，不静默提升权限。插件不能直接访问 SQLite、Tauri IPC、artifact store 或其他插件进程；Core 仅在相应 grant 生效时提供工作区路径或代理操作。

## 7. Plugin View Protocol

Plugin View 是完整文档，不是脚本或 DOM patch。每份文档包含稳定 `viewId`、递增 `revision`、稳定 node ID、语义节点树、可选 JSON 数据、JSON Pointer binding、声明过的 action 和已校验资源引用。

v1 允许的节点集合为 `stack`、`row`、`grid`、`panel`、`toolbar`、`text`、`markdown`、`badge`、`list`、`item`、`tree`、`timeline`、`code`、`diff`、`form-field`、`button` 和 `empty-state`。属性只表达 tone、density、gap、对齐、内容、表单值和动作；schema 明确拒绝未知属性，因此 `class`、`style`、颜色、皮肤 ID、脚本和任意 HTML 均不能进入 Renderer。

动作只能引用文档 `actions` 中声明的 ID，且 Core 必须再检查 capability、输入 schema、会话状态和权限。交互状态由 `(sessionId, viewId, nodeId)` 保存，完整 view revision 更新和皮肤切换都不能清除选中项、表单草稿或焦点恢复目标。未知组件或 SDK 版本产生可解释的宿主降级视图。

## 8. 数据迁移设计

P4.7B/C 新增 migration，不修改 `0001` 或其他历史 migration：

1. 新建 `plugin_installations`，记录 installation ID、plugin ID/version、package digest、来源、安装路径、manifest、启用状态和时间戳；唯一键为 `(plugin_id, plugin_version, package_digest)`。
2. 新建 `agent_contributions`，引用 installation，记录全局唯一 agent ID、展示元数据、声明能力和默认 view。
3. 重建 `sessions`，把封闭 `agent` 列替换为 `agent_id`，并加入固定 `plugin_installation_id`；保持 session 主键不变，使所有现有外键继续关联同一记录。
4. 重建 `process_runs`，去除 agent CHECK，记录 installation、agent ID、generation 和 runtime protocol version。
5. 扩展 `session_bindings` 为 `plugin-session-binding/v1` 的列投影：plugin/agent identity、native ID、Runtime 版本、recovery schema/version/data 和更新时间。
6. `agent_events` 增加 schema version 和 v2 source 投影；原有行标记为 `1.0`，不重写 payload。
7. 将现有 `codex`、`pi` 行映射到随应用分发的固定 Plugin Installation 与 Agent Contribution；无法确定的历史 binding 保留历史读取能力并标为不可恢复，而不是猜测版本。
8. 在事务提交前运行行数、主键、外键和 binding 映射校验；失败整笔回滚。升级后运行 `foreign_key_check`，并用旧数据库 fixture 验证历史时间线可读。

SQLite 重建期间必须保持依赖表的 session ID 不变，不能通过级联删除旧 `sessions` 表。具体 migration 应使用临时表复制、完整性校验和原子换名，并在目标平台验证 SQLite 外键行为。

## 9. P4.7A 退出证据

- ADR 明确更新原冻结的进程边界，并记录拒绝的替代方案。
- 五份 JSON schema 均可解析，版本、ID、路径、能力、错误、视图属性和 binding pinning 有自动化断言。
- Echo Agent fixture 覆盖 initialize、diagnose、create、stream、标准视图、cancel、进程重启和 resume；测试可重放并验证关联和终态。
- v1 不被修改；测试显式锁定其冻结枚举，同时验证 v2 支持插件 identity 与现有工作台事件。
- 权限强制层、错误稳定 kind、版本协商和 migration 回滚原则均已明确。

P4.7B 应先实现 Echo Agent 外部进程闭环，让当前 Codex/Pi Manager 暂经内部兼容层进入统一 Session Router；在该闭环通过前不迁移内置插件，也不扩建通用 UI 框架。
