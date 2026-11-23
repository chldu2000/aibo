# aibo 的项目结构与编码规范

v1 之后的约束。能用工具检查的，都在 `scripts/check.sh` 里；提交前运行它。

## 结构

### 分层

```
agent（接口与事件） ← claude / codex / fake（适配器）
model ← store ← workbench ← shell ← cmd/aibo
```

- 适配器只依赖 `agent`；工作台不认识具体的适配器；外壳不碰 `store`。
- 每个包能引用哪些包，写在 `internal/archtest` 的表里，越界就测试失败。新建包时先在表里给它定位置。
- 工作台是唯一的业务接缝：界面只调用工作台的方法，外部 Agent 只通过适配器接入。
- 新功能的测试默认写在工作台这一层，用假 Agent。界面测试（MyGO Tester）只测交互，不重复测业务。

### 文件

- 按领域拆文件，一个文件管一块事。
- 行数软上限 800：超过时，下次改到它就顺手拆分。硬上限 1000：超过时 `check.sh` 失败。测试文件同样适用，按被测的领域拆。

## 并发

- 持有工作台的锁（`w.mu`）时：
  - 不调用 `notify`；
  - 不调用原生会话（`agent.Session`）的任何方法；
  - 不做会阻塞在外部进程上的事。
- 要关的原生会话先用 `detach` 取出，解锁后再 `Close`。
- 消息、工具调用等可变数据跨出锁之前一律 `Clone`。
- 界面状态只在主线程改。后台得到的结果用 `Shell.later` 或 `mygo.RunOnMain` 交回主线程。
- 能跑 `-race` 的包（不链接 MyGO 界面的那些）都由 `check.sh` 跑。

## Agent 协议

- 适配器不静默丢弃消息：每种消息要么映射成事件，要么在代码里写明为什么忽略。认不出的消息写进诊断日志。
- 协议上的新结论，都要附上真实抓取的数据（`testdata/*.jsonl`），加契约测试（`AIBO_CONTRACT=1` 时运行），并回填规格。
- Agent 升级后，先跑一遍契约测试。
- 只调用用户本机安装、未经修改的 `claude` / `codex`；不读取、不转交它们的凭据；测试未登录状态时用隔离的配置目录，不动真实的登录状态。

## 存储

- 迁移只能追加，已发布的迁移不再修改。每加一次迁移，都要跑升级前备份的测试（`OpenVersion`）。

## 文字与语言

- 用户看得到的文字一律放进 `locales/` 的语言目录（MyGO 的 ARB 格式 JSON），代码只调用生成的 `locales` 函数，不在 Go 代码里写界面文字。包括：
  - 界面上的文字，以及 Tester 用来查找元素的 Label；
  - 错误提示、通知、对话框；
  - 交给用户看的状态说明。
- 只有外壳（`internal/shell`）和 `cmd/aibo` 引用 `locales`（依赖方向测试管着）。下层包不拼界面文字（ADR 0005）：
  - 需要说给用户听的错误，返回哨兵错误或带类型的错误（`workbench.ErrTurnRunning`、`workbench.Failure`、`agents.UnusableError`），错误本身的文字用英文，写给开发者看；外壳在 `words.go` 里转换成当前语言的文字，认不出的原样显示。
  - 需要显示的状态给结构化的字段（审批的 `Action`、规则的 `Grant`、Agent 检测的 `Problem`、重试的次数），由外壳措辞。
  - Agent 的原话（报错、模式名称）原样显示，不翻译。
- 交给 Agent 读的文字不属于界面文字，单独存放：引用概要和工具结果在 `internal/refs`，MCP 工具说明在 `internal/mcpserver`，适配器对 Agent 说的话在各自的 `prompts.go`。
- 至少支持简体中文和英文。源语言是英文（`locales/en.json` 写全所有文字，其他语言缺词时回退到英文）。新增文字两种语言同时写。
- 加了或改了文字，运行 `go tool mygo generate` 重新生成 `locales/catalog_gen.go`，和语言文件一起提交。带整数参数的消息，在 `en.json` 的 `@键名` 里把参数类型写成 `int`（不写时参数是字符串），参数按消息里出现的顺序列出。
- `internal/shell` 的测试默认用简体中文（`main_test.go`），`inLocale` 切换语言；`i18n_test.go` 在两种语言下各跑一遍冒烟测试，检查外壳和 `cmd/aibo` 的代码里没有中文字符串、两个语言文件的键一致。
- Label 在同一画面内保持唯一：Tester 按文字查找元素，重名会点错。冒烟测试会检查两种语言下控件的 Label 是否重复。

## 代码风格

- Go 的注释和标识符用英文；提交信息用中文。
- 错误提示要说清楚出了什么事、用户能怎么办。
- 只用 `CGO_ENABLED=0` 构建。
- 术语跟 `GLOSSARY.md` 一致；难以撤回、出人意料、经过取舍的决定，记进 `docs/adr/`。

## 流程

- 一个任务对应一次提交；任务文件里写实现说明，以及“没有验证”的部分。
- 提交前运行 `scripts/check.sh`。
- 发布前：运行 `go tool mygo build -platform darwin/arm64` 打包，在真机上点一遍，再改 `mygo.json` 里的版本号。
