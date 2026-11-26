# 02: 预置 Cursor CLI：参数化模型选择和模式标注

Status: ready-for-agent

**Blocked by:** 01

**What to build:** 像 OpenCode 一样预置 Cursor CLI（`cursor-agent acp`），握手时带上 Cursor 的 `parameterizedModelPicker`，让模型菜单是裸 ID 加可读名称、推理强度单独可选；预置 `agent`/`plan`/`ask` 的风险标注。

实测依据：`.scratch/acp-session-settings/research/cursor-config-options.md`，抓取在同目录 `cursor/`。

- [ ] `agents.Specs` 加 `Cursor`（Kind `cursor`，命令 `cursor-agent`，参数 `acp`，`MinVersion: "2026.11.22"`，安装页 `https://cursor.com/docs/cli/installation`）。用 `cursor-agent` 不用 `agent`：两个名字安装脚本都会装，`agent` 太泛
- [ ] 预置方式照 OpenCode：`defaultCursor()`、可删除和恢复（`RestoreOpenCode` 那套推广到预置的 ACP Agent，或为 Cursor 加一份），设置页的说明文字中英文都要有
- [ ] 适配器能接受额外的 `clientCapabilities._meta`（`acp.go` 的 `initialize` 现在发空对象）；只为 Cursor 设 `{"parameterizedModelPicker": true}`。这是 Cursor 私有的扩展，别的 Agent 不发
- [ ] 模式标注（同 `openCodeModes`，配置里没有 `modes` 时生效）：`agent` Caution、默认；`plan`、`ask` Safe、只读
- [ ] 核对现有逻辑对 Cursor 的结果（实测已知，需要测试固定下来）：
  - 推理强度按 category `thought_level` 找，ID 随模型变（`effort` / `reasoning_effort` / `reasoning`），不能按 ID 记；
  - 没有 `default` 推理强度：`DefaultEffort` 为空，`SetModel(m, "")` 不动推理强度；
  - category `model_config` 的 `context`、`fast` 忽略；
  - 只在值和当前不同时才 `set_config_option`（见下面“全局设置”）。
- [ ] 用抓取数据做回放测试（照 OpenCode 的 `settings_test.go`）：把 `param-switch.jsonl`、`param-set.jsonl` 整理进 `internal/agent/acp/testdata/cursor-2026.11.22-settings.jsonl`，确认模型列表、各模型的推理强度、模式列表
- [ ] `docs/acp-agents.md` 加 Cursor 一节：
  - **全局设置**：通过 ACP 换模型会写 `~/.cursor/cli-config.json`（`selectedModel`、每个模型的 `modelParameters`），在 aibo 里换模型会改变终端里 Cursor 下次启动的模型，反过来也一样；没选模型时，新会话用 Cursor 上一次的选择。
  - **推理强度**：每个模型记着自己上次的值，换模型不重置；没有“默认”。
  - `context`、`fast` 不在 aibo 里显示，用 Cursor 记住的值。
  - 审批不是模式（`--force`、`--auto-review`、`--sandbox` 是启动参数），aibo 不加这些参数。
- [ ] 兼容范围表加 Cursor 一行

## 不做

- `context`、`fast` 的菜单。以后需要时做成通用的“其他模型选项”，不为 Cursor 单独写。
- 工具名前缀：没发过消息，不知道 Cursor 的工具名。留空，04 实测后再定。
