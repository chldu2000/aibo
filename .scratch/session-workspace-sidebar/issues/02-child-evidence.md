# 如何识别子 Agent 并取得可归属的消息

Type: research
Label: wayfinder:research
Status: resolved
Assignee: children

## Question

对 Claude Code 与 Codex，哪些标识能将委派任务、子消息、状态和结果归到正确的父会话？分别核实当前适配器已保存的内容、上游是否提供独立子会话读取，以及只收到工具卡或重启丢失上下文时能展示什么。区分真实样本、上游声明和仍须验证的能力。

## Answer

Claude Code 的前台委派已有使用父工具调用 ID 关联并落盘的子工具和子回复，真实样本的离线回放通过。Codex 目前可以展示父会话的协作工具卡；上游定义了目标子线程 ID、父线程关系和只读分页历史，独立时间线需要补上适配与实测。父调用的结果和子任务的最终状态各自需要证据。历史中缺失的步骤、清理过的子记录和重启留下的旧状态应保留其不确定性。

[子 Agent 归属与消息读取](../research/children.md) · 本地研究提交 `research/sidebar-children@afd8289`
