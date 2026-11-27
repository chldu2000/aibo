# Claude 适配器报告、翻译 Agent 命令

Type: task
Status: ready-for-agent
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

- [ ] 回放 testdata 得到的清单：裁定为拦下的、没裁定的内置命令都不在里面；别名、参数提示齐全。
- [ ] `Turn.Command` 翻译成正确的用户消息文字。
- [ ] `/clear` 的回放：先 `ContextReset`，再出现新 ID 的 `NativeSessionStarted`。
- [ ] `/context` 的回放：回复带命令输出标志。
- [ ] 契约测试（`AIBO_CONTRACT=1`），附上抓取数据：
  - 清单的字段；
  - 只做 `initialize` 时，不产生原生会话 ID、不写会话记录、不执行 SessionStart hook；
  - 续接的进程在 `initialize` 应答里同样带清单；
  - `/clear` 会换原生会话 ID；
  - 出现白名单外的新内置命令时，测试报出来。
- [ ] 契约测试的结论回填到规格；跟 research 01 不一致的地方，写进任务说明。
