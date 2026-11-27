# 工作台发送带命令的消息并如实记录

Type: task
Status: resolved
Blocked by: 05

## What to build

让用户消息能带一个 Agent 命令，并交给 Agent 执行。时间线上需要的记录全部由工作台保存。只用假 Agent 打通。见[规格](../spec.md)的“工作台”。

- `Outgoing` 加可选的命令（名称、参数），`agent.Turn` 加 `Command{Name, Args}`。
- 发送时用最新的清单核对：别名换成正式名。处理方式为“交给 Agent”或“上下文重置”的，作为轮次发出。名称在清单里找不到（选中后被删掉了）的，照发。
- 用户消息存下命令快照：名称、参数、发送时的说明。消息存为 JSON，加字段不需要迁移；旧消息读出不变。
- 不带命令、但以 `/单词` 开头的文字，返回带类型的错误：附上 Agent 名，并区分“不在清单里”和“暂时拿不到清单”。先在未修剪的原文上判断开头是不是 `/`，再修剪，这样开头带空格的文字能原样发出。外壳在 `words.go` 里给这个错误措辞，中英文同时写。
- 回复事件加“命令输出”标志，回复消息保存这个标志。
- 命令消息所在的轮次结束时，如果之后既没有回复、也没有工具调用、也没有失败，就给这条消息记上“命令已执行”状态。
- 新增 `ContextReset` 事件。工作台收到后，复用现有的 `Reset` 标记种类加一条标记；之后的 `NativeSessionStarted` 由现有逻辑记下新的原生会话 ID。
- 假 Agent 记下收到的 `Turn.Command`，能发 `ContextReset` 和带命令输出标志的回复。

## Acceptance criteria

- [x] 假 Agent 收到的 `Turn.Command` 用的是正式名，文件提及和图片照常带上。
- [x] 用户消息里有名称、参数和说明的快照；重新打开工作台后仍然在。
- [x] 清单外的 `/单词`、拿不到清单时的 `/单词`，分别返回对应的错误；` /单词`（开头带空格）照发；`/Users/x` 照发。
- [x] 只有命令、没有回复的轮次，记上“命令已执行”；失败的轮次不记。
- [x] `ContextReset` 之后出现 `Reset` 标记，原生会话 ID 换成新的，aibo 会话不变；之后恢复会话时用的是新 ID。
- [x] 命令输出标志能保存，也能读出。
- [x] 测试先例：`compaction_test.go`、`attachments_test.go`。

## 实现说明

和规格不一样的地方：

- **`agent.Turn.Command` 是整条 `*agent.Command`**，不是 `{Name, Args}`。适配器要用到 `Data`（Codex skill 的路径）和 `Handling`。参数就是 `Turn.Text`。有引用时，`Text` 以引用概要开头，所以适配器要把命令放在整段最前面，引用概要会跟着落进参数里。
- **“命令已执行”记成一种新标记 `model.CommandRan`**，挂在发出命令的那条用户消息后面。原因：用户消息存下时就是完成状态，而 `store.UpdateMessage` 只改还在流式输出的消息。轮次里已经有其他标记的（比如 `/clear` 留下的重置标记），不再加这条。
- **工作台也认文字里的 `/单词`**：`Send(id, "/review x")` 中的单词如果在清单里，就当作调用这条命令，用别名也一样；不在清单里的，返回 `SlashCommandError`。外壳仍然应当发结构化的 `Outgoing.Command`，这条只是兜底。
- **开头带空格的逃生路**：只要原文开头不是 `/`，就照常发出。去掉首尾空白后像命令的文字，发给 Agent 时在前面补一个空格，免得 Claude 当成命令执行。
- **改走控件的命令**暂时返回未导出的 `errControlCommand`，07 会换成真正的分流。

其他：

- 带类型的错误 `SlashCommandError` 带 Agent 名、单词，以及原因（`NotACommand`、`CommandsUnknown`、`NoCommands`），`errors.Is(err, ErrSlashCommand)` 仍然成立。外壳的 `saySlash` 给它措辞，中英文都写了。
- 有命令的会话，默认标题是 `/名字 参数`。
- 外壳还不会显示 `CommandRan` 标记：现在这种标记会被显示成“新的原生会话”。目前还发不出命令（外壳在 11 才接入，真实 Agent 在 08、09 才报告清单），所以实际上不会出现。12 里补上显示。

### 没有验证

- `-race`：本机没有 gcc，跑不了。
- Claude 收到开头带一个空格的 `/单词` 时，是否确实不当作命令：留给 08 的契约测试。
