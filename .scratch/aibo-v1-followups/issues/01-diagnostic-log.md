# 01: 诊断日志

**What to build:** 出问题时，用户和开发者能从 aibo 自己的日志里看出发生了什么，不用挂调试器，也不用翻 Agent 的日志。aibo 在数据目录下按天轮转写诊断日志，内容包括：

- 每个会话的轮次开始、结束、出错、续接；
- Agent 进程的启动、退出和 stderr；
- 适配器认不出的消息（只记类型和字段名，不记正文）；
- 自动重试。

日志不记消息正文、引用内容和凭据。设置里提供“打开日志目录”。

起因：v1 试用时，一个 Codex 会话看上去卡在“运行中”，实际上是 Codex 在重试连接。排查时只能挂调试器、翻 Codex 自己的日志库。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 日志写在数据目录的 `logs/` 下，按天分文件，保留最近 14 天
- [x] 适配器认不出的消息都会记下（只记类型和字段名）
- [x] 不记正文、引用内容、令牌和凭据，有测试确认
- [x] 设置里有“打开日志目录”
- [x] 工作台层面的测试：一个轮次的开始、重试、结束都写进了日志

## 实现说明

- 新包 `internal/diag`（不依赖别的内部包，已加进依赖方向测试）：`logs/aibo-YYYY-MM-DD.log`，每天一个文件，换天时删掉 14 天以前的；用标准库 `log/slog` 的文本格式。`cmd/aibo` 打开数据目录时一起打开它（打不开不影响启动），退出、搬移数据目录前关闭。
- 适配器只依赖 `agent`，所以日志通过 `agent.LogSetter`（`SetLog(*slog.Logger)`）交给它们：工作台打开时给每个实现了它的 Agent 设一个带 `agent=<kind>` 的 logger。`agent` 包另有 `Shape`（只取字段名）和 `LineLog`（把 stderr 一行一行写进日志，每行最多 500 字）。
- 记什么：
  - 工作台：轮次开始（会话、Agent、引用个数）、原生会话启动（是否续接、模型、推理强度、模式）和启动失败、轮次结束（是否中断、用时）、Agent 重试和出错（Agent 的原话）、未登录、上下文压缩、Agent 自己换了模式、用户换模型或模式、原生会话自己结束。`Send`、`connect` 等从 `workbench.go`（加上日志会超过 800 行）拆到 `turns.go`。
  - Claude：进程启动（PID）、退出（退出状态，是否在轮次中）、stderr；认不出的消息记类型、子类型和字段名。明确忽略的写在代码里：`system/status`、`system/commands_changed`、`rate_limit_event`。
  - Codex：app-server 启动（PID）、退出、stderr；认不出的通知和请求记方法名和字段名。要处理和明确忽略的通知列在 `notices.go`，各写了理由。Codex 自己的警告（`warning`、`configWarning`、`deprecationNotice`、`guardianWarning`）连同内容一起记。
  - 认不出的消息每种只记一次（每个进程），免得流式消息刷屏。
- 不记什么：消息正文、Agent 的回复、引用内容、令牌和凭据。只记 ID、字段名、Agent 的错误和重试原话、stderr。
- 设置的“通用”页在数据目录下面加了“打开日志目录”（`shell.Options.OpenLogs`，`mygo.Shell.OpenPath`）。
- 测试：
  - `diag`：按天分文件、保留 14 天、不删别的文件。
  - `agent`：`Shape` 只留字段名。
  - 工作台 `TestDiagnosticLog`：一个轮次的开始、原生会话启动、重试、出错、结束都写进日志；用户的消息和 Agent 的回复（带暗号）不在日志里。
  - Claude `TestUnknownMessagesLogged`、Codex `TestNoticesLogged`：认不出的消息只记类型和字段名、只记一次，内容（带暗号）不在日志里；明确忽略的不记。
  - `TestRecordedMessagesAreKnown`、`TestRecordedNoticesAreKnown`：`testdata/` 里录下的所有真实消息都不会被当成认不出的。
  - 界面：设置里点“打开日志目录”会打开。
- 实测：用本机的 codex-cli 0.169.0 只启动 app-server（不跑轮次），日志里只有一行 “app-server started pid=…”，启动时的通知都认得。

## 没有验证

- 没在真机的 aibo 里看过实际生成的日志文件，也没跑过真实的轮次看日志全貌。
- Agent 的错误原话和 stderr 原样记下；理论上 Agent 可能在里面带出用户的内容，目前没有过滤。
- 没做日志大小上限，只按天删。
