# 06 实测：会话中途更换模型和推理强度

实测于 2026-11-21：Claude Code 2.1.318，codex-cli 0.169.0。探针和抓取数据在 `06-probes/`。抓取数据去掉了 initialize 的回包（账号、插件列表）和流式增量，家目录改写成 `~`。

## 结论

两家都能在会话空闲时**热切换**模型和推理强度，不用重启进程，原生会话 ID 不变，不产生上下文重置。

| | Claude Code | Codex app-server |
|---|---|---|
| 每个模型支持的档位 | `initialize` 回包 `models[].supportsEffort`、`supportedEffortLevels`（例如 `low…max`；旧模型如 Haiku 4.5 没有这两项，即不支持） | `model/list` 的 `supportedReasoningEfforts[].reasoningEffort`、`defaultReasoningEffort` |
| 档位取值 | `low` `medium` `high` `xhigh` `max`（随模型变化） | `low` `medium` `high` `xhigh` `max` `ultra`（随模型变化） |
| 启动时指定 | `--model`、`--effort` | `thread/start` 的 `model`；推理强度在第一轮 `turn/start` 的 `effort` 里给 |
| 中途换模型 | 控制请求 `{"subtype":"set_model","model":"sonnet"}`，回包给出解析后的模型 ID | `turn/start` 带 `model` |
| 中途换推理强度 | 控制请求 `{"subtype":"apply_flag_settings","settings":{"effortLevel":"high"}}` | `turn/start` 带 `effort` |
| 怎么确认生效 | 控制请求 `get_settings` 的 `response.applied.model`、`applied.effort`；下一轮 `system/init` 的 `model` 也会变（init 里没有推理强度） | 推送 `thread/settings/updated`（`threadSettings.model`、`effort`） |
| 之后的轮次 | 一直沿用 | 一直沿用：第三轮不带覆盖，仍然是新设置 |
| 续接后 | **模型沿用上次的，推理强度不保留**：不带参数 `--resume` 时回到默认档（实测是 `medium`），带上 `--effort` 才是指定档 | **两项都保留**：`thread/resume` 回包的 `model`、`reasoningEffort` 是换过之后的 |

其他发现：

- Codex 新 thread 的推理强度不一定是模型的 `defaultReasoningEffort`：用户的 `~/.codex/config.toml` 里有 `model_reasoning_effort = "high"`，`thread/start` 回包的 `reasoningEffort` 就是 `high`，但 `model/list` 写的默认是 `low`。所以“默认”应该以 `thread/start` 回包（Codex）或 `get_settings` 的 `applied`（Claude）为准，不能取模型列表里的默认值。
- Claude 的 `set_model` 接受别名（`sonnet`），回包是解析后的完整 ID（`claude-sonnet-5-5`）。

## 对实现的意义

- 不需要“关掉原生会话再续接”这条退路。
- 适配器要做的事：
  - Claude：会话空闲时发 `set_model`、`apply_flag_settings`；启动和续接时把存下来的推理强度作为 `--effort` 传进去（续接不保留推理强度）。
  - Codex：把存下来的模型和推理强度放进下一次 `turn/start`；续接时可以不传。
- 会话里要把“实际生效的”模型和推理强度读回来显示（Claude 用 `get_settings`，Codex 用 `thread/start` 或 `thread/resume` 的回包，以及 `thread/settings/updated`）。这样用户没换过时，看到的也是 Agent 真正在用的值，而不只是“默认”。

## 补充实测（2026-11-22，实现任务 06 时）

Claude Code 2.1.318，只发控制请求、不跑轮次（不花钱），探针是 `06-probes/claude_ctl.py`：

- `initialize` 回包的每个模型带 `resolvedModel`（例如 `default` 和 `opus` 都是 `claude-opus-5-5`），以及 `supportsEffort`、`supportedEffortLevels`。`get_settings` 报的是解析后的 ID，所以界面要用 `resolvedModel` 把它对回列表里的名字。
- `set_model` 的 `model` 可以是 `"default"`：回包给出解析后的 ID（`claude-opus-5-5`），之后 `get_settings` 报的也是它。
- `apply_flag_settings {"effortLevel": null}` 让推理强度回到默认（`get_settings` 报 `medium`）。
- `set_model` 之后，stdout 上会出一条 `isReplay: true` 的 `user` 消息（`<local-command-stdout>Set model to …`），内容是字符串，不是工具结果。解析器本来就不处理这种消息。

抓取数据整理进了适配器的 `testdata/`：

- `claude/testdata/settings.jsonl`：`get_settings` 的回包只留 `applied`（`effective` 里是用户自己的设置）；请求 ID 改成了适配器自己用的前缀。
- `claude/testdata/models.json`：模型列表，去掉了 `description`。
- `codex/testdata/settings.jsonl`：`model/list` 回包、`thread/start` 和 `thread/resume` 回包（只留读的字段）、`thread/settings/updated` 推送。
