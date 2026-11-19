# 审批请求的通道与交互

Type: grilling
Status: resolved

## Question

Agent 请求执行命令、改文件、调用 MCP 工具时，aibo 怎样拿到审批请求，又怎样呈现给用户？
- Claude 走哪个通道：有文档的 `--permission-prompt-tool`（由 aibo 自己的 MCP 工具承接），还是 SDK 内部的 control 协议 `can_use_tool`？
- Codex 走 app-server 的 `item/commandExecution|fileChange|permissions/requestApproval`。
- 审批时要显示什么：命令、diff、工具参数？
- 提供哪些选项：批准、拒绝、本会话内始终允许？审批的初始模式和沙箱档位怎么定？
- 会话不在前台时，审批请求怎样提醒用户？

已有的约束：审批结果作为工具调用的属性记录；aibo 自己的读取工具免审批；退出时未处理的审批视为拒绝。

## Answer

**实测**（2026-11-20，Claude Code 2.1.318；脚本见 `../research/13-probes/`）：
- 用 `--permission-prompt-tool mcp__aibo__approve` 走 MCP 审批工具时，工具只能收到 `{tool_name, input, tool_use_id}`，**收不到原生的权限建议**。另外，`ls` 这类只读命令在默认模式下本来就不会触发审批。
- 用 `--permission-prompt-tool stdio` 加 control 协议时，在 stdin 上先发 `initialize` 请求，之后就能收到 `can_use_tool` 请求。它带有 `permission_suggestions`（例如 `addRules [Bash(touch …), Bash(npm --version)]`，`destination: localSettings`），还有 `display_name`、`description`、`decision_reason_type`。回复格式是 `{behavior:"allow", updatedInput}`，测试中审批生效。官方 SDK 的 `can_use_tool` 就是基于这个机制实现的。
- 两家原生的审批选项：
  - Codex 的命令审批有 `accept`、`acceptForSession`、`acceptWithExecpolicyAmendment`（永久）、`applyNetworkPolicyAmendment`（永久）、`decline`、`cancel`。
  - Codex 的文件修改审批有 `accept`、`acceptForSession`（同一批文件）、`decline`、`cancel`。
  - Claude 允许时可以附带修改后的输入，并采纳 `updatedPermissions`，作用范围可以是 `session`、`localSettings`、`projectSettings` 或 `userSettings`；拒绝时可以附带一句说明，也可以设 `interrupt` 中断这一轮。

**决定**：
- **通道**：
  - Claude 走 control 协议（`--permission-prompt-tool stdio` + `can_use_tool`）。这个协议没有公开规范，实现时以官方 Python SDK 的源码为准，每次 Claude 升级后都要重跑测试脚本。
  - Codex 用 app-server 推送的审批请求（命令、文件修改、权限，以及 MCP 工具调用的 elicitation）。
- **审批档位**：每个会话一个，可以在会话菜单里切换。规格里要写明每一档对应两家 Agent 的哪些设置；两家的语义只能做到近似一致。
  - **每次询问**（默认）：Claude 用 `default`；Codex 用 `on-request` + `workspace-write`。
  - **自动接受工作区内的修改**：Claude 用 `acceptEdits`；Codex 设置不变。
  - **全部自动**：Claude 用 `bypassPermissions`；Codex 用 `never` + `danger-full-access`。切换到这一档要二次确认，界面上要一直显示警示。
- **审批卡片**：挂在对应的工具调用消息下面。按请求类型显示：
  - 命令：命令全文、工作目录，以及 Agent 给出的理由。
  - 文件修改：diff（用 `editor.DiffView`）。
  - MCP 工具：工具名和参数。
  - 写入源工作区之外的路径时，加醒目的“写入其他工作区”标记。
- **审批选项**：以 Agent 原生的选项为准。
  - **批准本次**。
  - **本会话内始终允许**：Codex 回复 `acceptForSession`；Claude 采纳 `permission_suggestions`，但把作用范围改成 `session`。aibo 另外记下这条规则，续接或重启进程后重新生效：Codex 由 aibo 自动回复同类请求，Claude 在启动时用 `--allowedTools` 带上这些规则。这些规则可以在会话菜单里查看和撤销。
  - **永久允许**：只在 Agent 提供永久选项时显示。按钮上要写明写入位置（`.claude/settings.local.json` 或 `~/.codex` 规则），并要求二次确认。
  - **拒绝**：可以附带一句说明。Codex 的 decline 不能带说明，所以说明会随下一条消息发出。
  - **拒绝并停止这一轮**：Codex 回复 `cancel`，Claude 回复带 `interrupt` 的拒绝。
- **后台提醒**：后台会话有待审批的请求时，侧栏显示“待审批”标记，同时发 macOS 系统通知，点击通知跳到对应的审批卡片。同一轮里的多个审批请求按出现顺序排列。
- **不设超时**：审批请求会一直等用户处理。有待审批请求的会话，不会因为闲置 30 分钟而断开。
