# 实测：OpenCode 通过 ACP 报告的模型、推理强度和模式

实测于 2026-11-26，Windows，OpenCode v2.4.2（`~/.opencode/bin/opencode.exe acp`），空目录作工作区，没有项目级 `opencode.json`。探针在 `probe/`（`go build`，参数：可执行文件、工作区、要依次切换的模型）。这一节只看了输出，没有存抓取数据；抓取数据见下面的补充实测。

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

## 补充实测：切换、续接与删除

实测于 2026-11-26，同一台机器和版本。探针源码是 `probe/settings.go.txt`（改名为 `.go` 后单独构建）。抓取数据在 `internal/agent/acp/testdata/opencode-2.4.2-settings.jsonl`，每行一帧，`dir` 是方向，工作区路径已改写成 `C:/tmp/oc-ws`。

- `set_config_option {configId: "effort", value: "high"}` 生效，回包是完整的 `configOptions`。
- `set_config_option {configId: "mode", value: "plan"}` 生效，模型和推理强度不变。
- **换模型会把推理强度重置为 `default`**：换到没有推理强度的模型再换回来，推理强度是 `default`，原来的 `high` 不保留。
- 不存在的值返回 `-32602 Invalid params: effort not found: bogus`。
- 关掉进程，新进程里 `session/resume`：回包的 `configOptions` 保留模型、推理强度（`max`）和模式（`plan`）。
- `session/delete` 返回 `{}`，之后 `session/list`（同一 `cwd`）为空。

## 没有验证

- OpenCode 自己改模式时是否推送 `config_option_update`（`plan` 没有自动切回 `build` 的机制，没有触发条件）。
- 项目级 `opencode.json` 里登记的 primary agent、提供方是否出现在列表里，列表是否随工作区变化。
- 只提供旧接口（`modes` + `session/set_mode`）的 ACP Agent：手头没有，适配器测试用测试程序模拟。
