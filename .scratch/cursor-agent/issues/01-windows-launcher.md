# 01: 在 Windows 上找到并直接启动 Cursor CLI

Status: resolved

**What to build:** Cursor 官方安装脚本在 Windows 上只装 `cursor-agent.cmd`/`.ps1`（`agent.*` 是同样的副本），没有 `.exe`。aibo 的 `executable()` 在 Windows 上只认 `.exe`，所以 PATH 里有也找不到；就算运行 `.cmd`，它经 PowerShell 起 `node.exe`，aibo 结束会话时只杀得掉外层进程，`node.exe` 会留下。aibo 应该像启动脚本一样，直接运行版本目录里的 `node.exe index.js`。

实测依据：`.scratch/acp-session-settings/research/cursor-config-options.md`（探针就是这样起的，杀进程能杀干净）。

安装布局（Windows，2026.11.22-e9042b2）：

```
%LOCALAPPDATA%\cursor-agent\
  cursor-agent.cmd / .ps1, agent.cmd / .ps1   ← PATH 里的是这个目录
  versions\2026.11.22-e9042b2\node.exe, index.js, cursor-agent.ps1, …
  versions\<版本>.new / .previous             ← 更新时的暂存，不是可用版本
```

启动脚本的做法（`versions\<版本>\cursor-agent.ps1`）：在 `versions` 里按目录名 `^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$` 筛选，按日期取最新，运行 `node.exe index.js <参数>`；设置 `NODE_COMPILE_CACHE=%LOCALAPPDATA%\cursor-compile-cache`（只为加快启动）和 `CURSOR_INVOKED_AS`。外层 `.cmd` 先调 `versions\promote-staged.cmd`，把暂存的更新换上来。

- [x] 能为一个 Agent 改写“找到的路径 → 实际运行的程序和前置参数”（做成了 `Status.Args`，按命令名识别，没有改 `Spec`）。Cursor 在 Windows 上：找到 `cursor-agent.cmd` 时，解析成最新版本目录的 `node.exe`，前置参数 `index.js`。版本检查（`--version`）和启动会话（`acp`）都用解析后的结果
- [x] 常见安装位置（`Options.Dirs`）加 `%LOCALAPPDATA%\cursor-agent`；只认这个布局（启动脚本旁边要有 `versions`），单独的 `cursor-agent.cmd` 不当作 Cursor
- [x] 不跑 `promote-staged.cmd`：暂存的更新等用户下次在终端运行 Cursor 时换上。文档说明放进 02 的 Cursor 一节
- [x] 用户在设置里手动选的路径：选 `cursor-agent.cmd` 或版本目录的 `node.exe` 都能用（前者同样解析）
- [x] 版本号：`--version` 输出 `2026.11.22-e9042b2`，`versionRE` 取到 `2026.11.22`，`older()` 按数字比较可用；加测试
- [x] 测试：用临时目录造出上面的布局（`node.exe` 用测试二进制代替），确认选中最新版本、跳过 `.new`/`.previous`、没有版本目录时报未安装

## 不做

macOS/Linux：安装脚本放的是 `~/.local/bin/cursor-agent`（链接到版本目录里的脚本），按现有逻辑能找到。没有实测，`EvalSymlinks` 会把路径固定在当时的版本目录，更新后旧目录被删的情况留到有机器时验证，记在 `docs/acp-agents.md`。

## 实现说明

- `internal/agents/cursor.go`（新）：
  - `cursorLauncher(dir)`：`dir` 里有 `cursor-agent.cmd` 且 `versions` 下有版本目录时，返回最新版本的 `node.exe` 和前置参数 `index.js`。版本目录按启动脚本的正则筛选（`.new`、`.previous` 不算），按日期、再按时间戳（带时间戳的排在同一天不带的之后）、再按名字取最新；缺 `node.exe` 或 `index.js` 的版本跳过。
  - `cursorChosen(p)`：用户在设置里选的路径。Windows 上选 `cursor-agent.cmd`/`.ps1`、`agent.cmd`/`.ps1` 都解析成上面的结果，选版本目录里的 `node.exe` 则补上同目录的 `index.js`；其他平台照常要求可执行。
  - 认的是安装布局，不是位置：PATH 里的 `%LOCALAPPDATA%\cursor-agent` 和常见位置都走同一个函数；只有启动脚本、旁边没有 `versions` 的不算 Cursor。
- `internal/agents/agents.go`：
  - `Status.Args`：运行 `Path` 时放在 Agent 自己参数前面的参数。`findIn` 改为同时返回它，Cursor 和 `npmCodex` 一样按命令名 `cursor-agent` 识别。
  - 版本检查用 `Args` + `--version`；`Check` 用 `acp.Agent.ConfigureCommand(path, args, env)` 配置适配器，路径和前置参数一次设好，不会有会话用到只换了一半的配置。
  - Windows 的常见位置加 `%LOCALAPPDATA%\cursor-agent`（没有这个环境变量时用 `<Home>\AppData\Local`）：aibo 在安装之前启动、PATH 还没刷新时也能找到。
- `internal/agent/acp/acp.go`：`ConfigureCommand`，`Configure` 是它不带前置参数的形式。前置参数变了也算换了程序，和换路径一样忘掉已知的列表。
- 环境变量：启动脚本设的 `NODE_COMPILE_CACHE`（只为加快启动）和 `CURSOR_INVOKED_AS` 没有设置。`promote-staged.cmd` 不运行。这两点和 macOS/Linux 没有实测的说明写进 02 的 `docs/acp-agents.md` Cursor 一节。
- 测试：
  - `internal/agents/cursor_test.go`：`TestCursorLauncher`（最新版本、跳过暂存和旧版本、带时间戳的版本、不完整的版本、没有版本、经 `findIn` 和经设置选择三种入口、单独的启动脚本不算、别的 Agent 不会在 Cursor 的目录里被找到；只在 Windows 上运行），`TestCursorVersion`（`2026.11.22-e9042b2` 的版本号和比较）。
  - `internal/agent/acp` 的 `TestConfigureCommand`：前置参数排在 `acp` 之前，换前置参数后列表要重新获取。假 ACP Agent 在设了 `AIBO_ACP_ARGS` 时记下启动参数。
  - 用本机安装（2026.11.22-e9042b2）临时验证过：解析到 `versions\2026.11.22-e9042b2\node.exe` + `index.js`，`--version` 输出 `2026.11.22-e9042b2`。预置 Cursor 要等 02，端到端的检测测试放在 02。
