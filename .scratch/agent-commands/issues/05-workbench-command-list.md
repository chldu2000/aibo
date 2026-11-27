# 工作台取得并缓存 Agent 命令清单

Type: task
Status: resolved

## What to build

在 Agent 层定义命令模型，并让工作台能按会话给出命令清单。只用假 Agent 打通，真实适配器在 08、09 接入。见[规格](../spec.md)的“Agent 层的命令模型”和“工作台 / 命令清单”。

- Agent 层：
  - Agent 命令类型：正式名、说明、参数提示、别名、来源、是否内置、适配器私有数据。
  - 处理方式：交给 Agent；改走控件，注明模型、推理强度、压缩、重命名或权限模式；上下文重置。
  - `CommandsChanged{Commands}` 事件，带整份清单。
  - 可选的“命令清单”接口：传入工作区，返回清单。
- 工作台的命令清单方法，形态和需求档位仿照 `ModelList`：
  - 缓存只放在内存里，按 Agent 种类、工作区和 `ModelSource` 区分，同一工作区的多个会话共用。
  - 有原生会话时，以会话收到的 `CommandsChanged` 为准，并写回缓存。
  - 没有原生会话时：Agent 实现了清单接口，就调用它；否则提前启动这个会话的原生会话（新会话直接启动，旧会话续接），等它的第一条 `CommandsChanged`。启动不经过轮次，也不记消息。之后发消息时复用这个原生会话，空闲回收照常进行。
  - 取到新清单时 `notify`。失败时保留错误，支持重试。
- 假 Agent：能脚本化两种获取方式，能在会话里发 `CommandsChanged`。

## Acceptance criteria

- [x] 实现了清单接口的 Agent：不启动原生会话就能取到清单。
- [x] 没实现的 Agent：取清单时启动原生会话，不写任何消息；下一条消息复用这个原生会话，不会再启动一次。
- [x] `CommandsChanged` 整份替换清单，并写回缓存；同一工作区的另一个会话能读到更新。
- [x] 来源（安装或登录状态）变了，缓存随之失效。
- [x] 取失败时返回错误；用 `RetryModels` 那样的档位能重试。
- [ ] 提前启动原生会话和调用适配器都在锁外进行，`-race` 通过。（锁外已做到；`-race` 未验证，见下）
- [x] 测试写在工作台这一层，用假 Agent，先例见 `models_test.go`。

## 实现说明

- Agent 层（`internal/agent/commands.go`）：
  - `Command`，`Handling` 用 `ByAgent`（零值）、`ByModel`、`ByEffort`、`ByCompact`、`ByRename`、`ByMode`、`ByReset` 表示；
  - `CommandLister`，以及哨兵错误 `ErrCommandsFromSession`：只能从会话里拿到清单的 Agent（Claude）实现 `CommandLister` 并返回这个错误，工作台据此提前启动原生会话；
  - `CommandsChanged` 事件。
  没有实现 `CommandLister` 的 Agent（目前的 ACP 适配器）不报告命令，`TellsCommands` 返回 false，打出 `/` 时不会启动任何东西。
- 工作台（`commands.go`）：
  - `CommandList(sessionID, source, demand)`，需求档位是 `PeekCommands`、`LoadCommands`、`RefreshCommands`。`RefreshCommands` 供打开面板时用：先显示已知的清单，同时重新获取，失败了也会重试。
  - 缓存按 Agent 种类和工作区路径区分，来源（`ModelSource`）变了就丢掉重取。重新配置 Agent 时，`forgetLists` 一并清掉命令清单。
  - 原生会话报告的清单存在会话上，同时写回缓存；原生会话结束或被 detach 时清掉。还在等这个会话报告的清单，这时记为失败（`agent.ErrClosed`）。
- `connect` 改为不会重叠启动：后来的调用等先前的启动结束，再接着用它启动的原生会话。这样提前启动和随即发出的消息只会启动一次原生会话。
- 提前启动遇到无法续接时，和发送时一样进入待恢复状态；遇到未登录时，同样通知 `OnNotLoggedIn`。
- 假 Agent 新增 `SetCommands`、`ChangeCommands`、`FailCommands`、`CommandLists`。

### 没有验证

- `-race`：本机没有 gcc，跑不了，要在有 cgo 的机器上补跑。
- 真实的 Claude 和 Codex 尚未接入（见 08、09）。
