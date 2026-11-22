# 11: 审批档位对应各家 Agent 的原生模式

**What to build:** 审批档位里能选的，就是这个会话的 Agent 自己有的模式，用的也是 Agent 自己的名字和说明，跟用户在 Claude Code 里按 Shift+Tab、在 Codex 里打 `/permissions` 看到的一致。aibo 不再维护一套三档的统一档位。

## 现状

aibo 只有三档（`agent.ApprovalLevel`），由适配器换成各家的设置：

| aibo 档位 | Claude Code（`--permission-mode` / `set_permission_mode`） | Codex（`approvalPolicy` + `sandbox`） |
|---|---|---|
| 每次询问 `ask` | `manual` | `on-request` + `workspace-write` |
| 自动接受工作区内修改 `edits` | `acceptEdits` | `on-request` + `workspace-write`（**和“每次询问”完全一样**） |
| 全部自动 `auto` | `bypassPermissions` | `never` + `danger-full-access` |

问题：
- Codex 的“每次询问”其实不是每次都问：`workspace-write` 下，工作区内的修改和命令本来就不问。所以 Codex 的前两档没有区别，名字也和实际行为不符。
- 两家都有 aibo 没有对应的模式（见下表），用户在 aibo 里用不上。
- 档位的名字和说明是 aibo 自己写的，和 Agent 里看到的对不上。

## 各家的模式（2026-11-21 从本机二进制里读出，待实测）

**Claude Code 2.1.318**：`--permission-mode` 可选 `manual` `acceptEdits` `plan` `auto` `dontAsk` `bypassPermissions`。在终端里按 Shift+Tab 依次切换的是 Manual → Accept edits → Plan，`auto` 和 `bypassPermissions` 只有开启后才出现在循环里。`initialize` 回包里每个模型都有 `supportsAutoMode`。

| 模式 | 名称（Claude 自己的） | 含义 |
|---|---|---|
| `manual` | Manual | 照常询问 |
| `acceptEdits` | Accept edits | 文件修改不问 |
| `plan` | Plan | 只读，先出计划；计划要用户批准（`ExitPlanMode`）后才动手 |
| `auto` | Auto | 由分类器判断，大多数操作不问 |
| `dontAsk` | Don't Ask | 不问；没有事先允许过的一律拒绝 |
| `bypassPermissions` | Bypass Permissions | 全部不问 |

**Codex 0.169.0**：权限由三项组合而成：
- `sandbox`：`read-only` / `workspace-write` / `danger-full-access`；
- `approvalPolicy`：`untrusted` / `on-request` / `never`，还有 granular（细分到每类审批）；
- `approvalsReviewer`：`user` / `auto_review`（由模型自动审批）。

`/permissions` 菜单是这几项的预设。用户在 TUI 里看到的是下面四项（程序文件里另有一组旧的名字 Read Only / Default / Full Access，以 TUI 为准）：

| 预设（Codex 自己的名字） | 组合（从程序文件推断，待实测） |
|---|---|
| Read only | `read-only` + `on-request` |
| Ask for approval | `workspace-write` + `on-request`，审批人 `user`（aibo 现在的“每次询问”和“自动接受工作区内修改”都对应这一项） |
| Approve for me | `workspace-write` + `on-request`，审批人 `auto_review`（由模型代为审批，可以自定义审批策略；是实验性功能，需要开启 feature flag） |
| Full access | `danger-full-access` + `never`（Codex 选它时会劝用户改用 Ask for approval 或 Approve for me） |

另外，Codex 的计划模式不是权限设置，而是 `collaborationMode`（`thread/resume` 回包里有）。

## 数据形状（用户已确认采用 Agent 自己的模式列表，2026-11-21）

档位改成 Agent 自己提供的模式列表，工作台和外壳只认少数几个语义字段，不认识具体的模式：

```go
// PermissionMode is one of an Agent's own permission modes.
type PermissionMode struct {
	ID          string // the adapter's own: "acceptEdits", "codex:ask-for-approval"
	Name        string // as the Agent calls it: "Accept edits", "Ask for approval"
	Description string
	Risk        Risk   // Safe / Caution / Danger: color, and asking again before Danger
	ReadOnly    bool   // the Agent cannot change files (plan, Read Only)
}

// ModeLister is an Agent that tells its permission modes, in the order
// the Agent shows them, its default first.
type ModeLister interface {
	PermissionModes(ctx context.Context) ([]PermissionMode, error)
}
```

- 会话存的是模式 ID（字符串，Agent 自己的），不再是 `ApprovalLevel`。`StartOptions.Level` 和 `Session.SetLevel` 改成模式 ID。
- 迁移：现有的 `ask` / `edits` / `auto` 按上面的表换成各家的模式 ID（追加迁移）。
- 设置里的“新会话的默认档位”改成按 Agent 分别设置，默认用 Agent 自己的默认模式。
- 任务 09 的警示色、切换前的二次确认，改成看 `Risk == Danger`，不再判断 `FullAuto`。
- 不管选哪个模式，跨工作区的只读限制（Claude 的 `--disallowedTools`、Codex 的 sandbox）和“写入其他工作区”的提示都照样有效。
- “本会话内始终允许”的规则不变。

不选另一种做法（保留 aibo 自己的统一档位，再加几档，各家不支持的灰显）的理由：两家的模式不是一一对应的（Claude 的 `dontAsk`、Codex 的 `auto_review`），硬凑出来的统一名字两边都对不上，正是现在的问题。

**Blocked by:** None（可以先实测）。和 09 改同一个按钮，09 先做

**Status:** resolved

已定的设计（用户决定，2026-11-21）：
1. 采用各家 Agent 自己的模式列表，不保留统一档位。
2. Codex 的模式列表就是 TUI `/permissions` 里的四项：Read only、Ask for approval、Approve for me、Full access。Approve for me 在用户没有开启对应的 feature flag 时，灰显并说明原因（实测后确认能否读出是否开启）。
3. Claude 的 `plan` 放在模式列表里，顺序和 Shift+Tab 一致。Codex 的计划模式（`collaborationMode`）这次不做。

## 实测结论（2026-11-22）

详见 [11 实测](../research/11-permission-modes.md)。和上面的推断不一致、需要调整设计的地方：

- Claude 的 `manual` 只是 `default` 的别名，模式 ID 用 `default`。
- Codex 四个预设的组合和上表一致；Approve for me 的开关是 feature `guardian_approval`，`experimentalFeature/list` 读得出（本机默认开启）。
- 两家都会报告当前模式（Claude 的 `system/init`，Codex 的 `thread/settings/updated`），所以 Agent 自己换了模式时（例如 Claude 计划被批准后离开 plan），aibo 跟着改。数据形状因此多一个事件 `ModeReported`。
- “默认”用 `PermissionMode.Default` 标记，不靠排在第一位：Codex 的顺序是 Read only 在前。
- 选不了的模式用 `PermissionMode.Unavailable` 写明原因。
- Codex 不指定模式时的默认取决于项目是否受信任（未受信任的目录是 Read only）。

需要实测的问题（结论附 `testdata/*.jsonl`，加契约测试，回填规格）：
- Claude 的 `auto`、`dontAsk`、`plan` 在 `-p` stream-json 下是否可用：`set_permission_mode` 能不能中途切进切出？`plan` 下 `ExitPlanMode` 是不是以 `can_use_tool` 审批的形式发过来？
- Codex 四个预设实际对应的 `sandbox` / `approvalPolicy` / `approvalsReviewer` 组合（上表是推断）；app-server 能不能在 `thread/start`、`turn/start` 里指定 `approvalsReviewer: auto_review`，能不能中途切换；Approve for me 的 feature flag 没开时会怎样，能不能从 app-server 读出是否开启。
- 两家各自的默认模式怎么读出来（Claude 的 `initialize` 有 `current_permission_mode`；Codex 的 `thread/start` 回包有 `approvalPolicy`、`sandbox`）。

- [x] 上面的问题有结论；数据形状的取舍写一篇 ADR，替换 `GLOSSARY.md` 里相关的术语
- [x] `agent` 包加 `PermissionMode` 和 `ModeLister`，`ApprovalLevel` 删除；Claude、Codex、假 Agent 实现
- [x] 会话表的审批档位一列改存模式 ID（追加迁移，跑 `OpenVersion` 升级前备份测试）
- [x] 设置改成按 Agent 分别设置默认模式
- [x] 输入框底部的档位按钮、会话详情、设置页都用模式列表；`Risk == Danger` 时警示色和二次确认
- [x] 工作台层面的测试（假 Agent）：切换模式、运行中切换、重启续接后保持、迁移后的旧会话
- [ ] 界面文字进 `locales/`（中英文）；Agent 自己的模式名不翻译：没做，仓库里还没有语言目录，留给 03

## 实现说明

- 实测、取舍和数据形状：[11 实测](../research/11-permission-modes.md)、`docs/adr/0003-agents-own-permission-modes.md`；`GLOSSARY.md` 的“审批档位”换成“权限模式”；规格的第 49、64 条用户故事、适配器参数、审批一节、会话详情、设置、输入框、待验证项 8 已回填。
- `agent`：`ApprovalLevel` 删除。新增：
  - `PermissionMode`：在任务的数据形状上多了 `Default` 和 `Unavailable`（见上面的实测结论）。
  - `Risk`（Safe / Caution / Danger）、`ModeLister`、`StartOptions.Mode`、`Session.SetMode`。
  - 事件 `ModeReported`：Agent 报告当前模式。
  - `ApprovalRequested.Plan`：Claude 的 `ExitPlanMode`。
- Claude 适配器：
  - `Modes` 六种，顺序同 Shift+Tab：Manual（`default`，默认）、Accept edits、Plan（只读）、Auto、Don't Ask、Bypass Permissions（危险）。
  - 有模式时才带 `--permission-mode`，`--allow-dangerously-skip-permissions` 总是带着；“本会话内始终允许”里的 `setMode acceptEdits` 规则仍会把 `default` 提到 `acceptEdits`。
  - `SetMode` 发 `set_permission_mode`。
  - `initialize` 的 `current_permission_mode` 和每轮 `system/init` 的 `permissionMode` 转成 `ModeReported`。
  - `ExitPlanMode` 的审批标题是“按计划开始执行”，计划放进 `Plan`。
- Codex 适配器：
  - 四个预设（`presets`）：Read only（只读）、Ask for approval（默认）、Approve for me、Full access（危险）。
  - `thread/start` 带上预设的三项；没有模式时用 Ask for approval，不交给 Codex 按项目信任决定（用户决定，2026-11-22）。
  - `SetMode` 随下一次 `turn/start` 带上三项。
  - `thread/start`、`thread/resume` 回包和 `thread/settings/updated` 按三项对回预设，转成 `ModeReported`。
  - `PermissionModes` 读 `experimentalFeature/list`：`guardian_approval` 关闭时 Approve for me 灰显并写明原因。
  - 模式、模型、线程设置相关的代码从 `codex.go`（超过 800 行）拆到 `settings.go`。
- 假 Agent：`ask`（默认）、`edits`、`auto`（危险），各一个风险等级；`Modes()` 收到 `SetMode`，启动和换模式后都报告。
- 存储：`approval_level` 列保留原名，改存模式 ID。追加迁移把 `ask`、`edits`、`auto` 按 Agent 换成各家的 ID（Codex 的 `ask`、`edits` 都换成 `ask-for-approval`）。
- 工作台：
  - `SetMode`：有 `ModeLister` 的 Agent 校验 ID，不在列表里返回 `ErrNoSuchMode`；运行中也能换，和原来一样。
  - `PermissionModes` 转交 Agent；`Status.Mode` 是 Agent 报告的模式。
  - Agent 自己换了模式（会话选过模式、报告的又不一样），会话跟着改并存下来，例如 Claude 计划被批准后离开 Plan。
  - 设置：`DefaultModes` 按 Agent 分别设置，没设时用 Agent 标为默认的模式；旧设置里的 `DefaultLevel` 在打开时按同一张表换掉。
- 界面：
  - `level.go` 改为 `mode.go`。输入框底部按钮的 Label 是“权限模式：<Agent 自己的模式名>”。
  - 弹出面板列出 Agent 的模式和说明，标出默认；选不了的灰显并写明原因；危险的二次确认（“确定切换到 …”）。“本会话内始终允许”和可读的源工作区照旧。
  - 危险模式的橙色染色和侧栏标记（09）改为看 `Risk == Danger`。
  - 会话详情和设置用下拉框，只列选得了的模式；设置按 Agent 各一个。
  - 审批卡片用 Markdown 显示计划，工具调用那一行的摘要也认得 `plan`。
- 测试：
  - 工作台 `TestPermissionMode`：新会话没有模式、Agent 报告默认、开始前设置、运行中切换、Agent 自己换模式、重启后保持。`TestSettings` 改为按 Agent 设置默认模式，`TestSettingsLevelBecomesModes` 检查旧设置的升级。
  - 存储 `TestLevelsBecomeModes`：迁移，含升级前备份。
  - 适配器：`TestModes`、`TestPlanMode`（Claude，`testdata/modes.jsonl`），`TestPresets`（Codex，`testdata/modes.jsonl`）。
  - 界面：`TestApprovalLevelsRulesAndNotifications` 改为切换假 Agent 的模式、危险模式要确认、侧栏警示；`TestPlanApprovalCard`；设置页的下拉框。
  - 契约测试（`AIBO_CONTRACT=1`），2026-11-22 在 Claude Code 2.1.318、codex-cli 0.169.0 上通过：
    - `TestContractModesAndRules`：Claude 在 `acceptEdits` 下写文件不问、换回 `default` 后问；Codex 在 Full access 下写工作区以外不问、Ask for approval 下问，换模式后 Codex 报告的预设对得上；两家“本会话内始终允许”的规则重启后仍有效。
    - `TestContractClaudePlanMode`：Plan 模式下计划以审批出现，批准后 Claude 回到 `default`，会话跟着改。

截图（无头渲染）：[模式面板](../research/11-screenshots/11-menu.png)、[危险模式的二次确认](../research/11-screenshots/11-confirm.png)、[危险模式警示（浅色）](../research/11-screenshots/11-danger-light.png)、[（深色）](../research/11-screenshots/11-danger-dark.png)。

## 没有验证

- 没在真机上用真实的 Claude、Codex 点过模式面板；真实的模式列表只在单元测试和契约测试里用到。
- Approve for me（auto-review）没跑过轮次：不知道 feature 关闭时选它会怎样，所以按开关灰显。
- Claude 的 Auto 和 Don't Ask 只确认了能切换，没跑过轮次看审批行为。
- Codex 的计划模式（`collaborationMode`）按任务没做。
- 设置里不提供“交给 Agent 自己决定”（不指定模式）：Codex 自己的默认随项目信任变化，用户决定不用。
