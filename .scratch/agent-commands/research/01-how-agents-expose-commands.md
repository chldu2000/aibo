# Claude Code 和 Codex 怎样报告并执行 Agent 命令

回答 [01 号问题](../issues/01-how-agents-expose-commands.md)。本机版本：Claude Code 2.1.331，Codex 0.169.0（2026-11-25 抓取）。

每条结论都标了出处：

- **[观测]**：本机实测，抓取数据在 [01-probes/](01-probes/)。
- **[schema]**：本机 `codex app-server generate-json-schema --experimental` 生成的协议定义，以及 Claude 二进制里的 zod 描述字符串。它们来自安装的版本本身，但不是行为观测。
- **[文档]**：上游文档或源码，可能和本机版本有出入。

## 探针与抓取

两个探针都按 aibo 的方式启动 Agent（参数和握手照搬 `internal/agent/claude`、`internal/agent/codex`，只是不接 aibo 的 MCP 服务器），工作区是临时目录 `/tmp/aibo-cmdprobe/ws`。探针在其中放了一个项目命令 `.claude/commands/probe-hello.md`，以及两份同名 skill：`.claude/skills/probe-greet/SKILL.md` 和 `.agents/skills/probe-greet/SKILL.md`。Claude 用 haiku 模型，Codex 用 `gpt-5.6-luna`，effort 设为 low。所有工具调用一律拒绝。

| 文件 | 内容 |
|---|---|
| [claude_cmds.py](01-probes/claude_cmds.py) | Claude 探针：`initialize` 后逐条发送 `/名字 参数`；`@sh:` 在两条消息之间改动文件，`@ctl:` 发送 control 请求。记录前删去 `initialize` 应答里 `account` 字段的值 |
| [claude_inventory.jsonl](01-probes/claude_inventory.jsonl) | 只做 `initialize`，不发消息：完整命令清单 |
| [claude_turns.jsonl](01-probes/claude_turns.jsonl) | 自定义命令、skill、本地命令、终端专用命令、未知命令、路径、新建 skill 文件、`/reload-skills`、`reload_plugins`、`/clear`，以及 `/clear` 之后的一轮 |
| [claude_replay.jsonl](01-probes/claude_replay.jsonl) | 同上，加 `--replay-user-messages`（aibo 不用这个参数），看回显；含 `/model`、`/mcp`、`/config`、`/compact`、`/exit` |
| [claude_init_clear.jsonl](01-probes/claude_init_clear.jsonl) | `/init`（内置的提示词型命令）和 `/clear`，带回显 |
| [codex_cmds.py](01-probes/codex_cmds.py) / [codex_skills.jsonl](01-probes/codex_skills.jsonl) | Codex：`thread/start` 前后各调一次 `skills/list`，新建 skill 文件，以四种写法各发一轮 |

另外测了启动开销：从启动进程到拿到清单，Claude 的 `initialize` 约 0.16 秒，Codex 的 `initialize` 加 `skills/list` 约 0.05 秒（各测两次）。**[观测]**

---

## 1. 何时、通过什么报告命令清单

### Claude Code

清单有三个来源，内容相同但名字写法不完全一致。

**(a) control 协议 `initialize` 的应答 `response.commands`** **[观测]** [claude_inventory.jsonl](01-probes/claude_inventory.jsonl)

- **时机**：进程启动后发 `initialize` 就能拿到。不用先发用户消息，也不花模型轮次。这时还没有 `system/init`，所以 aibo 还看不到原生会话 ID。
- **每项字段**：`name`、`description`、`argumentHint`（总是有，可能是空串）、`aliases`（可选，例如 `clear` 的 `["reset","new"]`、`usage` 的 `["cost","stats"]`）、`builtin`（只在 Claude Code 自带的条目上出现，值为 `true`）。二进制里的定义还写了 `argumentHint` 的含义（例如 `"<file>"`）。**[schema]**
- **来源字段**：没有单独的来源字段，只能从文字上看出来：
  - 项目命令和 skill 的说明末尾带 ` (project)`；
  - 插件的条目名字是 `插件:skill`，说明以 `(插件名) ` 开头；
  - 从 claude.ai 同步来的 skill（如 `docs`、`pdf`）既没有 `builtin` 也没有标注。
- **范围**：本机是 89 项：45 项 `builtin: true`，其余是项目、插件和同步来的条目。清单里只有无头模式能用的命令，没有 `/help`、`/status`、`/exit`、`/resume`、`/login`、`/permissions`、`/theme`。
- **`initialize` 时还没连上的 MCP prompts 不在清单里**，要等 (c)。

**(b) `system/init` 消息** **[观测]** [claude_turns.jsonl](01-probes/claude_turns.jsonl)

- **时机**：每一轮开始时发一次（包括本地命令的“轮”），不是只在会话开头。
- **字段**：
  - `slash_commands`：只有名字的字符串数组，90 项；
  - `skills`：名字数组，只含 skill；
  - `terminal_slash_commands`：`["doctor","color","focus","reload-plugins"]`。二进制里的说明是，这些是 slash_commands 中绑定本地终端界面的子集，远程界面应该从菜单里藏起来。**[schema]**
- **名字写法和 (a) 不一致**：
  - 同步来的 skill，这里写作 `anthropic-skills:docs`，在 (a) 和 (c) 里写作 `docs`；
  - MCP prompt，这里写作 `mcp__plugin_svelte_svelte__svelte-task`，在 (c) 里写作 `plugin:svelte:svelte:svelte-task (MCP)`。
- 上游文档以 `slash_commands` 作为“发现可用命令”的入口，并说需要交互终端的命令不会列出。**[文档]** [Agent SDK: Commands](https://code.claude.com/docs/en/agent-sdk/slash-commands)

**(c) `system/commands_changed`** **[观测]**

- **字段**：`{type:"system", subtype:"commands_changed", commands:[…], uuid, session_id}`，每项字段同 (a)，带的是**完整清单**。二进制里的说明是，客户端应当用它整个**替换**缓存的清单；触发的例子是 agent 在子目录工作时动态发现了 skill。**[schema]**
- **观测到两次**：
  1. 启动后、第一条消息之前（[claude_turns.jsonl](01-probes/claude_turns.jsonl) 第 3 行），因为 MCP 连上后多出了一个 MCP prompt；
  2. 在 `.claude/skills/` 下新建 skill 文件后几秒内自动推送，不用 `/reload-skills`（第 104 行）。之后再发 `/reload-skills`，回答是“none added or removed”。
- 现在 aibo 的 `claude/parse.go` 把它忽略了。

**其他**：control 请求 `reload_plugins` 的应答带 `commands`、`agents`、`plugins`、`mcpServers`、`error_count`，可以用来主动刷新。**[观测]** 第 109–110 行

**对 aibo 的意义**：aibo 启动 Claude 时带 `--strict-mcp-config`，只接自己的 MCP 服务器，所以用户的 MCP prompts 不会出现在 aibo 的会话里。上游文档说 MCP prompts 会作为命令出现。**[文档]**

### Codex

- **app-server 不报告内置命令**：
  - 生成的 `ClientRequest` 方法表里没有命令或 prompt 清单（只有 `skills/list`、`plugin/list`、`app/list`、`hooks/list` 之类）；
  - 通知里也只有 `skills/changed` 与此相关。**[schema]**
  - 内置命令是 TUI 自己的枚举（见第 4 节），app-server 拿不到。
- **自定义 prompts**：app-server 里没有。上游 TUI 有一个 `/presets`（“run or save reusable prompts and slash commands”），也只在 TUI 里。**[文档]**
- **MCP prompts**：不作为命令暴露。**[schema]**

**`skills/list`** **[schema][观测]** [codex_skills.jsonl](01-probes/codex_skills.jsonl)

- **参数**：
  - `cwds?: string[]`：为空时取“当前会话的工作目录”；
  - `forceReload?: bool`：绕过缓存，重新扫描磁盘。
- **应答**：`data: [{cwd, errors:[{message,path}], skills:[SkillMetadata]}]`。
- **`SkillMetadata` 字段**：
  - `name`、`description`、`path`（SKILL.md 的绝对路径）、`enabled`；
  - `scope`：`user | repo | system | admin`；
  - 可选的 `shortDescription`（旧字段）、`pluginId`、`dependencies`；
  - 可选的 `interface`：`displayName`、`shortDescription`、`defaultPrompt`、图标、`brandColor`。
- **参数提示**：没有对应字段。
- **不需要原生会话**：`thread/start` 之前给出 `cwds:[工作区]` 就能拿到，本机 59 项。项目级 skill 来自 `.agents/skills/`；`.claude/skills/` 里的同名文件不会被 Codex 读到。**[观测]**

**`skills/changed`**

- 参数是空对象 `{}`。schema 说明它只是失效信号：收到后用原来的参数重新调用 `skills/list`。**[schema]**
- 有线程时，新建 `.agents/skills/probe-late/SKILL.md` 后观测到了这条推送。**[观测]**
- **没有验证**：没有线程时文件变化是否也会推送。

---

## 2. 怎样调用

### Claude Code

把 `/名字 参数` 当作普通用户消息的字符串内容发出。上游文档说，能否调用与 `skills` 选项无关。**[文档]**

本机观测分五类：

| 类别 | 例子 | 表现 |
|---|---|---|
| 提示词型（自定义命令、skill、内置 skill） | `/probe-hello world`、`/probe-greet Bob`、`/init` | 展开后正常跑一轮模型（`num_turns ≥ 1`），`$ARGUMENTS` 被替换 |
| 本地命令 | `/context`、`/usage`（`/cost` 是它的别名）、`/effort low`、`/model haiku`、`/rename x`、`/mcp`、`/config`、`/output-style`、`/agents`、`/reload-skills`、`/compact`、`/clear` | 不调模型（`num_turns: 0`），立刻给出 `result` |
| 无头模式不可用 | `/help`、`/status`、`/exit` | 回一条合成消息“`/help isn't available in this environment.`”，`local_command_outcome.kind = "unavailable_headless"`，不调模型 |
| 未知名字 | `/nonexistent-xyz foo` | 当普通消息交给模型，附带“命令没有运行”的提示；花一轮模型。文档说 2.1.274 起是这样，之前直接回 `Unknown command`。**[文档]** |
| 路径 | `/tmp/foo.txt — reply …` | 当普通消息，模型正常回答 |

`/agents` 只回一段“向导已移除”的说明。

### Codex

app-server 不解析 `/`：
- 文字里的 `/名字` 原样交给模型；
- skill 用 `$名字` 或结构化输入项调用。

| 写法 | 结果 |
|---|---|
| 文字 `$probe-greet Bob` | Codex 认出 `$名字`，注入 skill 正文，回答 `GREET Bob`。**[观测]** |
| `[{type:"text",text:"$probe-greet Bob"}, {type:"skill",name:"probe-greet",path:"…/SKILL.md"}]` | 同上。`UserInput` 的 `skill` 项必须给 `name` 和 `path`。**[schema][观测]** |
| 文字 `/probe-greet Bob` | **不注入**，文字原样给模型。模型仍然答了 `GREET Bob`，但那是因为同一线程里前两轮已经注入过正文，这个结果被污染了，不能当作 `/` 有效 |
| 文字 `/clear` | 原样给模型。模型回答“Cleared.”，**实际什么也没清**，线程 ID 和上下文都不变。**[观测]** |

内置命令要靠 app-server 的方法实现，不能靠文字。**[schema]** 例如：

- `/compact` → `thread/compact/start`
- `/review` → `review/start`（目标可以是未提交改动、基准分支、某次提交或自定义说明）
- `/fork` → `thread/fork`
- `/rename` → `thread/name/set`
- `/new`、`/clear` → 新的 `thread/start`
- `/resume` → `thread/resume`
- `/goal` → `thread/goal/*`
- `/archive`、`/delete` → `thread/archive`、`thread/delete`
- `!命令` → `thread/shellCommand`（schema 注明这个方法不经沙箱、拥有完全权限）
- `/status`、`/usage` → `account/rateLimits/read` 等
- `/mcp` → `mcpServerStatus/list`
- `/plan` → `collaborationMode/list` 加回合参数
- `/model`、`/permissions` → `thread/settings/update` 或回合参数

---

## 3. 调用后回传什么

### Claude Code

**提示词型命令**

- **展开后的提示词不在 stdout 流里**。默认参数下根本没有用户消息回显；aibo 也没开回显。**[观测]**
- 加上 `--replay-user-messages` 后，回显（`isReplay: true`）也只有标签，没有正文：
  `"<command-message>probe-hello</command-message>\n<command-name>/probe-hello</command-name>\n<command-args>world</command-args>"`
  （[claude_replay.jsonl](01-probes/claude_replay.jsonl)）
- 正文只写进了磁盘上的会话记录 `~/.claude/projects/<编码后的目录>/<会话ID>.jsonl`，是紧跟在标签消息后面的一条 `isMeta: true` 用户消息。skill 的正文前面多一行 `Base directory for this skill: <目录>`。**[观测]**
- 之后是普通的 assistant、工具和 `result` 消息，和普通轮次一样。

**本地命令**

输出是一条 assistant 消息，形态如下：

- `message.model` 是 `"<synthetic>"`，`message.content` 是 `[{type:"text", text}]`，`message.id` 是 UUID 而不是 `msg_…`；
- 外层另有这些字段：
  - `local_command_source`：`"<local-command-stdout>…</local-command-stdout>"`；
  - `local_command_run: {command, args}`；不可用时换成 `local_command_outcome: {kind}`；
  - 结构化附件：`/context` 带 `context_usage`（分类、MCP 工具、skills 各占多少 token），`/usage` 带 `usage_report`；
- 随后的 `result` 是 `success`，`num_turns: 0`，`result` 就是这段文字。**[观测]**

**改变状态的命令** **[观测]**

| 命令 | 事件 | 原生会话 ID |
|---|---|---|
| `/clear` | 依次是：`{type:"conversation_reset", new_conversation_id, trigger:"clear", user_message_uuid, session_id:<旧ID>}`；`system/background_tasks_changed`；`system/session_title_changed`（标题沿用，已经带新 ID）；`system/init`（新 ID）；`result`（`result:""`，花费 0） | **变了**（492b1ff7… → 433e1579…；604fc7a5… → 3ce2a875…）。同一进程里的下一条消息落在新 ID 上。`new_conversation_id` 等于这条事件的 `uuid`，**不是**新的会话 ID。旧的会话记录还在磁盘上，可以 resume（与文档一致 **[文档]**） |
| `/compact` | `system/status` ×2；`system/compact_boundary`；一条合成用户消息（`isSynthetic: true`，内容是摘要）；**之前那几条本地命令的 `<synthetic>` assistant 消息又重发了一遍**；回显 `<local-command-stdout>Compacted </local-command-stdout>`；`result:""` | 不变 |
| `/rename x` | `system/session_title_changed {title}`，然后是合成消息“Session renamed to: x” | 不变 |
| `/model haiku`、`/effort low` | **只有一段文字**（“Set model to `Haiku 5.5` for this session only”），**没有任何结构化事件** | 不变 |

`/compact` 一行里的重发是在开了 `--replay-user-messages` 时观测到的。**没有验证**：不开回显时会不会也重发。

### Codex

- `item/started` 和 `item/completed` 里的 `userMessage` 原样回显发出去的输入项：文字项带 `text_elements: []`，skill 项带 `name` 和 `path`。**[观测]**
- **注入的 skill 正文不在 app-server 的任何通知里**，`thread/read` 的应答里也没有（抓取里搜不到正文）。
- 正文只在线程的 rollout 文件 `~/.codex/sessions/…/rollout-…-<线程ID>.jsonl` 里，是紧跟用户消息的另一条用户消息：`<skill>\n<name>probe-greet</name>\n<path>…</path>\n<SKILL.md 全文>`。文字写 `$名字` 和给结构化项，注入的内容一样。**[观测]**
- 文字 `/clear` 不改变任何状态，线程 ID 不变。真正的重置得由 aibo 换一个新线程。

---

## 4. 内置命令清单（供 03 逐条裁定）

### Claude Code：`initialize` 中 `builtin: true` 的 45 项 [观测]

下表中，参数一栏照录 `argumentHint`，空着表示没有；类型一栏是按探针结果和说明归的类，“提示词”表示展开成一轮模型对话。

| 命令 | 参数提示 | 别名 | 说明（节选） | 类型 |
|---|---|---|---|---|
| `dataviz` | | | 做图表时用的 skill | 提示词（内置 skill） |
| `update-config` | | | 配置 settings.json | 提示词（内置 skill） |
| `verify` | | | 端到端验证改动 | 提示词（内置 skill） |
| `debug` | `[issue description]` | | 开调试日志并诊断 | 提示词 |
| `code-review` | `[low\|…\|max] [--fix] [--comment] [<pr#>\|<branch>\|<path>] [--max-findings …]` | `review` | 审查当前 diff | 提示词（内置 skill） |
| `simplify` | `[<target>]` | | 清理改动代码 | 提示词（内置 skill） |
| `batch` | `<instruction>` | | 在多个隔离工作树里并行执行大改动 | 提示词 |
| `fewer-permission-prompts` | | | 扫描记录、加允许规则 | 提示词（内置 skill） |
| `doctor` | `[prompt-audit [<path>]]` | `checkup` | 体检安装 | 提示词；列在 `terminal_slash_commands` 里 |
| `loop` | `[interval] [prompt]` | `proactive` | 定时重复执行 | 提示词（内置 skill） |
| `schedule` | | `routines` | 云端定时 agent | 提示词（内置 skill） |
| `claude-api` | | | API 参考 | 提示词（内置 skill） |
| `run` | | | 启动并操作本项目的应用 | 提示词（内置 skill） |
| `run-skill-generator` | | | 编写 run-* skill | 提示词 |
| `plugin-authoring` | | | 制作 mod | 提示词（内置 skill） |
| `agents` | | | （已移除）只回一段说明 | 本地 |
| `auto-mode-setup` | `[--request-id …] (--wizard … \| …)` | | 教 auto 模式认识环境 | 提示词 |
| `autocompact` | `[auto\|<tokens>]` | | 自动压缩阈值 | 本地（未测） |
| `clear` | `[name]` | `reset`、`new` | 清空上下文，开新会话 | 本地，改变会话 ID |
| `color` | `[red\|…\|default]` | | 提示栏颜色 | 本地；列在 `terminal_slash_commands` 里 |
| `compact` | `<optional custom summarization instructions>` | | 压缩上下文 | 本地 |
| `config` | `key=value` | `settings` | 按键名改设置；不带参数时列出可用键 | 本地 |
| `output-style` | `[style]` | | 列出或切换输出风格 | 本地 |
| `context` | | | 上下文用量 | 本地 |
| `effort` | `<low\|…\|auto>` | | 设置 effort | 本地，静默改状态 |
| `fast` | `[on\|off]` | | 快速模式 | 本地（未测） |
| `focus` | `[on\|off]` | | 专注视图 | 本地；列在 `terminal_slash_commands` 里 |
| `heapdump` | | | 把 JS 堆转储到桌面 | 本地（未测） |
| `init` | | | 生成 CLAUDE.md | 提示词（实测要读写文件） |
| `mcp` | `[reconnect\|enable\|disable [<server>\|all]]` | | 管理 MCP | 本地（不带参数时只给摘要） |
| `model` | `<model>` | | 设置模型 | 本地，静默改状态 |
| `__remote-workflow` | | | 只用于服务端启动的会话 | 未测 |
| `workflow-launch-exec` | | | 只用于工作流交接 | 未测 |
| `reload-plugins` | `[--force]` | | 启用待生效的插件改动 | 本地；列在 `terminal_slash_commands` 里 |
| `reload-skills` | | | 重新扫描 skills | 本地 |
| `rename` | `[name]` | `name` | 重命名会话 | 本地，发 `session_title_changed` |
| `security-review` | | | 安全审查 | 提示词（内置 skill） |
| `usage-credits` | | | 用量额度 | 未测 |
| `extra-usage` | | | 已改名为 /usage-credits | 未测 |
| `usage` | | `cost`、`stats` | 花费与用量 | 本地 |
| `insights` | | | 分析历史会话的报告 | 提示词（未测） |
| `recap` | | | 一行会话回顾 | 未测 |
| `goal` | | | 设目标，持续工作直到达成 | 未测 |
| `list-agents` | | `peers` | 列出可以通信的子 agent 和会话 | 未测 |
| `team-onboarding` | | | 团队上手指南 | 提示词（未测） |

“内置 skill”一栏的依据是 `/context` 输出里的 Skills 表，其中这些条目标为 `Built-in`。它们同时出现在 `skills` 数组里。[claude_turns.jsonl](01-probes/claude_turns.jsonl)

`keybindings-help` 在 Skills 表里也标为 Built-in，但不在命令清单里。

不在清单里、实测回答“isn't available in this environment”的有 `/help`、`/status`、`/exit`。上游文档另举了 `/theme`、`/terminal-setup`。**[文档]**

### Codex：TUI 的内置命令（app-server 不报告）[文档]

来源是上游源码 [`codex-rs/tui/src/slash_command.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/slash_command.rs)（main 分支）。本机 0.169.0 二进制里的说明字符串和下表顺序一致（从“choose what model and reasoning effort to use”到“DO NOT USE”）。

| 命令 | 说明 | 对应的 app-server 方法 |
|---|---|---|
| `model` | choose what model and reasoning effort to use | `thread/settings/update` 或回合参数 |
| `presets` | run or save reusable prompts and slash commands | 无（TUI 专有） |
| `daybreak` | turn Daybreak on or off | 无 |
| `ide` | include current selection, open files… from your IDE | 无 |
| `permissions` | choose what Codex is allowed to do | `thread/settings/update` |
| `keymap` | remap TUI shortcuts | 无 |
| `vim` | toggle Vim mode for the composer | 无 |
| `setup-default-sandbox` | set up elevated agent sandbox | `windowsSandbox/*` |
| `experimental` | toggle experimental features | `experimentalFeature/*` |
| `approve` | approve one retry of a recent auto-review denial | `thread/approveGuardianDeniedAction` |
| `memories` | configure memory use and generation | `thread/memoryMode/set`、`memory/*` |
| `skills` | use skills to improve how Codex performs specific tasks | `skills/list` |
| `import` | import setup… from Claude Code | `externalAgentConfig/*` |
| `hooks` | view and manage lifecycle hooks | `hooks/list` |
| `review` | review my current changes and find issues | `review/start` |
| `rename` | rename the current thread | `thread/name/set` |
| `new` | start a new chat during a conversation | `thread/start` |
| `archive` | archive this session | `thread/archive` |
| `delete` | permanently delete this session | `thread/delete` |
| `resume` | resume a saved chat | `thread/resume` |
| `fork` | fork the current chat | `thread/fork` |
| `worktree` | start or continue a conversation in a new worktree | 无 |
| `app` | continue this session in the Desktop app | 无 |
| `init` | create an AGENTS.md file with instructions for Codex | 无（TUI 发一段内置提示词） |
| `compact` | summarize conversation to prevent hitting the context limit | `thread/compact/start` |
| `config` | configure Codex preferences | `config/*` |
| `recap` | summarize the current conversation now | 无 |
| `plan` | switch to Plan mode | `collaborationMode/list` 加回合参数 |
| `voice` | start or stop voice | `thread/realtime/*` |
| `goal` | set or view the goal for a long-running task | `thread/goal/*` |
| `agents` | open the agent command center | 无 |
| `side`、`btw` | start a side conversation | 无 |
| `copy` | copy the last response | 无 |
| `export` | export the conversation as markdown | 无 |
| `raw` | toggle raw scrollback mode | 无 |
| `tui` | choose the TUI mode for the next launch | 无 |
| `diff` | show git diff (including untracked files) | 无 |
| `mention` | mention a file | 无（结构化项 `mention`） |
| `status` | show current session configuration and token usage | 多个读取方法 |
| `daemon` | manage the local background server | 无 |
| `rc`、`remote` | manage remote control | `remoteControl/*` |
| `warnings` | view retained warnings | 无 |
| `cd` | change the current working directory | 无 |
| `pwd`、`cwd` | show the current working directory | 无 |
| `usage` | view account usage | `account/usage/read`、`account/rateLimits/read` |
| `debug-config` | show config layers | `config/read` |
| `title` | terminal title items | 无 |
| `statusline` | status line items | 无 |
| `theme` | syntax highlighting theme | 无 |
| `pets`、`pet` | terminal pet | 无 |
| `mcp` | list MCP tools | `mcpServerStatus/list` |
| `apps` | manage apps | `app/*` |
| `plugins` | browse plugins | `plugin/*` |
| `logout` | log out of Codex | `account/logout` |
| `quit`、`exit` | exit Codex | 无 |
| `feedback` | send logs to maintainers | `feedback/*` |
| `rollout` | print the rollout file path | 无（只在调试构建里有） |
| `ps` | list background terminals | `thread/backgroundTerminals/list` |
| `stop`、`clean` | stop all background terminals | `thread/backgroundTerminals/clean` |
| `clear` | clear the terminal and start a new chat | `thread/start` |
| `test-approval` | test approval request | 无（只在调试构建里有） |
| `subagents` | switch between this session's subagents | 无 |
| `debug-m-drop`、`debug-m-update` | DO NOT USE | 无 |

方法一栏只是按名字对上的，**不代表这些方法和 TUI 命令的行为一致**，没有逐个验证。

---

## 没有验证的部分

- Claude：
  - 不开 `--replay-user-messages` 时，`/compact` 后是否也重发之前的 `<synthetic>` 消息；
  - MCP prompt 的命令该用哪种名字调用（`plugin:…(MCP)` 还是 `mcp__…`）；
  - `/autocompact`、`/fast`、`/recap`、`/goal`、`/list-agents`、`/heapdump`、`/usage-credits` 以及两个 workflow 命令在 `-p` 下的表现。
- Codex：
  - 没有线程时文件变化是否推送 `skills/changed`；
  - `$未知名字` 的表现；
  - 插件 skill 的名字写法（本机没有带 `pluginId` 的 skill）；
  - `~/.codex/prompts` 下的旧式自定义 prompts 在 0.169 是否还有效（app-server 里看不到）。
- 两个探针都在本机的 `~/.claude/projects/-private-tmp-aibo-cmdprobe-ws/` 和 `~/.codex/sessions/2026/11/25/` 下留下了临时工作区的会话记录，没有删。
