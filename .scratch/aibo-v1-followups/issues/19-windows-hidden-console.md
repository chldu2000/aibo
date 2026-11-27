# 19: Windows 上启动外部程序不再弹出控制台窗口

**What to build:** 在 Windows 上，aibo 启动的每个外部程序（git、Agent CLI 和它们的探测）都不显示控制台窗口。

现状：在另一台 Windows 机器上实测，从侧栏浏览工作区文件、查看 git 状态时，不断弹出终端窗口。

原因：Windows 发布包（`go tool mygo build -platform windows/amd64`，双击启动）是 GUI 程序，本身没有控制台。GUI 进程启动 `git.exe` 这类控制台程序时，如果不带 `CREATE_NO_WINDOW`，Windows 会给每个子进程新开一个控制台窗口，子进程退出时窗口关闭。从终端启动（`go run`、测试）时，子进程沿用父进程的控制台，不会新开窗口，所以开发机上没发现。

目前只有走 `agent.BoundProcess`（`internal/agent/process_windows.go`）的进程隐藏了窗口：用户登记的 ACP Agent 和 `internal/agents` 的检测。以下调用都没有隐藏：

| 位置 | 做什么 | 频率 |
|---|---|---|
| `internal/workbench/git_status.go` `readGit` | git 状态、diff | 每次刷新 |
| `internal/workbench/browse.go` | `git check-ignore`，标出被忽略的文件 | 每列一次目录 |
| `internal/files/files.go` `gitFiles` | `git ls-files`，文件引用的候选 | 每次查找 |
| `internal/agent/claude/claude.go` | Claude 会话进程、命令探测 | 每个会话 |
| `internal/agent/codex/codex.go` `startServer` | Codex `app-server` | 每个服务进程 |

侧栏反复刷新，所以窗口一直冒出来。Claude 和 Codex 的会话进程是长期运行的，会留下一个不关的窗口（npm 装的 `claude.cmd` 走 `cmd.exe`，同样会开窗口）。

**Status:** resolved

已定的设计（2026-11-27）：

1. 新建叶子包 `internal/proc`，提供 `Hide(cmd *exec.Cmd)`：Windows 上给 `cmd.SysProcAttr.CreationFlags` 加上 `CREATE_NO_WINDOW`（已有的 `SysProcAttr` 保留，只加标志），其他平台什么都不做。
2. `agent.BoundProcess` 的 Windows 实现改为调用 `proc.Hide`，取消行为不变。git 调用只用 `proc.Hide`，不套 `BoundProcess`：git 是短命令，不需要按进程树结束。
3. 表格里每一处都调用 `proc.Hide`。
4. 加一条架构测试，防止以后再漏：`internal/` 和 `cmd/` 的非测试代码里，每个调用 `exec.Command` 或 `exec.CommandContext` 的函数，必须在同一函数里调用 `proc.Hide` 或 `agent.BoundProcess`（`BoundProcess` 自己除外）。只在 macOS 上运行的调用写进豁免表并说明原因。
5. `internal/archtest` 的分层表给 `internal/proc` 定位置：它不依赖本模块任何包；`agent`、`agent/claude`、`agent/codex`、`files`、`workbench` 可以引用它。

- [x] `internal/proc`：`Hide` 的 Windows 和非 Windows 实现
- [x] Windows 单元测试：`Hide` 后 `CreationFlags` 含 `CREATE_NO_WINDOW`，原有标志保留
- [x] `BoundProcess` 改用 `proc.Hide`
- [x] 表格里的五处调用加上 `proc.Hide`
- [x] 架构测试：不隐藏窗口的 `exec.Command` 会让测试失败
- [x] 分层表加上 `internal/proc`
- [ ] 在 Windows 上用 GUI 包（双击 `aibo.exe`）实测：浏览文件、查看 git 状态、开 Claude 和 Codex 会话，都不弹窗口

## 实现说明

- `internal/proc`：`proc.go` 放包注释，`proc_windows.go` 实现 `Hide`，`proc_other.go`（`!windows`）为空操作。测试在 `proc_windows_test.go`。
- `BoundProcess` 的 Windows 实现给会话进程和 `taskkill` 都改用 `proc.Hide`，Unix 实现不变。
- 架构测试在 `internal/archtest/console_test.go`（`TestProgramsHideConsole`）：解析 `cmd/` 和 `internal/` 的非测试文件，按顶层函数检查（函数里的闭包算在内）。豁免表 `consoleExempt` 只有 `cmd/aibo/main.go:openTerminal`，它的 `exec.Command("open", ...)` 只在 macOS 上运行。临时删掉 `files.go` 里的 `proc.Hide` 后，测试按预期失败。
- 验证：`scripts/check.sh` 的 gofmt、vet、staticcheck、go test 都通过；用 `GOOS=linux` 和 `GOOS=darwin` 交叉编译 `internal/...` 通过。race 测试用 `build/race-toolchain/bin` 里的 gcc 运行，除 `internal/agent/acp` 外都通过；`acp` 的 `TestCommandsAfterFallback` 在改动前就有数据竞争，和本任务无关。
- 没有验证：没有在 Windows 上双击 GUI 包实测是否还弹窗口（任务清单最后一项）。

## Comments
