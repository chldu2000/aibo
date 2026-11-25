# Claude Code 和 Codex 怎样报告并执行 Agent 命令

Type: research
Label: wayfinder:research
Status: resolved

## Question

在 aibo 现有的接入方式下（常驻 `claude -p` 的 stream-json 加 control 协议、`codex app-server`），两家各自：

1. 在什么时机、通过哪条消息报告可用的内置命令、自定义命令和 skills（Claude 的 `system/init`、`commands_changed`、control 请求；Codex 的 skills 列表接口、`skills/changed`），每项带哪些字段（名称、说明、来源、参数提示）？是否必须先启动原生会话才拿得到？
2. 怎样调用：Claude 在 `-p` 模式下发送 `/名字 参数` 的用户消息时，哪些内置命令可用、哪些报错或无效？Codex 的 skills 和 prompts 通过什么输入调用（`$名字`、结构化输入项还是别的）？
3. 调用后协议上回传什么：展开后的提示词是否出现在流里，形态如何；`/clear` 等改变状态的命令会产生什么事件，原生会话 ID 是否改变？

用本机安装的版本抓取真实数据，区分上游文档与观测。

## Answer

详见[调研结论](../research/01-how-agents-expose-commands.md)，抓取数据在 `research/01-probes/`。

1. **清单。**
   - Claude 启动进程后发 control `initialize`，应答的 `commands` 就是完整清单（约 0.16 秒，不用发消息、不花模型轮次）。每项有 `name`、`description`、`argumentHint`、`aliases?`、`builtin?`，没有来源字段，只能看说明里的 `(project)`、`(插件名)` 和 `插件:` 前缀。
   - `system/commands_changed` 推送完整清单，应当整个替换缓存：启动后 MCP 连上时推一次，skill 文件变化时也会自动推。
   - `system/init` 每轮都发，只有名字数组（`slash_commands`、`skills`、`terminal_slash_commands`）。同步来的 skill 和 MCP prompt 在这里的名字写法和 `commands` 不一样，应当以 `commands` 为准。
   - Codex 的 app-server **不报告任何内置命令**，那是 TUI 自己的。`skills/list`（可以不开线程，按 `cwds` 查）返回 `name`、`description`、`path`、`scope`、`enabled`、`interface`、`pluginId`，没有参数提示。项目级 skill 读的是 `.agents/skills/`。`skills/changed` 是空的失效信号。
2. **调用。**
   - Claude 收到用户消息 `/名字 参数` 时：
     - 提示词型命令（含内置 skill，如 `/init`、`/code-review`）跑一轮模型；
     - 本地命令（`/context`、`/usage`、`/model`、`/effort`、`/rename`、`/compact`、`/clear` 等）不花轮次，立即给出 `result`；
     - `/help`、`/status`、`/exit` 回“isn't available in this environment”；
     - 未知的 `/单词` 当普通消息交给模型（花一轮）。
   - Codex 不解析 `/`：
     - skill 用文字 `$名字` 调用，或者给结构化输入项 `{type:"skill", name, path}`；
     - 文字 `/clear` 原样交给模型，模型会答“Cleared.”，其实什么都没做；
     - 内置命令只能由适配器改调对应的方法（`thread/compact/start`、`review/start`、`thread/fork`、`thread/start` 等）。
3. **回传。**
   - 两家都**不在流里回传展开后的提示词**：Claude 只写进磁盘上的会话记录（`isMeta` 用户消息），Codex 只写进 rollout 文件（`<skill>…` 用户消息），流里最多是原样回显。
   - Claude 本地命令的输出是一条 `model:"<synthetic>"` 的 assistant 消息，带 `local_command_run` 或 `local_command_outcome`，`/context` 和 `/usage` 还带结构化附件。
   - `/clear` 发出 `conversation_reset` 加新的 `system/init`，**原生会话 ID 改变**，旧会话留在磁盘上。
   - `/compact` 发 `compact_boundary`，会话 ID 不变。
   - `/rename` 发 `session_title_changed`。
   - `/model` 和 `/effort` 只回一段文字，没有任何结构化事件。
   - 两家的内置命令完整清单列在结论文件的第 4 节。
