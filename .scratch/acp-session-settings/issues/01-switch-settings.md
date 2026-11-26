# 01: ACP 会话里切换模型、推理强度和模式

Status: resolved

**What to build:** ACP 适配器（`internal/agent/acp`）能在两轮之间切换模型、推理强度和模式，并报告 Agent 实际在用的值。不认 OpenCode 的具体 ID，按 ACP 的 category 识别，任何遵守 ACP v1 的 Agent 都能用。

现状：
- `SetModel` 只换模型，带推理强度就报错；`settings()` 只读 category `model`。
- `SetMode` 固定返回 "ACP agent does not expose permission modes"。
- `current_mode_update` 被忽略（`updates.go:52`）；`config_option_update` 只读模型。

实测见 [OpenCode 的 configOptions](../research/opencode-config-options.md)：OpenCode 只给 `configOptions`；推理强度是 category `thought_level`，只有部分模型有，换模型后才出现。

- [x] 先补实测（研究文档“没有验证”的前三条）：切换模式、设置推理强度、换模型后推理强度的去留、续接后三项是否保留。抓取数据整理进 `internal/agent/acp/testdata/`，结论回填研究文档
- [x] 解析 `configOptions` 的三个 category：`model`、`thought_level`、`mode`（按 category 找，没有 category 时退回同名 ID）。记下每项的 configId、当前值和可选值，`config_option_update` 整体替换
- [x] 兼容旧接口：没有 category 为 `mode` 的配置项时，读 `session/new` 结果里的 `modes`（`availableModes`、`currentModeId`），用 `session/set_mode` 切换，`current_mode_update` 转成 `ModeReported`。`models` / `session/set_model` 在规范里是 unstable，不做
- [x] `SetModel(model, effort)`：先设模型；再从回包的配置项里找 `thought_level`，设推理强度。aibo 的空推理强度对应可选值里的 `default`（没有就不设）；模型没有 `thought_level` 而推理强度非空时返回错误。运行中仍返回 `agent.ErrBusy`
- [x] `SetMode(mode)`：有 `mode` 配置项就用 `set_config_option`，否则用 `set_mode`。成功后报告 `ModeReported`
- [x] 启动时：`StartOptions.Model`、`Effort`、`Mode` 在 `session/new` / `session/resume` 之后依次设置；报告 `SettingsReported{Model, Effort}` 和 `ModeReported`
- [x] 单元测试用抓取数据：解析三种配置项、推理强度随模型出现和消失、旧接口的模式、通知更新当前值
- [x] 契约测试（`AIBO_CONTRACT=1`，`internal/contract/opencode_settings_test.go`）：换到有推理强度的模型并设一档，切到 `plan` 再切回，续接后检查

## 不做

- 列出可选的模型、推理强度和模式（02）。
- 模式的风险等级（03）。这一步先让 `SetMode` 和 `ModeReported` 能用。

## 实现说明

- 新文件 `internal/agent/acp/settings.go` 管会话设置；`acp.go` 里原来的 `SetModel`、`SetMode`、`settings()` 移走。
  - `configOption` 记下 `ID`、`Name`、`Category`、`Type`、当前值和可选值（`choices()` 展开分组）。`option(opts, category)` 先按 category 找，没有 category 的项才按同名 ID 找。
  - 会话保存最近一次的完整列表（`options`）。`set_config_option` 的回包和 `config_option_update` 都整体替换。旧接口的 `modes` 单独保存。
  - `defaultModel`、`defaultMode` 取会话开始时的值：`SetModel("", …)`、`SetMode("")` 回到它们。空推理强度设成 `default`，Agent 不提供 `default` 时不设。
  - `report()` 根据当前列表报告：有模型或推理强度时发 `SettingsReported`（`default` 报成空），有模式时发 `ModeReported`。
- 启动时先设好 `StartOptions` 的模型、推理强度和模式，**最后报告一次**。原因：先报告 `build` 再切到 `plan` 时，工作台会把前一条当成 Agent 自己改了模式，把会话的模式改成 `build`（`workbench/events.go` 的 `ModeReported`）。
- `SetModel`、`SetMode` 无论成败都报告一次，换模型成功、设推理强度失败时界面也能看到真实状态。`SetModel` 运行中仍返回 `ErrBusy`；`SetMode` 不拦运行中的调用，和接口说明“对之后的请求生效”一致，但 OpenCode 在轮次中途能否切换没有测。
- `current_mode_update` 只在会话有旧接口的 `modes` 时生效。同时给出两种接口的 Agent，以 `configOptions` 为准。
- 测试（`settings_test.go`）：
  - `TestOpenCodeSettingsCapture` 回放真实抓取，检查每一步报告的模型、推理强度和模式，包括推理强度随模型出现和消失、续接后保留。
  - `TestStartWithSettings`、`TestSwitchSettings`、`TestLegacyModes` 用测试二进制自己当假 Agent（`AIBO_ACP_FAKE`），检查发出的请求顺序和报告。
  - `TestReportedUpdates`、`TestGroupedChoices` 检查通知和分组的可选值。
- 契约测试 `TestContractOpenCodeSettings`：2026-11-26 在 Windows OpenCode 2.4.2 上通过；`TestContractOpenCode`、`TestContractEditedOpenCode` 也重跑通过。
- `docs/acp-agents.md` 只补了契约测试的说明。“暂不提供推理强度”“不显示为权限模式”两句对用户仍然成立（界面要等 02、03），到时再改。

## 没有验证

- `go test -race`：这台 Windows 机器没有 gcc，跑不了。`report()` 和 `setMode()` 读旧接口的当前模式时已在锁内复制。
- 只提供旧接口的真实 Agent：只用假 Agent 测过。
- OpenCode 在轮次进行中切换模式的效果。
