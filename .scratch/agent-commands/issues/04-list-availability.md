# 命令清单在什么时候可用

Type: grilling
Label: wayfinder:grilling
Status: resolved
Blocked by: 01

## Question

新会话发出第一条消息前、恢复会话前、Agent 进程退出后，aibo 都可能没有原生会话。按 01 得到的报告时机和启动开销，决定这时补全列表显示什么：空、沿用同一 Agent 同一工作区上次的清单，还是提前启动进程。说明清单变化（Claude 的 `commands_changed`、Codex 的 `skills/changed`）时怎样刷新，以及清单是否需要落盘。

## Answer

**还没有原生会话时**：用户在输入框开头打出 `/` 时才去取，不在新建会话时预先取。
- Claude：提前启动这个会话自己的原生进程（新会话直接启动，旧会话带 ResumeID 续接），从它的 `initialize` 应答里拿清单，之后发消息接着用这个进程。不另起临时进程，免得在用户发消息前多跑一次项目的 SessionStart 等 hook。用户没发消息的话，进程照常在空闲 30 分钟后被回收。
- Codex：在共用的 app-server 上调用 `skills/list`，传 `cwds:[工作区]`，不需要建线程。

**原生会话运行时**：以会话自己的清单为准。Claude 用 `initialize` 应答里的清单，收到 `commands_changed` 时整份替换；Codex 收到 `skills/changed` 后重新调用 `skills/list`。

**缓存**：只放在内存里，不写进数据库。按“Agent 种类 + 工作区 + 安装和登录状态”区分，同一工作区的多个会话共用一份；做法参照模型清单（`internal/workbench/models.go`）。打开面板时先显示缓存，同时在后台取最新的；原生进程收到的新清单也写回缓存。历史消息不依赖这份缓存，因为命令说明的快照已经随消息存下（02）。

**取不到时**：面板显示失败原因，沿用模型清单的失败状态和重试。这时手打的 `/单词` 没法核对，就拦下，提示暂时拿不到该 Agent 的命令清单；想原样发给模型的话，在开头加个空格。

**清单过期**：发送时用手上最新的清单再核对一次，在清单里就照发。命令在选中之后、发送之前被删掉的情况接受下来，不额外处理；之后出了错，走普通的错误显示。

**实现时要验证**：
- Claude 的原生进程只做 `initialize`、还没收到用户消息时，不产生原生会话 ID、不写会话记录、不执行 SessionStart hook；
- 续接的进程在 `initialize` 应答里同样带清单。
