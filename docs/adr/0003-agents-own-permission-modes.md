# 0003：权限模式用各家 Agent 自己的列表

**Status:** accepted

## Context

v1 的审批档位是 aibo 自己的三档（每次询问、自动接受工作区内修改、全部自动），由适配器换成各家的设置。两家的模式不是一一对应的：

- Claude Code 有六种：`default`（Manual）、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`。
- Codex 的 `/permissions` 是 `sandbox`、`approvalPolicy`、`approvalsReviewer` 三项的四个预设：Read only、Ask for approval、Approve for me、Full access。

硬凑成三档的结果是：Codex 的前两档完全一样，名字也和实际行为不符；两家各有用不上的模式；用户在 aibo 里看到的名字和在 Agent 里看到的对不上。

实测（Claude Code 2.1.318、codex-cli 0.169.0，见 `.scratch/aibo-v1-followups/research/11-permission-modes.md`）确认两家的所有模式在 aibo 驱动它们的方式下都能用、能在两轮之间切换，Agent 自己也会报告当前的模式。

## Decision

每家 Agent 提供自己的权限模式列表（`agent.PermissionMode`），名字和说明用 Agent 自己的。会话存的是模式 ID，空即 Agent 标为默认（`Default`）的模式。工作台和外壳只认三个语义字段，不认识具体的模式：

- `Risk`（Safe / Caution / Danger）：决定颜色，Danger 切换前要二次确认；
- `ReadOnly`：Agent 不能改文件；
- `Unavailable`：为什么现在选不了（例如 Codex 没开启 auto-review）。

Agent 自己切换了模式（例如 Claude 的计划被批准后离开 plan），适配器报告新的模式，会话跟着改。

不选的做法：保留统一档位、再加几档、各家不支持的灰显。两家的模式本来就对不上（Claude 的 `dontAsk`、Codex 的 auto-review），统一的名字两边都对不上，正是原来的问题。

## Consequences

- 加一种模式、换一个名字，只改适配器。
- 设置里“新会话的默认模式”按 Agent 分别设置。
- 旧数据迁移：`ask`、`edits`、`auto` 按 Agent 换成各家的模式 ID。Codex 的 `ask` 和 `edits` 原来就是同一种设置，都换成 Ask for approval。
- 新会话没设默认模式时，用 Agent 标为默认的模式：Claude Code 是 Manual，就是它自己的默认；Codex 是 Ask for approval，也就是 aibo 一直用的设置。不用 Codex 自己的默认：它随项目是否受信任而不同（未受信任的目录是 Read only），升级后同样的操作会突然改不了文件（用户决定，2026-11-22）。
- 跨工作区的只读限制、“本会话内始终允许”的规则和模式无关，照旧。

## 补充（2026-11-26）：ACP Agent

通过 ACP 接入的 Agent，会话模式（`configOptions` 里 category 为 `mode` 的配置项，或旧接口的 `modes`）同样作为权限模式显示，名字和说明用 Agent 的原文。例如 OpenCode 的 `build`、`plan`：它们是 OpenCode 的内置 Agent 角色，实际权限由 `opencode.json` 决定，但 Claude Code 的 `plan` 本来就在权限模式里，选择方式也一样，不另设“Agent 角色”的概念。

ACP 不报告风险和只读，aibo 也不按模式名字推断（不同 Agent 的同名模式含义可能不同）。风险、只读和默认模式来自 Agent 配置（`agents.json` 的 `modes`）；没有标注的模式按 Caution、非只读处理。预置 OpenCode 自带 `plan`（Safe、只读）和 `build`（Caution、默认）的标注。

不选的做法：只显示配置里标注过的模式。这样更保守，但每接一个 Agent 都要先写配置才能切换模式（用户决定，2026-11-26）。代价是标注之前，危险的模式按 Caution 显示，切换前不会再确认；`docs/acp-agents.md` 提醒用户为这类模式加标注。
