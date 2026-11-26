# 实测：OpenCode 通过 ACP 报告的模型、推理强度和模式

实测于 2026-11-26，Windows，OpenCode v2.4.2（`~/.opencode/bin/opencode.exe acp`），空目录作工作区，没有项目级 `opencode.json`。探针在 `probe/`（`go build`，参数：可执行文件、工作区、要依次切换的模型）。这次只看了输出，没有存抓取数据；写契约测试前要重新抓一份 `testdata/*.jsonl`。

## 观测

- `initialize` 的 `agentCapabilities.sessionCapabilities` 有 `additionalDirectories`、`close`、`delete`、`fork`、`list`、`resume`；`loadSession: true`。
- `session/new` 的结果只有 `sessionId` 和 `configOptions`，没有 `modes`、`models`。`configOptions` 两项：
  - `id=model`，category `model`，当前 `opencode/big-pickle`，11 个免费模型（这台机器没有登记别的提供方；[早先的抓取](../../agent-extensibility/research/01-probes/handshake.jsonl)里还有用户配置的提供方）；
  - `id=mode`，category `mode`，当前 `build`，可选 `build`（"The default agent. Executes tools based on configured permissions."）、`plan`（"Plan mode. Disallows all edit tools."）。
- **推理强度随模型出现和消失。** `session/set_config_option {configId: "model"}` 的回包带完整的 `configOptions`：
  - 换到 `opencode/deepseek-v4.1-flash-free` 后多出 `id=effort`，category `thought_level`，当前 `default`，可选 `low | high | max | default`；
  - 再换到 `opencode/mimo-v2.6-flash-free` 或 `opencode/big-pickle`，`effort` 一项消失。
- 第一次 `set_config_option` 之后，OpenCode 推送 `available_commands_update`。
- 探针建的会话留在 OpenCode 自己的历史里（没有调 `session/delete`）。

## 没有验证

- 用 `set_config_option {configId: "mode"}` 切换模式，以及 OpenCode 自己改模式时是否推送 `config_option_update`。
- 设置 `effort` 的回包；换模型后原来的 `effort` 是否保留。
- 续接（`session/resume`）后模型、推理强度和模式是否保留。
- 项目级 `opencode.json` 里登记的 primary agent、提供方是否出现在列表里，列表是否随工作区变化。
- `session/delete` 能否删掉探测会话。
- 只提供旧接口（`modes` + `session/set_mode`）的 ACP Agent：手头没有，用测试程序模拟。
