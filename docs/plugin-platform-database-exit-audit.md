# P5 核心数据库与历史迁移退出核对

核对范围为当前嵌入式 migration 0001–0040、宿主数据库打开路径、旧 Agent/能力/写入历史读取。不将插件代码回滚等同于核心数据库降级；当前交付是旧库向前增量升级，没有通用数据库降级器。

## 数据库打开与表重建

`src-tauri/src/lib.rs::open_database` 在独立迁移连接运行 SQLx 嵌入式增量迁移，使用 WAL。迁移连接关闭外键执行以避免 SQLite 表重建触发历史级联删除，迁移后执行 `PRAGMA foreign_key_check`；检查失败不向业务暴露数据库连接。业务连接池恢复外键约束。

本轮迁移没有以删除历史列进行清理。存在的 DROP TABLE 用于复制后的 SQLite 约束重建或临时表清理，不能仅凭该关键字断言数据被删除：

| 迁移 | 重建原因与保留方式 | 当前回归证据 |
| --- | --- | --- |
| 0016 | messages 扩展 queued 状态；逐列复制已有消息并重建索引 | 本次检查逐列复制 SQL；它早于插件平台迁移，本文不将 migration 19 后写入的样本当作穿越 0016 的数据测试 |
| 0021 | sessions/process_runs 去除内置 Agent 枚举限制，添加安装版本字段；复制旧列并检查行数，再重建表；binding/event 新字段通过 ADD COLUMN 添加 | `plugin_registry::tests::session_migration_preserves_old_history_and_allows_external_identity` |
| 0029、0032 | 项目任务执行历史脱离任务定义生命周期，补快照、审批状态；保留旧记录与原字段 | `project_actions::tests::lifecycle_migration_keeps_v1_records_and_marks_backfilled_definition_origin` |
| 0036 | workspace_write_runs 增加审批阶段与字段；明确列出旧字段复制 | `workspace_write_runs::tests::request_migration_preserves_legacy_results_without_inventing_identity` |
| 0039 | 将没有事件流的旧能力执行记录另存为 legacy snapshot；不删除源记录、不伪造 CapabilityEvent | `capability_history::tests::pre_lifecycle_database_upgrade_archives_without_fabricating_events` |
| 0040 | 新增候选绑定表；原确认绑定与历史表保持原内容 | 旧库升级回归运行到当前版本；候选初始化失败、启动恢复与代码回滚回归 |

0029 的历史快照只知道迁移当时的任务定义，因此标注 `migration-current-definition`，不冒充原执行时的定义。该迁移的 JOIN 依赖旧库原有 action 外键关系；本验收覆盖合法旧数据库，不宣称修复任意损坏数据库。

## 历史可读与身份保留

| 要求 | 已检查的证据与实际断言 |
| --- | --- |
| 旧库走实际升级路径 | 磁盘数据库先建立 migration 19 状态，写入旧会话/消息/绑定/turn/进程/事件，再升级到 27 加入 v2 事件；通过应用 open_database 升到 0040 并再次重开 |
| AgentEvent v1/v2 保留 | 比较两个版本的原始 payload 和 schema_version；旧事件保留 1.0，新事件保留 2.0，不重新解释历史 payload |
| session/turn 身份与旧消息保留 | 比较 external_session_id、external_turn_id、generation_id；旧消息通过实际 session_history::read 返回 persisted-core 内容；重开无重复记录，外键检查通过 |
| 插件不可用也能读历史 | `session_history::tests::persisted_pi_history_reads_from_a_read_only_database_without_a_runtime`：插件停用且路径不存在；活动/归档两类会话各 151 条消息、4 页，全部唯一；数据库只读、进程数为零；跨 workspace/session 游标拒绝 |
| 新能力历史不冒充 AgentEvent | migration 27 旧库的 55 条主窗口记录与 1 条其他窗口记录升级后，CapabilityEvent 数仍为零；legacy 分页、窗口隔离、重开幂等和只读查询通过 |
| 旧写入事实不被补造身份或审批 | 任务历史保留旧输出、完成时间、请求和取消字段，旧审批为空；工作区写入保留结果 JSON 与完成时间，未知 request/caller/approval 仍为空 |

## 验证范围

上述测试均包含在本批次之前最近一次完整 Rust 回归的 213 项通过结果中（P5 release 退出批次）。本核对逐项阅读了实现和断言；没有因文档已勾选就推断数据安全，也没有仅用空数据库建表测试代替旧数据升级。

结合[release 恢复验收](./plugin-platform-release-recovery.md)中的原生重启后持久写入重放、卸载后历史读取，以及并存插件私有数据回归，P5 的核心数据库增量迁移和旧历史可读项完成。全阶段退出结论另行对照各阶段合同与证据，不由本文件代替。
