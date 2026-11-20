# 10: 审批卡片与原生选项

**What to build:** Agent 请求执行命令、修改文件或调用 MCP 工具时，对应的工具调用下面出现一张橙色审批卡片：命令显示全文、工作目录和理由；文件修改显示 diff；MCP 工具显示参数。写入源工作区以外路径的，醒目标注“写入其他工作区”。用户可以选择：批准本次、本会话内始终允许、永久允许（只在 Agent 提供时出现，写明写入位置，需要二次确认）、拒绝（可以附一句说明）、拒绝并停止这一轮。审批结果记为工具调用的属性。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（审批）。调研：`.scratch/multi-agent-workbench-v1/research/13-probes`。

**Blocked by:** 02（在 aibo 里和 Claude Code 对话）、03（在 aibo 里和 Codex 对话）

**Status:** resolved

- [x] Claude 审批走 control 协议：`--permission-prompt-tool stdio`，先发 `initialize`，接收 `can_use_tool`；响应字段的行为以官方 Python SDK 源码为准并实测（规格待验证项 4）
- [x] Codex 处理 app-server 推送的命令、文件修改、权限审批和 MCP elicitation
- [x] 各选项映射到原生决定：accept / acceptForSession / execpolicy 或网络规则 / decline / cancel；Claude 的 allow、采纳 `permission_suggestions`（destination 改为 session）、带 `interrupt` 的拒绝
- [x] Codex 拒绝时附的说明随下一条消息发出
- [x] 同一轮里的多个审批按出现顺序排列；审批不设超时
- [x] 主接缝测试用假 Agent 发出审批请求，覆盖每个选项传回适配器的决定和工具调用上记录的结果
- [x] 界面测试覆盖审批卡片的各个选项
- [x] 契约测试（环境变量开启）覆盖两家的批准和拒绝

## Comments

- 实现说明：
  - 适配器接口新增 `ApprovalRequested` 事件（含 Agent 原生选项）和 `Session.RespondApproval`。工作台把审批挂到它所拦的工具调用上，结果作为工具调用的属性保存；工具调用还没开始的审批先放在“游离审批”里，界面显示在输入框上方，工具调用开始后再挂上去。轮次结束时还没答复的审批标为“未处理，轮次已结束”。
  - 答复先记下、存好，再发给 Agent：Agent 一拿到答复，工具调用随时可能结束，而结束的消息不能再改。这个顺序问题是开竞态检测时发现的。
  - 顺带修了一个数据竞争：工作台交出去的消息原来和内部状态共用 `*Tool` 指针，现在一律深拷贝（`Message.Clone`）。
  - “写入其他工作区”：按审批涉及的路径判断，并解析符号链接（macOS 上 /tmp 就是 /private/tmp）。Claude 的命令带 `blocked_path` 可以判断；Codex 的命令请求不带路径，所以命令一般不会被标注。
- Claude（`--permission-prompt-tool stdio`，control 协议 `can_use_tool`），实测 2.1.318：
  - 批准本次：allow，原样回传 input。
  - 本会话内始终允许：把 Claude 的全部 `permission_suggestions` 的 destination 改成 `session` 回传，按钮上写明这些建议的内容。
  - 永久允许：只在有写入设置文件的 `addRules` 建议时出现，写明写入 `.claude/settings.local.json` 等位置。
  - 拒绝：说明作为工具结果交给模型（实测模型复述了说明）。
  - 拒绝并停止：带 `interrupt` 的拒绝，轮次以 `terminal_reason: aborted_tools` 结束，按中断处理。
  - 规格的待验证项 4 已回填。
- Codex：
  - 命令：accept / acceptForSession / `acceptWithExecpolicyAmendment`（只在 Codex 提出规则时出现，算作永久允许）/ decline / cancel。
  - 文件修改：同上，没有永久选项；diff 取自它所拦的 `fileChange` 条目。
  - MCP elicitation：accept / decline / cancel。
  - 拒绝的说明随下一条消息发出。
  - `item/permissions/requestApproval` 等其他请求仍自动拒绝。
- 暂不包含：审批档位和会话规则的记忆（任务 11）；侧栏标记和系统通知（任务 11）；退出时未处理的审批按拒绝处理（任务 13）。
- 测试：
  - 工作台：等待并记录答复、重启后答复仍在、游离审批、轮次结束时作废。
  - 适配器：两家的选项和答复映射，Claude 用录制的真实请求。
  - 界面：审批卡片，包括永久允许的二次确认、拒绝附说明、批准本次。
  - 契约测试（`AIBO_CONTRACT=1`）：真实的 Claude 和 Codex 各自请求两次，第一次批准、第二次拒绝并附说明，结果符合预期，本机已通过。
