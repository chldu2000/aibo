# 01: ACP 会话里切换模型、推理强度和模式

Status: ready-for-agent

**What to build:** ACP 适配器（`internal/agent/acp`）能在两轮之间切换模型、推理强度和模式，并报告 Agent 实际在用的值。不认 OpenCode 的具体 ID，按 ACP 的 category 识别，任何遵守 ACP v1 的 Agent 都能用。

现状：
- `SetModel` 只换模型，带推理强度就报错；`settings()` 只读 category `model`。
- `SetMode` 固定返回 "ACP agent does not expose permission modes"。
- `current_mode_update` 被忽略（`updates.go:52`）；`config_option_update` 只读模型。

实测见 [OpenCode 的 configOptions](../research/opencode-config-options.md)：OpenCode 只给 `configOptions`；推理强度是 category `thought_level`，只有部分模型有，换模型后才出现。

- [ ] 先补实测（研究文档“没有验证”的前三条）：切换模式、设置推理强度、换模型后推理强度的去留、续接后三项是否保留。抓取数据整理进 `internal/agent/acp/testdata/`，结论回填研究文档
- [ ] 解析 `configOptions` 的三个 category：`model`、`thought_level`、`mode`（按 category 找，没有 category 时退回同名 ID）。记下每项的 configId、当前值和可选值，`config_option_update` 整体替换
- [ ] 兼容旧接口：没有 category 为 `mode` 的配置项时，读 `session/new` 结果里的 `modes`（`availableModes`、`currentModeId`），用 `session/set_mode` 切换，`current_mode_update` 转成 `ModeReported`。`models` / `session/set_model` 在规范里是 unstable，不做
- [ ] `SetModel(model, effort)`：先设模型；再从回包的配置项里找 `thought_level`，设推理强度。aibo 的空推理强度对应可选值里的 `default`（没有就不设）；模型没有 `thought_level` 而推理强度非空时返回错误。运行中仍返回 `agent.ErrBusy`
- [ ] `SetMode(mode)`：有 `mode` 配置项就用 `set_config_option`，否则用 `set_mode`。成功后报告 `ModeReported`
- [ ] 启动时：`StartOptions.Model`、`Effort`、`Mode` 在 `session/new` / `session/resume` 之后依次设置；报告 `SettingsReported{Model, Effort}` 和 `ModeReported`
- [ ] 单元测试用抓取数据：解析三种配置项、推理强度随模型出现和消失、旧接口的模式、通知更新当前值
- [ ] 契约测试（`AIBO_CONTRACT=1`，`internal/contract/opencode_test.go`）：换到有推理强度的模型并设一档，切到 `plan` 再切回，续接后检查

## 不做

- 列出可选的模型、推理强度和模式（02）。
- 模式的风险等级（03）。这一步先让 `SetMode` 和 `ModeReported` 能用。
