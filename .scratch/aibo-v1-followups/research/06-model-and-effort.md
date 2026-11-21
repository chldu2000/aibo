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
