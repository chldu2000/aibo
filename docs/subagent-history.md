# 子 Agent 任务与过程历史

本文件定义子任务事件、持久化与界面交互；整体 UI 边界见 [UI 架构](ui-architecture.md)。

`SubagentCard` 和 `SubagentDialog` 是 `UiKitAdapter` 的语义控件，内置 ak-ui kit 提供实现。应用只传入任务、状态、最近活动和打开/关闭回调，不选择皮肤或提供视觉参数。详情沿用消息 Markdown、工具输出和思考摘要的展示方式；原生 modal dialog 提供焦点约束、Escape 关闭和返回触发按钮，关闭不会停止任务。阅读历史时保留滚动位置，实时更新以“有新内容”按钮提示。

## 提供者事件合同

所有会话提供者使用同一份 [session-event schema](../contracts/session-event.v1.schema.json)。
`subagent.updated` 描述任务快照，`subagent.message` 描述过程条目；字段、枚举和必填项以 schema 为准。
事件使用父会话身份和 `turnId: null`，`payload.rootTurnId` 必须指向真实宿主父回合，不能填原生子线程 turn ID。
任务 ID 和 parentId 应稳定，不能把派发完成当成任务完成，也不能从普通文本猜测子任务。

过程消息携带 `agentId`、`rootTurnId` 与完整 `entry` 快照；相同 entry.id 更新已有条目，
不能只发送 delta。只报告后端公开的消息或思考摘要。后端没有可用的过程数据时，
仅报告已知任务进度并明确降级，不合成虚假过程；运行中断、读取失败和缺失终态须有明确状态。

## 内置适配与持久化

Codex 插件把父子线程关联转换为上述事件，子线程完成不会结束父回合。已知子线程的通知实时更新过程；只读 `thread/read` 补齐错过的消息和没有广播的状态。父回复提前结束时，宿主执行流保留到已知子任务结束或读取明确失败，避免丢失尾部记录。

任务卡片存入主时间线，过程消息独立保存在事件历史中。`get_subagent_history` 只读取本地持久化历史，合并相同子线程 item 的最新内容，因此归档、重启或插件不可用时仍可回看。分叉会话保留分叉边界内的子任务过程。单条过程内容沿用有界输出策略，超过 48,000 个字符以省略号标记；界面展示提供方公开的思考摘要。

第一版接入 Codex 的结构化子 Agent 协议，其他提供方可以通过相同事件契约接入。普通文本中的“子 Agent”描述不会被推测成真实任务。

回归入口：`test/subagent-workflow.test.mjs`；涉及原生事件投影或持久化时，按[回归要求](plugin-boundaries-and-regression.md#regression-gate)补充相关 Rust 测试。
