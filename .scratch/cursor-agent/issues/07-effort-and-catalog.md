# 07: 推理强度取对那一项，Auto 的档位，以及一次列全

Status: resolved

**What to build:** 多个 `thought_level` 时不要把 `thinking`（`true`/`false`）当成推理强度；`auto-smart` 的 `optimize_for` 放进推理强度菜单；探测时用 `cursor/list_available_models` 拿到每个模型的取值，不逐个切换。

## 实现说明

- `effortOption`（`internal/agent/acp/settings.go`）：`thought_level` 里取值不只是 `true`/`false` 的那一项是推理强度；没有时用 id 为 `optimize_for` 的项。`context`、`fast` 仍不进入菜单。`report` 和 `setModel` 都走它。
- 探测在 `session/new` 之后调 `cursor/list_available_models`。有结果就按模型填上推理强度，不再逐个 `set_config_option`。没有这个方法（OpenCode，或调用失败）时仍按原来的方式逐个切换。
- 测试：`TestEffortBesideThinking`、`TestProbeUsesModelCatalog`。`TestContractCursorSettings` 接受 Auto 为 `default` 或 `auto-smart`；后者要能设成 `cost`，`claude-opus-5` 的推理强度里要有 `high`、不能是 `true`。
- 2026-11-26 在本机 Cursor CLI 2026.11.22 上 `TestContractCursorSettings` 通过（约 78 秒）。
