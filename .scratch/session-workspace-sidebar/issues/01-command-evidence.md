# 两家 Agent 能提供哪些可核实的终端活动

Type: research
Label: wayfinder:research
Status: resolved
Assignee: terminal

## Question

分别核实 Claude Code 和 Codex 的命令、工作目录、工具调用标识、增量与最终输出、退出或失败信号。工具调用结束后，能否判断后台进程仍然存活？按本仓库已记录、上游接口可提供、尚待真实采样三个层次给出证据。说明现有徽章能证明什么，以及打开只读输出是否需要额外启动终端。

## Answer

从已有工具记录即可显示命令和已保存的结果。现有徽章能说明工具调用进行中，操作系统进程的存活则需要额外证据。Codex 有按命令归属的增量输出，aibo 当前取完成事件的聚合结果。Claude Code 有后台任务快照，Codex 有实验性后台终端列表。两者在目标版本中的事件时序、断线重连和拒绝执行仍须用真实样本验证。

[会话侧栏能显示哪些终端活动](../research/terminal.md) · 本地研究提交 `research/sidebar-terminal@58edf26`
