# 10: “始终允许”按钮太长，审批卡片超出窗口

**What to build:** 不管命令多长，审批卡片都待在会话区里，所有审批按钮都看得见、点得到。按钮只写动作（“本会话内始终允许…”“永久允许…”），要允许的具体规则写在按钮外面，可以完整查看。

现状（用户实测：命令很长时，“始终允许某条命令”的按钮撑出了窗口）：
- 适配器把规则全文拼进了选项的 `Label`：
  - Claude（`internal/agent/claude/approval.go` 的 `options`）：`"本会话内始终允许（" + 各条建议的 describe + "）"`、`"永久允许（…）"`。Bash 的建议规则通常是 `Bash(<整条命令>)` 或 `Bash(<前缀>:*)`，`describe` 原样写进 `ToolName(RuleContent)`，所以命令有多长，按钮就有多长；有多条建议时还会用“、”连起来。
  - Codex（`internal/agent/codex/approval.go`）：`"永久允许（以 " + strings.Join(p.Amendment, " ") + " 开头的命令）"`，同样带着命令全文。
- 外壳（`internal/shell/approval.go` 的 `approvalCard`）把 `o.Label` 直接画成 `ui.Button`，按钮是单行的、不换行。按钮那一行虽然 `Wrap()`，但单个按钮本身就比会话区宽，换行也没用。
- 同样的长文字还出现在审批档位弹出面板的“本会话内始终允许”规则列表里（`level.go`，`r.Label`），以及会话详情里。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `agent.ApprovalOption` 区分按钮文字和规则内容：`Label` 只写动作（例如“本会话内始终允许”“永久允许”），规则的描述放进单独的字段（例如 `Detail`，或者直接用已有的 `Rules[].Label`）。Claude、Codex 适配器都改，现有的适配器测试跟着改
- [x] 审批卡片：按钮只显示短文字；鼠标悬停或点开“始终允许…”时，显示会允许哪些规则（永久允许本来就有二次确认，规则内容放进确认这一步）
- [x] 规则内容很长时：限高、可以滚动或展开，等宽字体，长串可以断行；不会撑宽卡片
- [x] 审批档位面板和会话详情里的规则列表：每条规则一行，过长时省略中间部分，悬停显示全文，“撤销”按钮始终可见
- [x] 顺带检查卡片里的命令全文、MCP 参数、工作目录、涉及的路径：不含空格的长串不撑宽卡片，多行命令不把按钮挤出可见区域（diff 已经放在 `ui.Scroll(c).MaxHeight(280)` 里，可以照着做）
- [x] 界面测试（无头渲染）：一条一万字符、不含空格的命令，带 Claude 的 `Bash(<整条命令>)` 建议和 Codex 的 `Amendment`，卡片宽度不超过会话区，所有按钮都在可见区域内；截图存进实现说明

## 实现说明

- `agent.ApprovalOption` 加了 `Detail []string`：AllowSession、AllowAlways 会允许的规则，一条一行。`Label` 只写动作。
  - Claude：“本会话内始终允许”，Detail 是每条建议的 `describe`；“永久允许”，Detail 是写进设置文件的那几条。
  - Codex：“本会话内始终允许”，Detail 是会话规则的 `Label`（“命令 …”“修改 …”）；“永久允许”，Detail 是“以 … 开头的命令”。
  - 适配器测试的 `labels` 把 Detail 一起列出来，断言随之更新。
- 审批卡片（`internal/shell/approval.go`）：
  - 按钮只写动作。“本会话内始终允许”和“永久允许…”的 Tooltip 写着会允许什么，截到 200 字。
  - 按钮下方有折叠的“查看将允许的规则”，展开后每个选项的规则放在限高 120、可滚动的等宽文字框里，长串会断行。永久允许的二次确认里同样列出规则全文。
  - 命令放进限高 160 的滚动框，MCP 参数放进限高 200 的滚动框。工作目录单行，涉及的路径最多两行，都从中间省略，悬停看全文。理由最多 6 行。
  - 卡片带 Label“审批卡片：<标题>”，方便测试找到卡片的边界。
  - 已答复的审批（“审批：…”）单行、从中间省略：v1 时存下的旧审批，选项文字里还带着规则全文。
- 卡片撑宽的根因：消息列表里每条消息那一列（`view.go` 的 `Column.Grow(1).MaxWidth(820)`）和会话详情里 `kv` 的值那一列，宽度不会缩到内容的最小宽度以下（和 CSS flex 的 `min-width: auto` 一样）。两处都加了 `MinWidth(0)`。
- 规则列表（审批档位面板、会话详情）共用 `ruleRow`：单行，从中间省略，悬停显示全文（截到 300 字），“撤销”按钮不收缩。“撤销”按钮的 Label 截到 200 字。
- 测试 `TestLongCommandApprovalCard`：一条一万字符、不含空格的命令，同时带 Claude 式的 `Bash(<整条命令>)` 会话规则和 Codex 式的永久前缀规则。检查以下几种状态下，卡片和所有按钮都在窗口内：初始、展开规则、永久允许确认。之后选“本会话内始终允许”，检查会话详情和审批档位面板里的“撤销”也在窗口内。设了 `AIBO_SCREENSHOT=<目录>` 时保存截图。

截图（无头渲染，1100×800）：

- [卡片](../research/10-screenshots/card.png)
- [展开规则](../research/10-screenshots/card-rules.png)
- [会话详情里的规则](../research/10-screenshots/details-rules.png)
- [审批档位面板里的规则](../research/10-screenshots/level-rules.png)

## 没有验证

- 没有在真机上用真实的 Claude、Codex 触发一条长命令审批，只用了假 Agent 和无头渲染。
- 多行命令（带换行）没有单独测，按同样的限高滚动框处理。
