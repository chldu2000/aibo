# Codex 适配器报告、翻译 Agent 命令

Type: task
Status: ready-for-agent
Blocked by: 05, 06

## What to build

把 Codex 接进命令模型。见[规格](../spec.md)、03 号 issue 的 Codex 裁定表、research 01 的抓取数据。`review` 不在本任务内，见 10。

- 实现“命令清单”接口：在共用的 app-server 上调用 `skills/list`，传 `cwds:[工作区]`，不建线程。`scope` 填进来源，skill 的 `path` 放进适配器私有数据。
- 会话收到 `skills/changed` 后，重新调用 `skills/list`，再发 `CommandsChanged`。
- 合成裁定过的内置命令：
  - `model`、`permissions`、`compact`、`rename`：改走控件；
  - `clear`、`new`：上下文重置。
  其余内置命令不报告。
- 发送 skill 命令：文本写成 `$名字 参数`，外加 `{type:"skill", name, path}` 输入项。
- 发送 `clear` 或 `new`：调用 `thread/start`，成功后发 `ContextReset` 和新 ID 的 `NativeSessionStarted`，然后结束这个轮次。
- 不提供 `!命令`（`thread/shellCommand`）。

## Acceptance criteria

- [ ] 回放 `skills/list` 得到清单，来源齐全；`skills/changed` 会触发重新列出。
- [ ] skill 命令的输入里，文本和 skill 项都对。
- [ ] `/clear` 不经过模型：先 `ContextReset`，再新 ID，再 `TurnEnded`。
- [ ] 契约测试（`AIBO_CONTRACT=1`），附上抓取数据：`skills/list`、skill 调用、`thread/start` 重置。
