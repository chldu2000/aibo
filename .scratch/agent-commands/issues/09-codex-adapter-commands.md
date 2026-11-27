# Codex 适配器报告、翻译 Agent 命令

Type: task
Status: resolved
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

- [x] 回放 `skills/list` 得到清单，来源齐全；`skills/changed` 会触发重新列出。
- [x] skill 命令的输入里，文本和 skill 项都对。
- [x] `/clear` 不经过模型：先 `ContextReset`，再新 ID，再 `TurnEnded`。
- [x] 契约测试（`AIBO_CONTRACT=1`），附上抓取数据：`skills/list`、skill 调用、`thread/start` 重置。

## 实现说明

- `commands.go`：
  - 合成的内置命令有 `model`、`permissions`、`compact`、`rename`、`new`、`clear`，说明照录 Codex TUI 的原话。
  - `skills/list` 的结果转成命令：只要启用的 skill；`scope` 填进来源，路径放进 `Data`。和内置命令同名的 skill 不提供。
  - `Agent.Commands` 在共用的 app-server 上调用 `skills/list`。如果是专为这次调用启动的 app-server，一分钟后还没有线程用它，就停掉（`stopIfIdle`）。
- `skills/changed` 不带 threadId，现在由 server 层处理：每个线程重新调用 `skills/list`，再发 `CommandsChanged`。
- 发 skill：文本写成 `$名字 参数`，外加 `{type:"skill", name, path}` 输入项。
- `/clear`、`/new`：适配器用会话当前的设置调用 `thread/start`。“当前的设置”指启动时的参数，叠加之后 `SetMode`、`SetModel` 改过的权限模式、模型和推理强度。之后会话改在新线程上进行（`rekey`），旧线程 `thread/unsubscribe`。事件依次是 `ContextReset`、新 ID 的 `NativeSessionStarted`、设置，最后 `TurnEnded`，不经过模型。
- `codex.go` 超过了 800 行：输入和设置相关的代码挪进了新文件 `input.go`。
- 单元测试用一个按脚本应答的 app-server（`scripted`）。testdata 里的 `skills-0.169.0.json` 取自 research 01。

### 契约测试（2026-11-27，codex-cli 0.172.0）

- `TestContractSkillsAndReset` 通过：
  - 不建线程就能拿到清单；
  - 发 skill 时注入了正文，回复是 `GREET Bob`；
  - 有线程时新增 skill，清单会跟着更新；
  - `/clear` 留下重置标记，原生会话 ID 换了；新线程不记得之前的对话。
- Codex 原有的契约测试全部通过。

### 没有验证

- 没有线程时新增 skill，Codex 会不会推送 `skills/changed`。不推送也没关系：打开面板时用 `RefreshCommands` 会重新取清单。
- `-race`：本机没有 gcc，跑不了。
