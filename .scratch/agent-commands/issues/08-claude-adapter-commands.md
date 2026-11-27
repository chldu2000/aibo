# Claude 适配器报告、翻译 Agent 命令

Type: task
Status: resolved
Blocked by: 05, 06

## What to build

把 Claude Code 接进命令模型。见[规格](../spec.md)、03 号 issue 的 Claude 裁定表、research 01 的抓取数据。

- `initialize` 应答里的 `commands` 发一次 `CommandsChanged`；`system/commands_changed` 再发，带整份清单。
- 白名单：带 `builtin: true` 且不在裁定表里的条目，不报告。表里的内置命令带上各自的处理方式：
  - `model`、`effort`、`compact`、`rename`：改走控件；
  - `clear`：上下文重置；
  - 其余放行的：交给 Agent。
  非内置的条目一律交给 Agent。来源字段留空，不解析说明里的 `(project)`。
- 发送带命令的轮次时，拼成 `/名字 参数`，放在文件提及之前。
- `conversation_reset` → `ContextReset`；随后的 `system/init` 照常发新 ID 的 `NativeSessionStarted`。
- `<synthetic>` 回复（本地命令的输出）带上命令输出标志。
- 从 research 01 的探针结果里整理出 testdata，写解析单测。

## Acceptance criteria

- [x] 回放 testdata 得到的清单：裁定为拦下的、没裁定的内置命令都不在里面；别名、参数提示齐全。
- [x] `Turn.Command` 翻译成正确的用户消息文字。
- [x] `/clear` 的回放：先 `ContextReset`，再出现新 ID 的 `NativeSessionStarted`。
- [x] `/context` 的回放：回复带命令输出标志。
- [x] 契约测试（`AIBO_CONTRACT=1`），附上抓取数据：
  - 清单的字段；
  - 只做 `initialize` 时，不产生原生会话 ID、不写会话记录、不执行 SessionStart hook；
  - 续接的进程在 `initialize` 应答里同样带清单；
  - `/clear` 会换原生会话 ID；
  - 出现白名单外的新内置命令时，测试报出来。
- [x] 契约测试的结论回填到规格；跟 research 01 不一致的地方，写进任务说明。

## 实现说明

- `commands.go`：
  - 裁定表 `builtins`（处理方式）和 `ruledOut`（拦下），两张表之外的内置命令不提供。
  - `offered` 把 Claude 报告的条目转成 `agent.Command`；`initCommands` 读 `initialize` 的应答。
  - `Commands` 返回 `ErrCommandsFromSession`。
  - `commandText` 把命令放在消息开头，引用和文件跟在后面。
- 会话收到 `initialize` 的应答时，在 `ModeReported` 之后发 `CommandsChanged`。`system/commands_changed` 也发 `CommandsChanged`。
- `conversation_reset` 发 `ContextReset`。新的原生会话 ID 由同一轮里随后的 `system/init` 报告，原有逻辑就会记下。
- 本地命令的输出按外层的 `local_command_run` 或 `local_command_outcome` 识别（不看 `<synthetic>`，因为别的合成消息也用这个 model），回复带 `CommandOutput`。同一个进程里已经报告过的输出不再报告（`/compact` 会重发之前的输出）。
- `session_title_changed`、`background_tasks_changed` 写明了忽略的原因，不再记成未知消息。
- testdata：`testdata/commands.jsonl` 取自 research 01 的 `claude_turns.jsonl`（2.1.331），包括 `initialize` 应答、`commands_changed`、`/context`、`/help`、`/clear` 这几轮。

### 契约测试（2026-11-27，Claude Code 2.1.332，haiku）

- `TestContractBuiltinsRuledOn`、`TestContractCommandList`、`TestContractCommandTurns` 通过。
- 本机新增 9 条内置命令，按“没测过的先拦下”加进了 `ruledOut`；`code-review` 不再报告（测试会记一笔，不算失败）。
- 提前启动的实测结果和 04 号 issue 的假设不完全一致，已回填到规格：
  - `initialize` 时就写一个只有元数据的会话记录；
  - SessionStart hook 在启动时跑一次，发第一条消息时不再跑。
  
  契约测试按实测行为断言。
- `/compact` 重发之前的本地命令输出：去重之后，只剩一条命令输出。
- 开头带一个空格的 ` /context …`：Claude 当作普通文字交给模型，不执行命令。06 里留下的这一项现在验证了。
- `/clear` 留下重置标记，下一轮的原生会话 ID 换了。

### 没有验证

- `TestContractModelAndEffort` 失败（切换到 sonnet/high 后，3 分钟内没等到报告）。在这次改动之前的代码上同样失败，跟这次无关，没有修。
- `-race`：本机没有 gcc，跑不了。
