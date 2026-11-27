# ACP Agent 的命令怎样接入

Type: task
Label: wayfinder:task
Status: resolved

## Question

Claude Code 和 Codex 的 Agent 命令已经可以调用（[调用 Agent 命令](../../agent-commands/spec.md)）。ACP Agent 推送的 `available_commands_update` 现在被忽略（`internal/agent/acp/updates.go`），打出 `/单词` 时会提示“没有 aibo 能调用的命令”。要定下：ACP Agent 的命令怎样进入 `/` 面板、怎样发出，哪些要放行、哪些要拦下。然后接到已有的命令模型上。

## 依据（2026-11-27 调研）

**ACP 规范**（[Slash Commands](https://agentclientprotocol.com/protocol/slash-commands)）
- 建好会话之后，Agent 可以推送 `available_commands_update`；之后随时可以再推，增删命令或修改说明。
- 每条命令只有 `name`、`description`，以及可选的 `input.hint`。没有“是否内置”“来源”这类字段。
- 客户端调用时，在 `session/prompt` 里发文字 `/名字 参数`，由 Agent 自己认出前缀并执行。规范没有规定客户端怎样核对命令。

**Zed 这个客户端**（来自 issue；没有读 Zed 的源码）
- 不做白名单，Agent 报什么就列什么，选中后按文字发出。
- 补全在提示词任何位置都会出现，但只有放在开头的命令才执行（[zed#66222](https://github.com/zed-industries/zed/issues/66222)，还没修）。
- 清单如果在 `session/new` 应答之前到达，会被丢掉，界面显示“没有可用命令”（[zed#53161](https://github.com/zed-industries/zed/issues/53161)）。修复的 PR [#59281](https://github.com/zed-industries/zed/pull/59281) 没合并就被关了。

**Agent 一侧的 ACP 适配器负责筛选**
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)（npm 0.113.0，`dist/slash-commands.js`）：
  - 写死了一份不报告的名单：`clear`、`cost`、`keybindings-help`、`login`、`logout`、`output-style:new`、`release-notes`、`todos`；
  - Claude Code 标为终端专用的命令也不报告；
  - `/mcp` 由适配器接管；另外加了 `/plugin`、Remote Control 等自己的命令。
- 这个适配器早先报告了 `/usage`、`/model` 等命令，执行后却没有输出。报告者说这样会逼得每个客户端自己写死黑名单。后来改成把本地命令的输出渲染出来（[claude-agent-acp#642](https://github.com/agentclientprotocol/claude-agent-acp/issues/642)）。
- Zed 的 [codex-acp](https://github.com/zed-industries/codex-acp)（已归档）只支持 `/review`、`/review-branch`、`/review-commit`、`/init`、`/compact`、`/logout`，由适配器自己实现。

**本机实测（已有抓取数据）**
- Cursor 2026.11.22 报告 61 条命令，OpenCode 报告 67 条。都是 `session/new` 之后才推送，没有 `input.hint`；Cursor 的清单里没有 `clear`、`model`、`compact`。见 `internal/agent/acp/testdata/cursor-2026.11.22-turns.jsonl`，以及 `.scratch/agent-extensibility/research/01-probes/handshake.jsonl`（OpenCode 的清单已脱敏）。
- 在 aibo 的 ACP 适配器里，`session/update` 的 `sessionId` 必须等于已知的会话 ID 才会处理（`transport.go` 里的 `valid`），而会话 ID 要等 `session/new` 的应答到了才设上。所以应答之前推过来的清单会被丢掉，和 Zed 的 bug 一样。目前测过的两家都在应答之后才推送，还没出问题。

## 建议的做法（待确认）

1. **全部放行，交给 Agent。**
   - 按 ACP 的分工，只报告能在 ACP 里用的命令，是 Agent 一侧适配器的责任；清单里也分不出哪些是内置命令。所以 aibo 不再做白名单，每条命令的处理方式都是 `ByAgent`。
   - 模型和权限模式改了，ACP 会用 `config_option_update`、`current_mode_update` 报回来，aibo 的控件不会和 Agent 脱节。
   - 这和 Claude、Codex 的白名单做法不同，要记一条 ADR 说明原因。
2. **只能从会话里取清单。**
   - 适配器实现 `CommandLister`，返回 `ErrCommandsFromSession`；`available_commands_update` 转成 `CommandsChanged`，`input.hint` 填进参数提示。
   - ACP 是每个会话一个进程，打出 `/` 时会提前启动这个会话自己的进程。Cursor 启动会话最长要 90 秒，第一次打开面板会一直显示“正在加载”。
3. **发送**：把 `/名字 参数` 作为提示词里第一个文字块的开头。
4. **修时序问题**：会话 ID 还不知道时到达的 `session/update` 先缓存起来，等 `session/new` 的应答到了再按顺序处理，不要丢掉。
5. **可选的逃生口**：在 `agents.json` 的 Agent 登记里，允许按名字隐藏某些命令，用于某个 Agent 的某条命令在 aibo 里出问题的情况。是否需要，等实际遇到再定。
6. **已知限制**：ACP 没有“上下文重置”的事件，通过 ACP 清空上下文时，aibo 画不出重置分隔线。ACP 会话 ID 不变，所以记录不会出错。

## 验收

- [x] 契约测试（Cursor；本机没装 OpenCode，没有跑）：
  - 清单能进 `/` 面板；
  - `/名字 参数` 被 Agent 当作命令执行，而不是普通文字。这一点目前只有规范依据，要实测；
  - 本地命令没有输出时，显示“命令已执行，没有输出”。
- [x] 回放测试覆盖 `session/new` 应答之前就到达的 `available_commands_update`。
- [x] 记一条 ADR：ACP Agent 的命令全部交给 Agent，不做白名单。
- [x] 规格回填进 [调用 Agent 命令](../../agent-commands/spec.md)，或者单独写一份规格。

## Answer

按“建议的做法”1–4 实现了；第 5 条（按名字隐藏命令）先不做；第 6 条的限制保留。[ADR 0009](../../../docs/adr/0009-acp-agents-rule-on-their-own-commands.md) 记下了这个决定。

- **`internal/agent/acp/commands.go`**：
  - `available_commands_update` 转成 `CommandsChanged`，`input.hint` 填进参数提示；没有名字或重名的条目去掉；处理方式一律为“交给 Agent”。
  - `Agent.Commands` 返回 `ErrCommandsFromSession`，工作台会提前启动会话的进程来取清单。
  - 会话启动后 5 秒内 Agent 没报告清单，就先报告一份空清单，免得工作台一直等。之后清单到了会替换它；空清单不会排在真清单后面（同一把锁）。
  - 发送：`/名字 参数` 放在文字块的开头，带命令时文字块排在图片前面。
- **早到的清单**：会话还没有 ID 时，只缓存最后一条 `available_commands_update`，等 `session/new` 的应答带来会话 ID 后再报告。其他早到的通知照旧丢掉，因为 `session/load` 在应答之前回放的历史要挡在外面。
- **测试**：
  - 假 ACP Agent 的 `commands` 类型会在 `session/new` 应答之前推送清单，测试覆盖了缓存和发送；
  - 也覆盖了 5 秒的空清单兜底、兜底之后清单到达，以及 Cursor 抓取数据的解析。
- **契约测试**（2026-11-27，Cursor CLI 2026.11.22）：`TestContractCursorCommands` 通过：
  - 清单有 75 条，项目命令 `.cursor/commands/probe-hello.md` 在里面；
  - 发出 `/probe-hello` 后，回复里有命令文件里写的暗号，说明 Cursor 确实执行了命令，没有把它当作文字交给模型；
  - Cursor 原有的两个契约测试也都通过。
- **文档**：`docs/acp-agents.md` 的兼容范围表加了“Agent 命令”一行，验证一节写了新的契约测试。

### 没有验证

- 本机没装 OpenCode，它的命令没有跑契约测试。
- 只报告空清单、之后才报告真清单的 Agent，打开面板时会先显示“没有匹配的命令”，等下一次刷新才看到真清单。没有用真实的 Agent 测过。
- `-race`：本机没有 gcc，跑不了。
