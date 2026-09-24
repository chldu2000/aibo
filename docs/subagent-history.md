# 子 Agent 任务与过程历史

本文件定义子任务事件、持久化与界面交互；整体 UI 边界见 [UI 架构](ui-architecture.md)。

`SubagentCard` 和 `SubagentDialog` 是 `UiKitAdapter` 的语义控件，内置 ak-ui kit 提供实现。应用只传入任务、状态、最近活动和打开/关闭回调，不选择皮肤或提供视觉参数。详情沿用消息 Markdown、工具输出和思考摘要的展示方式；原生 modal dialog 提供焦点约束、Escape 关闭和返回触发按钮，关闭不会停止任务。阅读历史时保留滚动位置，实时更新以“有新内容”按钮提示。

Codex 插件把父子线程关联转换为 `subagent.updated` 和 `subagent.message`。这两个事件使用父会话身份、空 `turnId` 和经过宿主校验的 `payload.rootTurnId`，防止子线程完成事件结束父回合。派发调用完成不等于子任务完成。已知子线程的通知实时更新过程；只读 `thread/read` 补齐错过的消息和没有广播的状态。父回复提前结束时，宿主执行流保留到已知子任务结束或读取明确失败，避免丢失尾部记录。

任务卡片存入主时间线，过程消息独立保存在事件历史中。`get_subagent_history` 只读取本地持久化历史，合并相同子线程 item 的最新内容，因此归档、重启或插件不可用时仍可回看。分叉会话保留分叉边界内的子任务过程。单条过程内容沿用有界输出策略，超过 48,000 个字符以省略号标记；界面展示提供方公开的思考摘要。

第一版接入 Codex 的结构化子 Agent 协议，其他提供方可以通过相同事件契约接入。普通文本中的“子 Agent”描述不会被推测成真实任务。

回归入口：`test/subagent-workflow.test.mjs`；涉及原生事件投影或持久化时，按[回归要求](plugin-boundaries-and-regression.md#regression-gate)补充相关 Rust 测试。
