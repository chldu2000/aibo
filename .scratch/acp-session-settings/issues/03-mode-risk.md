# 03: 在 Agent 配置里标注 ACP 模式的风险

Status: resolved

**What to build:** ACP 的模式只有 ID、名称和说明，没有风险等级和只读标记。aibo 不按名字猜（不同 Agent 的同名模式含义可能不同）。不认识的模式一律当作 Caution、非只读；用户可以在 `agents.json` 的 Agent 配置里为模式标注风险、只读和默认。预置 OpenCode 自带标注。

决定（用户，2026-11-26）：选这个方案，而不是只显示配置里标注过的模式。风险标低了会漏掉 Danger 的二次确认，例如某个 ACP 适配器暴露的 `bypassPermissions`，所以要留出配置的口子。

**Blocked by:** 02

- [x] `agents.ACPConfig` 加 `modes`，按模式 ID 给 `risk`（`safe` / `caution` / `danger`）、`readOnly`、`default`。例如：

  ```json
  {"id": "my-agent", "command": "...", "modes": {"bypassPermissions": {"risk": "danger"}}}
  ```

  校验：`risk` 只能取三个值，最多一个 `default`；配置里有、Agent 没报告的模式忽略。保存和读取的往返测试放在 `internal/agents/config_test.go`
- [x] 预置 OpenCode（`defaultOpenCode`）：`plan` 为 Safe、只读；`build` 为 Caution、默认。用户编辑 OpenCode 时保留这份标注
- [x] 适配器生成 `agent.PermissionMode` 时套用标注；没有标注的为 Caution、非只读。`Default` 优先用配置，其次用 `session/new` 报告的当前值
- [x] 模式的说明用 Agent 给的原文（ADR 0005，Agent 的原话不翻译）。`build` 这类模式的实际权限由 Agent 自己的配置决定（OpenCode 是 `opencode.json` 的 `permission`），界面上不另加措辞
- [x] ADR 0003 补一条：ACP Agent 的会话模式也作为权限模式显示；风险和只读来自 Agent 配置，没有标注时为 Caution
- [x] `docs/acp-agents.md`：说明 `modes` 字段和默认风险；OpenCode 一节说明 `build`、`plan` 出现在权限模式菜单里
- [x] `GLOSSARY.md` 的“权限模式”条目核对是否需要补充
- [x] 测试：工作台用假 Agent 确认 Danger 模式切换前要确认；适配器确认标注生效、未标注为 Caution

## 不做

在设置页的添加或编辑表单里编辑模式标注。先只支持 `agents.json`，有需要再加界面。

## 实现说明

- `internal/agents/modes.go`（新）：`ModeConfig{Risk, ReadOnly, Default}`，`ACPConfig.Modes map[string]ModeConfig`（`json:"modes,omitempty"`）。
  - 校验：`risk` 只能是空、`safe`、`caution`、`danger`（空即 `caution`）；最多一个 `default`；模式 ID 不能为空。三个新哨兵 `ErrInvalidRisk`、`ErrManyDefaults`、`ErrEmptyModeName`，外壳都译成“agents.json 里的 modes 无效……”（`agentModesInvalid`，中英文）。
  - `equal()` 也比较 `Modes`，磁盘上的标注被外部改过时，编辑返回 `ErrConfigChanged`。`ACPConfig()` 返回副本。
  - 预置 OpenCode 的标注放在 `openCodeModes`，**在配置里没有 `modes` 时生效**，没有写进 `defaultOpenCode()`。原因：已经存进 `agents.json` 的 OpenCode 条目（02 之前编辑过的）没有这个字段，写进默认配置的话，这些条目就拿不到标注。写了 `modes` 就只用写出的标注，不和内置的合并。
- 适配器：`acp.ModeTag`、`Agent.SetModeTags`，`applyACP` 创建适配器时设置。`PermissionModes` 按标注给 `Risk`、`ReadOnly`；`Default` 优先用标注里的默认（Agent 报告了这个模式时），其次用新会话的当前模式。
  - **会话也用配置的默认模式**：会话启动时把配置的默认模式记为 `preferMode`，`configure` 时如果 Agent 提供这个模式，就把它当作会话的默认。这样 `StartOptions.Mode` 为空、`SetMode("")` 时会切到配置的默认模式，界面标为默认的模式和会话实际所在的模式一致。
- 外壳：设置页编辑 Agent 时 `saveAgent` 带上原来的 `Modes`（表单不编辑它）。
- 文档：
  - `docs/acp-agents.md`：字段表加 `modes`，提醒为不经询问就执行操作的模式标 `danger`；兼容范围表的模式说明改为按标注，并写明 OpenCode 的内置标注。
  - ADR 0003 加了“补充（2026-11-26）：ACP Agent”。
  - `GLOSSARY.md` 的“权限模式”补了一句 ACP Agent。
  - 02 写的文档里风险等级用了“谨慎”，术语表是“注意”，统一成“注意”。
- 测试：
  - `internal/agents/modes_test.go`：`TestModeLabelsRoundTrip`（保存、重启后读回、副本、磁盘上改过标注时拒绝编辑）、`TestInvalidModeLabels`（三种错误，经 `AddACP` 和读文件两条路径）、`TestOpenCodeModeLabels`（内置标注、自己的标注替换内置、danger 的转换）。内部的 `modeTags()` 经 `export_test.go` 暴露给测试。
  - 适配器 `TestModeTags`：标注生效、未标注为 Caution、配置的默认模式用于新会话和 `SetMode("")`。
  - 外壳 `TestEditKeepsModeLabels`：设置页改名后 `agents.json` 里的 `modes` 还在。
  - Danger 模式切换前再确认：外壳只看 `Risk`，已有 `approvals_test.go` 覆盖，没有为 ACP 重复写。
  - 契约测试 `TestContractOpenCodeLists` 加了内置标注的检查；2026-11-26 在 Windows OpenCode 2.4.2 上和 `TestContractOpenCodeSettings` 一起通过。
- 顺带修了 02 引入的测试问题：`TestAddAgentFromSettings` 把测试二进制登记成 ACP Agent 的命令；02 之后渲染会话会触发列表探测，用 `serve` 等参数启动测试二进制，Go 的测试二进制遇到非 flag 参数照样跑全部测试，进程残留，Windows 上 `go test` 结束时删不掉测试二进制（`unlinkat … Access is denied`）。`internal/shell/main_test.go` 的 `TestMain` 遇到不是 `-test.` 开头的参数就直接退出。在 02 之前的提交上同一个测试没有这个问题（用 worktree 复核过）。

## 没有验证

- `go test -race`：这台机器没有 gcc。
- 没有在真实界面里看过 OpenCode 的模式菜单（颜色、只读标记）。
- 用户自己写了 `modes`、但 Agent 不提供其中的默认模式时，退回 Agent 自己的默认：代码按这个写了，没有单独的测试。
