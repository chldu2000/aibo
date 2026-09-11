# P3 收尾：贡献合同、兼容与 release 生命周期

2026-09-12。本记录补齐 P3 的稳定语义合同、五种扩展点、包外私有数据和旧 release 回收。验收结果在文末；P4 写入与任意第三方呈现不在本批开放范围。

## 稳定语义合同与兼容决定

首个稳定语义版本为 `aibo.semantic-view/v1`，对应 manifest 的 `semanticView: 1.0` 和贡献 `contractVersion: 1.0.0`。正式 schema 是 [semantic-view.v1.schema.json](../contracts/semantic-view.v1.schema.json)。原 experimental-v1 schema 保持原样，独立读者继续接受旧数据；宿主新安装贡献输出稳定版本。AgentEvent、PluginView 与能力事件的版本分别管理。

插件只能在自己的命名空间定义 capability 和 operation；不能定义宿主核心视图类型、样式或布局。宿主治理的核心语义为 collection、detail、settings、inspector。settings 在 v1 中是只读配置摘要，inspector 是只读对象检查：两者都有明确对象 ID、最多 16 个标签/值、纯文本内容和截断标志。编辑字段、保存、审批与写入结果属于 P4，不能把它们塞进只读动作。选择这个边界是为了先保证已验证的数据和操作可跨 renderer 呈现。

稳定 v1 保留 P1 的有界 collection/detail 表达；新增通用 `inspect` 动作，并保留 `open-diff` 作为已有 Git 切片的兼容动作。动作仍经过宿主校验，能力不能借返回内容执行任意 IPC。输入 schema 不允许布局、脚本、HTML 或任意节点 patch。

兼容政策：稳定主版本内不重新解释既有字段，不删除必需语义；破坏性变更发布新主版本。新主版本提供后，旧稳定主版本至少再支持两个宿主 minor 发布且不少于 180 天，两项同时满足才可提出退出。弃用先在支持文档和发布说明公布替代合同、迁移方法及最早退出时间，届时仍需单独的退出决定。当前未宣布任何 v1 执行协议弃用，不以内部迁移完成自动删除 Echo/Codex/Pi adapter；历史读取与执行兼容分开处理。

| 合同 | 本批支持 | 承诺 |
| --- | --- | --- |
| Manifest v1 / Agent runtime 1.0 / PluginView 1.0 | 原有 adapter | 继续执行及读取旧历史 |
| Manifest v2 | 声明及只读贡献 | 保留原 manifest；不将 v2 Agent 误送 v1 runtime |
| capability runtime 2.0 | 当前精确版本，仍为实验协议 | 不自动接受未经验证的版本范围 |
| semanticView 1.0 / semantic contract 1.0.0 | 稳定 v1 | 当前 renderer 必须实现四种核心语义 |
| experimental-v1 semantic snapshots | 兼容读取 | 原 schema 不扩展、不静默重解释 |
| capability event 1.0 | 独立生命周期记录 | 不伪装为 AgentEvent |

## 扩展点合同

所有入口都是“打开宿主管理的语义贡献”，不描述固定面板位置。默认 UI 将它们放入命令面板；名字来自标题，点击后由当前 renderer 显示。能力调用不依赖这个 UI。session.action 在 P3 是只读动作入口，command 是打开贡献的命令入口，均不开放任意脚本或写入捷径。

| 扩展点 | 作用域与宿主上下文 | 默认可达入口 |
| --- | --- | --- |
| workspace.tool | workspace；可信 workspaceId | 选择工作区后打开工具 |
| session.context | session；同一 sessionId 及其 workspaceId | 选择会话后打开上下文 |
| session.action | session；同一 sessionId 及其 workspaceId | 选择会话后打开动作视图 |
| settings.page | application；workspaceId 为 null，无 sessionId | 应用设置贡献命令 |
| command | manifest 明确的 application/workspace/session | 对应上下文可用时的命令 |

工作区路径始终由 Broker 从核心身份解析；application 不获得工作区读取权限。visibility 只有 always、workspaceSelected、sessionSelected，不是表达式语言，也不授予权限；不可能满足的 scope/visibility 组合在 manifest 归一化时拒绝。宿主打开贡献时再验证作用域和可见性，不能仅依赖按钮 disabled。

每个 manifest 最多 128 项贡献，目录按插件 ID、release 创建顺序、installation ID、manifest 声明顺序确定排序；各扩展点允许多个贡献，不按物理面板分配唯一位置。运行视图最多 128 个 lease，空闲 30 分钟后按需回收；每次返回完整快照，单次最多 256 KiB，集合最多 50 项、总量最多 10000 项。revision 必须递增，旧上下文、旧 renderer/generation 和其他窗口的动作不能更新实例。

loading/empty/error/unavailable 均有标准状态和说明；刷新重新读取，失败显示重新加载入口。必需不兼容贡献阻止激活，可选语义贡献不兼容只将该贡献标为不可用并显示原因。未知扩展点在 schema 校验时拒绝。禁用、卸载或失去依赖会关闭对应 lease，迟到结果不重新挂回页面。两套皮肤及最小 DOM renderer 消费同一 JSON 合同。

## 旧包与私有数据

安装新版本产生新 release，不修改已有 session、invocation、依赖或显式 provider 绑定。新 Agent 会话按现有目录规则选择新启用版本；workspace/application 提供者仍须明确选择，不能用“升级”绕过用户绑定。运行中引用保持不变，失效不自动换包重试。

禁用先阻止新调用，再有界取消并排空；仍有 running invocation 的包不允许删除。卸载将安装标为不可用：若会话、provider 配置或依赖仍需要原 release，包移动到注册目录内的 `.retained-<installationId>`。恢复引用包括会话所需的传递依赖，即使父包也已卸载，仍保留完整依赖链。保留文件不代表恢复运行权限；必须重新安装同一 release 并启用才可执行。

应用启动恢复遗留 invocation 后检查 retired 包，仅清理没有恢复引用的包文件。closed 会话也保留恢复引用，避免为省磁盘损失历史恢复条件；用户删除会话或显式更换绑定后，后续回收才可能释放旧包。重新安装同一 digest 恢复原 installation ID，验证新副本后清理 retained 副本。安装记录、规范事件和历史不随包文件删除。

能力私有数据位于 `plugin-data/<pluginId>/<installationId>/v1/<instanceId>`，不在不可变包内。宿主通过 initialize 的 privateData 提供路径和格式版本，owner.json 记录所有者；目录和所有者文件拒绝链接或身份不符。release/实例各自隔离，重启复用，新 release 不自动读取或改写旧数据。这采用“版本并存”策略，暂不做隐式数据迁移，防止代码回滚后误读新格式。

卸载及旧包回收都不删除私有数据；当前没有自动数据清理接口。需要数据清理时应另设用户明确选择的流程，不能借卸载偷偷删除缓存、索引或恢复数据。此目录约束沿用可信本地插件边界，不声称提供 OS 文件系统沙箱。

## 验收

- Rust 全量 140 项通过；新增五扩展点真实进程、可选不兼容诊断、旧 release/传递依赖恢复引用、包外数据、缓存上限/空闲回收和工作区崩溃隔离测试。既有 v1 Echo/Codex/Pi Host 回归通过。
- pnpm run verify：23 项架构检查、140 项 Node 测试、类型检查、生产构建通过。
- [真实 App 双启动](./baselines/plugin-platform-p3/completion-native-results.json)：无 Agent、无 Git UI 时直接查 Git；两套皮肤打开 Git 两种安装贡献及新增设置、检查器、命令，刷新/禁用/卸载与重启保持通过。
- [桌面数据库审计](./baselines/plugin-platform-p3/completion-audit-results.json)：42 次 completed，42 组 admitted/started/finished；0 个 Agent session、0 个 AgentEvent、0 个 running。
- [双 renderer 浏览器结果](./baselines/plugin-platform-p3/completion-browser-results.json)及[插件管理回归](./baselines/plugin-platform-p3/completion-manager-results.json)通过。稳定 settings/inspector 在两套皮肤和 DOM renderer 上可读、可刷新；旧 Git 键盘、焦点、布局与恢复场景仍通过。
- [真实 Provider 结果](./baselines/plugin-platform-p3/completion-provider-results.json)：Codex transport/smoke/resume 通过，Pi 插件返回 AIBO_PI_PLUGIN_SMOKE_OK。此次未重跑联网写入审批；该项仍为 P4 门槛。

[退出矩阵](./baselines/plugin-platform-p3/completion-matrix.md)逐项对应证据。P3 的验收以只读能力为范围；P4 的写入审批、写后结果未知、写冲突与持久幂等单独保留。P3 收尾不自动发布包或开启 P4 写权限。
