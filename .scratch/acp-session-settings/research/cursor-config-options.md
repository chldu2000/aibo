# 实测：Cursor CLI 通过 ACP 报告的模型、推理强度和模式

实测于 2026-11-26，Windows，Cursor CLI `2026.11.22-e9042b2`（官方脚本装在 `%LOCALAPPDATA%\cursor-agent`，命令 `agent acp`；探针直接起 `versions\<版本>\node.exe index.js acp`，杀进程才能杀干净）。空目录作工作区。探针源码 `cursor/probe.go.txt`（改名为 `.go` 后单独构建，`CURSOR_NODE`/`CURSOR_INDEX` 指向 node 和 index.js）。抓取数据在 `cursor/`，每行一帧，`dir` 是方向，工作区路径改写成 `C:/tmp/cursor-ws`：

| 文件 | 内容 |
|---|---|
| `plain.jsonl` | `clientCapabilities: {}`：`authenticate`、`session/new` |
| `param-switch.jsonl` | 带 `_meta.parameterizedModelPicker`：依次换到 grok-4.7、claude-opus-5-5、gpt-5.6-sol、composer-2.5、default |
| `param-set.jsonl` | 同上：改推理强度、非法值、改模式、`set_mode`、`set_model`、`session/list`、重启后 `session/load` |
| `agent-models.txt` | `agent models` 的输出（终端用的平铺列表） |

## 握手

- `agentCapabilities`：`loadSession: true`，`sessionCapabilities` 只有 `list`。**没有 `delete`、`resume`、`close`**，所以 aibo 不会为 Cursor 开探测会话，列表只能从真实会话学到。
- `authMethods` 只有 `cursor_login`（"Run 'agent login' first"）。没登录时 `session/new` 返回 `-32000 Authentication required`；登录后不调 `authenticate` 直接 `session/new` 也成功（两次复现）。
- 网络不稳时 `authenticate`、`session/new`（`-32603 Failed to initialize session services`）、`agent models` 都会失败，重试即好。`session/new` 要 8–25 秒。

## 两种模型列表

`initialize` 的 `clientCapabilities._meta.parameterizedModelPicker` 决定格式。两种格式都同时给 `configOptions`、`models`（`availableModels`/`currentModelId`）和 `modes`（`availableModes`/`currentModeId`）。

**不带标志**：`configOptions` 只有 `mode` 和 `model`。`model` 49 个值，每个模型一个预设好参数的复合值，没有单独的推理强度：

```
default[]=Auto
grok-4.7[context=256k,reasoning_effort=high,fast=true]=grok-4.7
claude-opus-5-5[context=300k,effort=medium,fast=false]=claude-opus-5-5
gemini-4-neon[context=300k,reasoning_effort=high]=gemini-4-neon
```

**带标志**：`model` 49 个裸 ID，名字是人读的（`default=Auto`、`grok-4.7=Grok 4.7`、`claude-opus-5-5=Claude Opus 5.5`）。参数是**当前模型**的另外几项 `configOptions`，换模型时整组换掉（`set_config_option` 回包里是新的完整列表）：

| 模型 | 推理强度（category `thought_level`） | 其他（category `model_config`） |
|---|---|---|
| default（Auto） | 无 | 无 |
| grok-4.7 | `id=reasoning_effort`：low, medium, high, xhigh | `context` 256k/500k，`fast` |
| claude-opus-5-5 | `id=effort`：low, medium, high, xhigh, max | `context` 300k/1m，`fast` |
| gpt-5.6-sol | `id=reasoning`：none, low, medium, high, xhigh, max | `context` 272k/1m，`fast` |
| composer-2.5 | 无 | `fast` |

- 所有项都是 `type: select`。`fast` 的值是字符串 `"true"`/`"false"`，传布尔值返回 `-32602 expected string, received boolean`。部分选项名带零宽字符（`"Fast\u200b\u200b"`）。
- `model_config` 不是 ACP 规定的类别，aibo 现在忽略这些项。
- 推理强度没有 `default` 值。
- Auto 没有推理强度，也没有 cost/balanced/intelligence 之类的档位。
- `agent models` 打印 284 行平铺的变体（`claude-opus-5-5-high-fast` 之类），这些 ID 在 ACP 里无效：`set_config_option {model: "claude-opus-5-5-high"}` 返回 `-32602 Invalid model value`。

## 切换

- `set_config_option {configId: "effort", value: "high"}` 生效。用别的模型的 ID（opus 上设 `reasoning_effort`）返回 `-32602 Unknown model config option: reasoning_effort`；非法值返回 `-32602 Invalid value for effort: bogus`。
- **换模型不重置推理强度**：opus 设成 high，换到 grok 再换回来，还是 high。每个模型记着自己上次的参数。
- `set_config_option {configId: "mode", value: "plan"}` 生效，先推一条 `current_mode_update`。旧接口 `session/set_mode`、`session/set_model` 也都成功（回包空），没有推 `config_option_update`。
- 第一次换模型后推送 `available_commands_update`。

## 写进全局配置

**通过 ACP 换模型会改 `~/.cursor/cli-config.json`**，即用户终端里 Cursor 的默认设置：

- `selectedModel {modelId, parameters}` 和 `model`：最后选的模型；
- `modelParameters`：每个用过的模型最后的参数（`[{id: "effort", value: "high"}, …]`）；
- `modelSelectionHistory`、`hasChangedDefaultModel: true`。

新会话从 `selectedModel` 开始：上一个进程最后换到 grok-4.7，下一个 `session/new` 的当前模型就是 grok-4.7（推理强度取 `modelParameters` 里的 high）。所以 Cursor 的“默认模型”不是固定的，是全局的上一次选择。实测后已用备份恢复该文件。

## 会话

- `session/list` 返回本工作区的会话（`cwd`、`sessionId`、`updatedAt`）。
- 没发过消息的会话重启后 `session/load` 返回 `-32602 Session not found`，`session/list` 里也没有了：`list` 空 → `new` → `list` 有一个 → 重启 → `list` 空。
- 只调 `session/new` 也会写 `cli-config.json`（`selectedModel`、`model`、`modelParameters`、`modelSelectionHistory`），值是会话的当前模型，即原来的选择。

## 模式与审批

- 模式三个：`agent`（"Full agent capabilities with tool access"）、`plan`（"Read-only mode for planning and designing before implementation"）、`ask`（"Q&A mode - no edits or command execution"）。新会话总是 `agent`，模式不写进全局配置。
- 审批不是模式：`--force`/`--yolo`、`--auto-review`、`--sandbox` 是启动参数，`cli-config.json` 里有 `approvalMode: "allowlist"` 和 `permissions.allow`。

## 没有验证

- 发过消息的会话能否 `session/load`，以及恢复后的设置（没发消息，不花用户额度）。
- 工具审批：`session/request_permission` 的选项（没发消息）。
- 带标志时 Cursor 会不会主动推 `config_option_update`（比如 Auto 自己换模型）。
