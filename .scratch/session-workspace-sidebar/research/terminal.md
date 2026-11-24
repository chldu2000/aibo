# 会话侧栏能显示哪些终端活动

**现在可以交付只读命令记录。** 展开记录可以直接使用工作台保存的工具输入和结果。当前徽章只统计这段对话里状态为 `Streaming` 的 `Bash`、`shell` 调用，并递归统计仍在进行的父调用下的子调用。Codex 的开始条目甚至可能先于审批，所以徽章出现只说明调用已开始，徽章消失也不能证明后台进程已经退出。[徽章计数](../../../internal/shell/badges.go) · [现有只读结果视图](../../../internal/shell/render.go) · [Codex 命令审批顺序](https://developers.openai.com/codex/app-server/#command-execution-approvals)

## 仓库里已经记录了什么

| | Claude Code | Codex |
|---|---|---|
| 命令与归属 | 2.1.318 的 Bash 审批样本含 `input.command` 和 `tool_use_id`。协议样本中的通用 `tool_use.id` 与 `tool_result.tool_use_id` 能配对；子调用还带 `parent_tool_use_id`。审批样本只证明申请执行。启动进程的目录是会话工作区，`system/init.cwd` 也有实录。单次 Bash 的实际目录仍待采样。[审批原始字段](../../../internal/agent/claude/approval_test.go) · [工具配对](../../../internal/agent/claude/testdata/t1.jsonl#L52) · [子调用](../../../internal/agent/claude/testdata/sub.jsonl) · [初始化样本](../../aibo-v1-followups/research/07-probes/claude_at.jsonl#L4) · [启动目录](../../../internal/agent/claude/claude.go) | 同一 `threadId/turnId/item.id` 的开始和完成条目都记录命令、实际 `cwd` 和 `processId`。例如 `cat notes.txt` 返回两行，退出码为 0，完成条目仍带原 `processId`。只保存这个 ID 不能证明进程存活。[开始与完成样本](../../../internal/agent/codex/testdata/t1.jsonl#L28) |
| 输出与失败 | 适配器将通用工具结果的文本和 `is_error` 映射到完成事件，回复文本和思考增量进入对话。本仓库的 Read 结果走通了这条路径；Bash 的 stdout 增量、数值退出码和后台存活尚无对应的运行样本。[适配器](../../../internal/agent/claude/parse.go) · [Read 实录](../../../internal/agent/claude/testdata/t1.jsonl#L52) | 适配器读取完成条目的 `aggregatedOutput`；`failed`、`declined` 或非零 `exitCode` 均转为工具失败。规范化结果保留失败标记；原始顶层完成事件可携带数值退出码。另一样本以 0 退出且输出为 null。适配器明确忽略 `item/commandExecution/outputDelta`。[解析](../../../internal/agent/codex/parse.go) · [无输出样本](../../../internal/agent/codex/testdata/t2.jsonl#L21) · [忽略的通知](../../../internal/agent/codex/notices.go) |

工作台将工具结果限至 1 MiB 并记录截断。现有视图在工具报告完成后展示结果，小于 4 KiB 显示可选文本，其余使用只读编辑器。侧栏可以复用这些记录，打开输出无需额外启动终端、重跑命令或向原进程写入。[工作台](../../../internal/workbench/events.go) · [容量上限](../../../internal/model/model.go#L177) · [渲染](../../../internal/shell/render.go)

## 上游接口还能提供什么

- **Claude Code** 的 Bash 输入有 `command` 和可选的 `run_in_background`，命令间的目录变化可以延续。Bash 的结果可带 `backgroundTaskId`、`interrupted` 和输出文件路径；文档中 `stdout` 合并了命令的两个输出流，`stderr` 存放工具追加的提示。`tool_progress` 提供耗时和调用标识，不能据此逐行重建命令输出。后台 Bash 的输出可以从该任务产出的输出文件读取。[Bash 输入与输出](https://code.claude.com/docs/en/agent-sdk/typescript) · [工具进度](https://code.claude.com/docs/en/agent-sdk/typescript#sdktoolprogressmessage) · [后台 Bash](https://code.claude.com/docs/en/interactive-mode#background-bash-commands)
- **Claude 后台存活**可以由 `system/background_tasks_changed` 的最新全量快照佐证，按 `task_type=local_bash` 筛选并由 `task_id` 关联。任务开始时还可能提供 `tool_use_id`。`task_updated` 或 `task_notification` 可报告结束。快照在活动集合变化时发出；CLI 刚启动时不会主动发送，重复初始化后的补发行为有版本要求。断线后以重新同步的快照为准。[任务与快照](https://code.claude.com/docs/en/agent-sdk/typescript#sdkbackgroundtaskschangedmessage) · [终态处理](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py#L1504)
- **Codex** 提供按 `threadId/turnId/itemId` 归属的 `outputDelta`，可依到达顺序显示合并输出，最终以完成条目核对。运行时若支持实验性 `thread/backgroundTerminals/list`，可对已加载线程分页查询当时仍在运行的后台终端，按 `itemId/processId` 匹配。列表中的 `processId` 归 app-server 管理，`osPid` 另列且可空。aibo 初始化已声明 `experimentalApi`，仍需核实目标二进制实际实现该方法。两家的快照都只覆盖 Agent 跟踪的任务。[增量类型](https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionOutputDeltaNotification.ts) · [0.169.0 命令类型](https://raw.githubusercontent.com/openai/codex/rust-v0.169.0/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts) · [后台列表](https://developers.openai.com/codex/app-server/#clean-background-terminals) · [aibo 握手](../../../internal/agent/codex/codex.go#L213)

## 尚待真实采样

建议在隔离工作区按仓库支持的 CLI 版本录制四种结果：短命令非零退出、慢命令分段输出、工具返回后仍运行的后台任务、该任务结束并重连。Claude 需对齐 Bash 调用 ID、任务 ID、实际目录与输出文件；Codex 需对齐增量、最终输出、后台列表以及任务消失的时点。另录拒绝执行作对照。每份样本同时记录 CLI 版本和时间，缺少状态证据时显示“后台状态未知”。本次仅核对仓库记录与官方接口，未访问真实账号或启动付费 Agent。[仓库协议采样约定](../../../docs/agents/conventions.md) · [Claude 契约测试](../../../internal/agent/claude/contract_test.go) · [Codex 契约测试](../../../internal/agent/codex/contract_test.go)
