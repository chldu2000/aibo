# 10: 审批卡片与原生选项

**What to build:** Agent 请求执行命令、修改文件或调用 MCP 工具时，对应的工具调用下面出现一张橙色审批卡片：命令显示全文、工作目录和理由；文件修改显示 diff；MCP 工具显示参数。写入源工作区以外路径的，醒目标注“写入其他工作区”。用户可以选择：批准本次、本会话内始终允许、永久允许（只在 Agent 提供时出现，写明写入位置，需要二次确认）、拒绝（可以附一句说明）、拒绝并停止这一轮。审批结果记为工具调用的属性。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（审批）。调研：`.scratch/multi-agent-workbench-v1/research/13-probes`。

**Blocked by:** 02（在 aibo 里和 Claude Code 对话）、03（在 aibo 里和 Codex 对话）

**Status:** ready-for-agent

- [ ] Claude 审批走 control 协议：`--permission-prompt-tool stdio`，先发 `initialize`，接收 `can_use_tool`；响应字段的行为以官方 Python SDK 源码为准并实测（规格待验证项 4）
- [ ] Codex 处理 app-server 推送的命令、文件修改、权限审批和 MCP elicitation
- [ ] 各选项映射到原生决定：accept / acceptForSession / execpolicy 或网络规则 / decline / cancel；Claude 的 allow、采纳 `permission_suggestions`（destination 改为 session）、带 `interrupt` 的拒绝
- [ ] Codex 拒绝时附的说明随下一条消息发出
- [ ] 同一轮里的多个审批按出现顺序排列；审批不设超时
- [ ] 主接缝测试用假 Agent 发出审批请求，覆盖每个选项传回适配器的决定和工具调用上记录的结果
- [ ] 界面测试覆盖审批卡片的各个选项
- [ ] 契约测试（环境变量开启）覆盖两家的批准和拒绝
