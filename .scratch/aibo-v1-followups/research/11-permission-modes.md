# 11 实测：两家 Agent 的权限模式

实测于 2026-11-22：Claude Code 2.1.318，codex-cli 0.169.0。探针和抓取数据在 `11-probes/`。除了 Claude plan 模式那一轮（haiku，0.05 美元），都只发控制请求或 `thread/start`，不跑轮次。

## Claude Code

探针：`claude_modes.py`，抓取：`claude_modes.jsonl`。

- `initialize` 回包有 `current_permission_mode`（不带 `--permission-mode` 时是 `"default"`）。每个模型都有 `supportsAutoMode`，本机所有模型都是 `true`。
- `set_permission_mode` 六种模式都能在会话中途切进切出：`default`、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`。
  - **`manual` 只是别名**：回包是 `{"mode": "default"}`。模式 ID 应该用 `default`。
  - `bypassPermissions` 要求启动时带 `--allow-dangerously-skip-permissions`（aibo 一直带着），不带时报错 “Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions”。
  - `get_settings` 的 `effective.permissions.defaultMode` 不随 `set_permission_mode` 变，读不出当前模式。
- 每一轮的 `system/init` 带 `permissionMode`，是当前的模式（06 的抓取数据去掉了这个字段）。所以 Agent 自己换了模式（例如计划被批准后离开 plan），下一轮就能知道。
- plan 模式下，`ExitPlanMode` 以 `can_use_tool` 审批的形式发过来：`input.plan` 是计划全文（Markdown），`input.planFilePath` 是计划文件的路径，没有 `permission_suggestions`。拒绝并带 `interrupt` 时，轮次以 `terminal_reason: aborted_streaming` 结束。

## Codex

探针：`codex_modes.py`，抓取：`codex_modes.jsonl`。协议的类型定义用 `codex app-server generate-ts` 生成。

- `thread/start`、`turn/start` 都可以指定 `approvalPolicy`、`approvalsReviewer`、`sandbox`（`turn/start` 里是 `sandboxPolicy`）。没有按“权限配置”（permission profile）指定的参数。`thread/start` 的回包和 `thread/settings/updated` 都带这三项。
- `approvalsReviewer` 有 `user`、`auto_review`、`guardian_subagent` 三个值。
- 四个预设实际对应的组合，从程序文件的字符串确认（Approve for me 旁边是 `on-request`、`workspace-write` 和 auto-review）：

  | 预设 | `sandbox` | `approvalPolicy` | `approvalsReviewer` |
  |---|---|---|---|
  | Read only | `read-only` | `on-request` | `user` |
  | Ask for approval | `workspace-write` | `on-request` | `user` |
  | Approve for me | `workspace-write` | `on-request` | `auto_review` |
  | Full access | `danger-full-access` | `never` | `user` |

  四种组合在 `thread/start` 里都被接受，回包原样报回。
- Approve for me 的开关是 feature `guardian_approval`：`experimentalFeature/list` 读得出，本机是 `stage: stable`、`enabled: true`、`defaultEnabled: true`。没开启时，`thread/start` 仍然接受 `auto_review`（报回的也是它），但不跑轮次看不出是否生效，所以 aibo 按这个开关灰显。
- `permissionProfile/list` 列出内置的 `:read-only`、`:workspace`、`:danger-full-access`。
- **不带这三项时，Codex 的默认取决于项目是否受信任**：在 `/tmp` 下的未受信任目录，`thread/start` 回包是 `read-only` + `on-request`，`activePermissionProfile` 是 `:read-only`。aibo 原来总是指定 `workspace-write`，所以以前看不出来。

## 对实现的意义

- Claude 的模式 ID 用 `default` 而不是 `manual`。
- 两家都能在两轮之间换模式：Claude 用 `set_permission_mode`，Codex 随下一次 `turn/start` 带上三项。
- 适配器报告当前模式：Claude 用 `initialize` 的 `current_permission_mode` 和每轮 `system/init` 的 `permissionMode`；Codex 用 `thread/start`、`thread/resume` 的回包和 `thread/settings/updated`，按上表把三项对回预设，对不上的不报。
- 列表里的“默认”是一个标记，不是排在第一位：Codex 的 `/permissions` 顺序是 Read only 在前。
- Codex 不指定模式时，aibo 仍然指定 Ask for approval，不交给 Codex 按项目信任决定（用户决定，2026-11-22）。
