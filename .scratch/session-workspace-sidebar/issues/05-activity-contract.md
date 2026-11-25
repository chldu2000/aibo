# 用户怎样区分正在执行的活动、已结束的调用和缺失的记录

Type: grilling
Label: wayfinder:grilling
Status: resolved
Blocked by: 01, 02

## Question

依据两家的证据，决定打开终端或子 Agent 徽章后列出哪些活动、怎样选择并发任务、在何时更新徽章，以及怎样查看已经结束的任务。明确最终输出、实时日志、上次已知状态和可读取的子会话各自的显示条件；给出中断、切换窗口和恢复历史会话的验收例。

## Answer

终端和子 Agent 徽章列出当前会话里已记录的工具调用，按线程、轮次和条目绑定并发事件。一项活动直达详情，多项活动先给列表。调用完成、执行失败、后台存活、子任务结束各自依据独立证据显示。恢复历史会话时，只有拿到当期证据的活动才算运行中，其余显示上次已知状态或未知。实时输出、后台状态和原生子历史作为协议增强，只在对应 Agent 能提供时显示；拿不到时退回已存记录，并说明缺失原因。

[首期交付规格 · 活动数据与适配器](../../readonly-sidebar-v1/spec.md) · 实施：[命令和结果](../../readonly-sidebar-v1/issues/02-commands.md)、[委派记录](../../readonly-sidebar-v1/issues/03-children.md)、[增量输出](../../readonly-sidebar-v1/issues/08-command-stream.md)、[后台终端](../../readonly-sidebar-v1/issues/09-background.md)、[原生子历史](../../readonly-sidebar-v1/issues/10-child-history.md)
