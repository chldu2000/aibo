# 01: 在 Windows 上找到并直接启动 Cursor CLI

Status: ready-for-agent

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

- [ ] `agents.Spec` 能为一个 Agent 改写“找到的路径 → 实际运行的程序和前置参数”。Cursor 在 Windows 上：在 `%LOCALAPPDATA%\cursor-agent` 找到 `cursor-agent.cmd` 时，解析成最新版本目录的 `node.exe`，前置参数 `index.js`。版本检查（`--version`）和启动会话（`acp`）都用解析后的结果
- [ ] 常见安装位置（`Options.Dirs`）加 `%LOCALAPPDATA%\cursor-agent`；只认这个布局，PATH 里别处的 `cursor-agent.cmd` 不当作 Cursor
- [ ] 不跑 `promote-staged.cmd`：暂存的更新等用户下次在终端运行 Cursor 时换上。文档说明
- [ ] 用户在设置里手动选的路径：选 `cursor-agent.cmd` 或版本目录的 `node.exe` 都能用（前者同样解析）
- [ ] 版本号：`--version` 输出 `2026.11.22-e9042b2`，`versionRE` 取到 `2026.11.22`，`older()` 按数字比较可用；加测试
- [ ] 测试：用临时目录造出上面的布局（`node.exe` 用测试二进制代替），确认选中最新版本、跳过 `.new`/`.previous`、没有版本目录时报未安装

## 不做

macOS/Linux：安装脚本放的是 `~/.local/bin/cursor-agent`（链接到版本目录里的脚本），按现有逻辑能找到。没有实测，`EvalSymlinks` 会把路径固定在当时的版本目录，更新后旧目录被删的情况留到有机器时验证，记在 `docs/acp-agents.md`。
