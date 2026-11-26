# 04: 识别 Cursor 和其他 ACP Agent 没有登录

Status: resolved

**Blocked by:** 02

**What to build:** 没登录时 Cursor 的 `session/new` 返回 `-32000 Authentication required`（"Please run 'agent login' first, then call authenticate() with methodId 'cursor_login'"），aibo 现在只会把它当成普通的启动失败。两处改进：设置页预先查出 Cursor 没登录；任何 ACP Agent 在会话里遇到这个错误，都给出“先登录”的说法。

实测依据（2026-11-26）：

- `cursor-agent status`：没登录打印 `Not logged in`，登录后打印 `✓ Logged in as <邮箱>`。退出码没有记录，实现时先测。
- 登录后不调 `authenticate`，`session/new` 照样成功（两次复现）；aibo 不需要调 `authenticate`。
- `initialize` 的 `authMethods` 只有 `cursor_login`。

- [x] `agents`：Cursor 的登录方式为 `LoginTerminal`，`checkOne` 跑 `cursor-agent status`（经 01 的解析），照 `claudeLogin` 给出 `NotLoggedIn` / `Ready`；`Auth` 不显示邮箱（隐私，且外壳不需要）
- [x] `agent` 加哨兵 `ErrNotLoggedIn`（如果已有表示同一件事的哨兵就用它）；ACP 适配器把 JSON-RPC 错误码 `-32000`（ACP 规定的 `auth_required`）译成它，原话留在错误链里
- [x] 外壳（ADR 0005）：措辞为“先在终端登录 <Agent 名称>”，中英文；设置页对 Cursor 显示登录命令 `cursor-agent login`
- [x] 测试：假 ACP Agent 加一种对 `session/new` 返回 `-32000`，确认得到 `ErrNotLoggedIn` 和外壳的措辞；`status` 的两种输出用假命令测试

## 不做

在 aibo 里走 Cursor 的登录流程（`LoginInApp`）。`agent login` 会开浏览器，留在终端里做。

## 实现说明

- 实测 `cursor-agent status`（2026.11.22）：已登录时文本是 `✓ Logged in as <邮箱>`，退出码 0。支持 `--format json`：`{"status": "authenticated" | "partially-authenticated" | "unauthenticated", "isAuthenticated": bool, …, "userInfo": {"email": …}}`。没有找到不退出登录就造出“未登录”的办法（`CURSOR_CONFIG_DIR` 指向空目录仍是已登录，凭据不在配置目录里），未登录的形状取自它的源码（`9837.index.js`）。按 `isAuthenticated` 判断，不读文本。
- `internal/agents`：
  - `cursorLogin`（`cursor.go`）跑 `status --format json`（经 01 的 `node.exe index.js`），给出 `Ready` / `NotLoggedIn` / 读不懂时 `Broken`；`Auth` 留空，不显示邮箱。Cursor 的 `Spec.Login` 为 `LoginTerminal`。
  - `Status.Launcher` 和 `Status.TerminalPath()`：Cursor 在 Windows 上 `Path` 是 `node.exe`，在终端里打开它没有用；`Launcher` 是安装目录里的 `cursor-agent.cmd`，设置页“复制命令”“在终端中打开”和会话里的登录横幅都改用 `TerminalPath()`。
  - 登录提示沿用通用文案“请在终端里运行 {command} 完成登录（或在 {agent} 里输入 /login）”：`cursor-agent` 交互界面里有 `/login`（源码里有 “Run /login first”），没有为 Cursor 另写文案。
- `agent.ErrNotLoggedIn`（新哨兵），`agents.ErrNotLoggedIn` 改为同一个值，外壳只需一条措辞（“Agent 未登录。”），放在 `ErrStartFailed` 之前，启动失败时说未登录而不是“没能启动”。
- ACP 适配器：请求的回复是错误码 `-32000` 时，`call` 返回的错误包上 `ErrNotLoggedIn`（原话留在后面）。一轮对话里的 `-32000` 原来就发 `agent.NotLoggedIn`，不变；那条路上的 `Failed` 消息没有加哨兵的英文。
- 工作台：`startFailed` 遇到 `ErrNotLoggedIn` 时调 `OnNotLoggedIn`（注册表 `MarkNotLoggedIn`，设置页和会话横幅随之显示未登录）。消息没有记录，`NeedsLogin` 不设：没有可重发的，用户的话留在输入框里。
- 测试：
  - `internal/agents/cursor_builtin_test.go` 的 `TestCursorDetected` 补上：已登录为 Ready、`Auth` 为空、`Launcher`/`TerminalPath()` 是 `cursor-agent.cmd`；未登录为 `NotLoggedIn`。假 CLI 回答 `status --format json` 的两种形状。
  - `internal/agent/acp/cursor_test.go` 的 `TestSignedOutAtStart`：假 ACP Agent 的 `signedout` 种类对 `session/new` 回 `-32000`，`Start` 的错误同时是 `ErrNotLoggedIn` 和 `ErrStartFailed`，带着原话；其他错误不是 `ErrNotLoggedIn`。
  - `internal/workbench/login_test.go` 的 `TestSignedOutAtStart`：启动报告未登录时通知注册表、不记录消息、不设 `NeedsLogin`；别的启动失败不通知。假 Agent 加 `FailStarts`。
  - `internal/shell/words_internal_test.go`：启动失败包着未登录时，外壳说“未登录”。
- 用本机 Cursor 临时验证过：检测为 Ready，`TerminalPath()` 为 `%LOCALAPPDATA%\cursor-agent\cursor-agent.cmd`。
- 文档：`docs/acp-agents.md` 的 Cursor 一节说明登录检查，兼容范围表加“登录”一行（任何 ACP Agent 的 `-32000`）。
