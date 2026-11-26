# 04: 识别 Cursor 和其他 ACP Agent 没有登录

Status: ready-for-agent

**Blocked by:** 02

**What to build:** 没登录时 Cursor 的 `session/new` 返回 `-32000 Authentication required`（"Please run 'agent login' first, then call authenticate() with methodId 'cursor_login'"），aibo 现在只会把它当成普通的启动失败。两处改进：设置页预先查出 Cursor 没登录；任何 ACP Agent 在会话里遇到这个错误，都给出“先登录”的说法。

实测依据（2026-11-26）：

- `cursor-agent status`：没登录打印 `Not logged in`，登录后打印 `✓ Logged in as <邮箱>`。退出码没有记录，实现时先测。
- 登录后不调 `authenticate`，`session/new` 照样成功（两次复现）；aibo 不需要调 `authenticate`。
- `initialize` 的 `authMethods` 只有 `cursor_login`。

- [ ] `agents`：Cursor 的登录方式为 `LoginTerminal`，`checkOne` 跑 `cursor-agent status`（经 01 的解析），照 `claudeLogin` 给出 `NotLoggedIn` / `Ready`；`Auth` 不显示邮箱（隐私，且外壳不需要）
- [ ] `agent` 加哨兵 `ErrNotLoggedIn`（如果已有表示同一件事的哨兵就用它）；ACP 适配器把 JSON-RPC 错误码 `-32000`（ACP 规定的 `auth_required`）译成它，原话留在错误链里
- [ ] 外壳（ADR 0005）：措辞为“先在终端登录 <Agent 名称>”，中英文；设置页对 Cursor 显示登录命令 `cursor-agent login`
- [ ] 测试：假 ACP Agent 加一种对 `session/new` 返回 `-32000`，确认得到 `ErrNotLoggedIn` 和外壳的措辞；`status` 的两种输出用假命令测试

## 不做

在 aibo 里走 Cursor 的登录流程（`LoginInApp`）。`agent login` 会开浏览器，留在终端里做。
