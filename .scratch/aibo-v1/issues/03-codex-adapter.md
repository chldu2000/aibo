# 03: 在 aibo 里和 Codex 对话

**What to build:** 用户新建一个 Codex 会话后，可以和本机的 `codex` 对话：看到流式回复、工具调用（命令、文件修改）、思考内容和计划，并且能随时停止。多个 Codex 会话共用一个 app-server 进程，各自是一个 thread。重启 aibo 后，在旧会话里发消息会续接原来的 thread。

实现 Codex 适配器：一个 `codex app-server` 进程（stdio JSONL）承载多个 thread，Go 类型由 `generate-json-schema` 生成。这一条不含审批和 MCP 注入。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（Agent 适配器 · Codex、会话模型与存储）。调研：`.scratch/multi-agent-workbench-v1/research/01-agent-integration.md`、`.scratch/multi-agent-workbench-v1/research/08-codex-thread-tools.md`、`.scratch/multi-agent-workbench-v1/research/08-probes`。

**Blocked by:** 01（工作台骨架：用假 Agent 跑通一个会话）

**Status:** resolved

- [x] 多个 Codex 会话共用一个 app-server 进程，事件按 thread 正确分发到各自的会话
- [x] 流式回复、思考内容、工具调用（调用和结果合为一条）、plan 都按规范会话模型显示
- [x] 点击停止后，当前回复以“已中断”保存
- [x] thread ID 记入会话元数据；重启后发首条消息时用 `thread/resume` 续接
- [x] app-server 进程意外退出时，受影响的会话显示错误，下次发消息时重新拉起
- [x] 消息归一化有主接缝测试
- [x] 契约测试（环境变量开启）调用真实 `codex`，覆盖流式输出、工具调用、多 thread 和续接

## Comments

- 实现说明：
  - 所有 Codex 会话共用一个 `codex app-server`，第一个会话启动时拉起，最后一个会话关闭时停掉。通知按 `threadId` 分发给对应的会话；进程意外退出时，所有会话收到错误，下次发消息时重新拉起。
  - 写 stdin 用单独的锁，避免管道写满时和读循环互相卡住。
  - 线程用 `thread/start` / `thread/resume` 管理，并持久保存，否则无法续接；关闭会话时 `thread/unsubscribe`。
  - 条目映射：`agentMessage` 对应回复（流式增量）；`reasoning` 作为下一条回复的思考，后面没有回复时单独成一条；`turn/plan/updated` 对应计划；`commandExecution`、`fileChange`、`mcpToolCall`、`dynamicToolCall`、`webSearch`、`collabAgentToolCall` 对应工具调用；`turn/completed` 的 `interrupted` / `failed` 分别按中断 / 出错处理。
  - 审批要等任务 10，在那之前按默认档位（`on-request` + `workspace-write`）启动，所有审批请求自动拒绝，与 Claude 目前直接拒绝的效果一致。
  - Codex 的工具名写法留给任务 08 实测，现在的 `ToolName` 原样返回工具名。
  - 工作区“＋”在有多个 Agent 时弹出选择；选模型见任务 16。界面上加了自绘的 Codex 图标；工具调用标题里，命令中的换行显示为“↵”。
- 和规格的出入：规格写的是“Go 类型由 `generate-json-schema` 生成”，实际只手写了用到的那一小部分字段，并对照 0.169.0 生成的 schema 核对过。协议新增字段不影响解析；字段改名会在契约测试里暴露。
- 测试：
  - 回放测试：录制的真实通知（命令、写文件、中断后继续）。
  - 按 schema 构造的通知：计划、文件修改、MCP 工具、被拒的命令、思考、出错的轮次。录制时模型没有用到这些，所以没有真实数据。
  - 契约测试：`AIBO_CONTRACT=1` 时运行，覆盖同一个 app-server 里两个 thread 并发且事件不串、命令输出、重启后续接、中断后继续，已在本机通过。契约测试会在 `~/.codex` 的历史里留下几个测试 thread。
