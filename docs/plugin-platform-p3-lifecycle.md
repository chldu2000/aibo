# P3 第六批：实例身份、turn 关联与能力事件

> 2026-09-12。完成只读能力运行的身份与事件记录；P3 的扩展点合同、私有数据和 release 回收仍待完成。

## 结果与原因

同一个安装 release、contribution 和 scope 对应一个持久化 instance ID。应用重启、取消后重启进程或空闲缓存回收不会改变这个身份；新进程仍生成新的 generation ID。这样历史可以关联同一能力实例，同时继续用 generation 拒绝旧进程结果。不同工作区和不同 release 不共用实例身份。

迁移 `0028_capability_lifecycle.sql` 新增 `capability_instances`。Broker 懒启动时取得或创建身份，初始化、调用上下文和宿主返回值均带 `instanceId`。原有 32 个缓存实例、每实例一个活动调用、空闲五分钟后按需回收的规则保持有效。回收进程不删除持久化身份；旧审计行允许 instance ID 为空，不伪造历史。

## turn 只负责关联

`invoke_capability` 可以传可选的 `turnId`，使用核心数据库中的 turn ID。宿主在接纳和启动进程前验证归属：

- workspace 调用只能关联本工作区的 turn。
- session 调用只能关联本 session 的 turn。
- application 调用不能关联 turn。
- 关联不创建 session/turn，不要求 turn 仍在执行，也不授予额外权限。

子调用继承父调用的 turn，插件不能通过子调用请求覆盖。Git 工作台不传 turn，仍然完全不需要 Agent 会话。删除对话后，审计保留原关联 ID；这只是历史标识，后续调用仍须重新验证 turn 存在。此批提供关联事实，没有新增时间线 UI。

## 独立能力事件合同

[capability-event.v1.schema.json](../contracts/capability-event.v1.schema.json) 定义宿主生命周期事件，`schemaVersion` 为 `1.0`，与 AgentEvent 的版本和存储分开。它不开放任意插件进度通知或事件订阅。

| 类型 | 含义 |
| --- | --- |
| `admitted` | 调用已接纳并写入审计，generation 尚未确定 |
| `started` | 进程已完成握手，绑定 generation；不保证业务执行已成功 |
| `finished` | 调用完成或失败；status 为 completed、取消/超时等错误码或 interrupted |

事件包含 invocation、instance、release、contribution、契约版本、scope、turn、父/根调用、generation、时间和全局递增 sequence。不记录请求与结果正文。启动前失败可以只有 admitted/finished；接纳前拒绝尚不产生生命周期事件。

事件是当时的快照，后续设置 generation 不会重写 admitted。SQLite 触发器让审计状态修改和事件追加处于同一个原子数据库语句；事件写入失败会使该状态修改失败。应用启动恢复遗留 running 调用时也追加 finished/interrupted；重复恢复不再追加。

`list_capability_events(scope, afterSequence, limit)` 提供按游标读取，最多 100 条。窗口身份由 IPC 注入，查询只返回该窗口、该作用域的事件；工作区仍须存在且可信。序号在整个数据库递增，过滤后可能有空隙，调用方使用最后收到的 sequence 继续读取。应用重启保留序号和历史。

## 验证

- Rust 全量 135 项通过，包括真实进程重启后的 instance 保持、不同工作区实例隔离、事件 schema/历史快照、窗口隔离、分页与上限、重复恢复、turn 归属校验和子调用继承。原有 Echo/Codex/Pi Host 回归通过；未重新调用联网模型。
- 实际 macOS App 双启动通过：[原生验证结果](./baselines/plugin-platform-p3/lifecycle-native-results.json)。WebView 经 IPC 验证三阶段事件、重启后 instance 不变而 generation 更新、事件游标继续使用、禁用/重新启用/卸载。
- pnpm run verify：23 项架构检查、137 项 Node 测试、类型检查和生产构建通过。没有新增 UI 或修改皮肤合同。

## 后续边界

本批不代表 P3 完成。接下来仍需 release 活动引用与安全回收、包外版本化私有数据、完整扩展点及 settings/inspector 合同、协议支持窗口和最终兼容验收。写入审批、写后结果未知等按 P4 实施，不能以当前只读测试替代验收。
