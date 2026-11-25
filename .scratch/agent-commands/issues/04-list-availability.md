# 命令清单在什么时候可用

Type: grilling
Label: wayfinder:grilling
Status: open
Blocked by: 01

## Question

新会话发出第一条消息前、恢复会话前、Agent 进程退出后，aibo 都可能没有原生会话。按 01 得到的报告时机和启动开销，决定这时补全列表显示什么：空、沿用同一 Agent 同一工作区上次的清单，还是提前启动进程。说明清单变化（Claude 的 `commands_changed`、Codex 的 `skills/changed`）时怎样刷新，以及清单是否需要落盘。
