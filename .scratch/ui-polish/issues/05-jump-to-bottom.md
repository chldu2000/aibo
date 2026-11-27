# 05: 回到底部

Status: resolved

**What to build:** 往上翻阅时，消息区右下角出现“回到底部”按钮；Agent 有新内容时按钮带提示。

现状：用户往上滚后 `ListState.FollowEnd` 关闭，新回复到了没有任何提示，只能手动滚回去。

- [x] 列表没有贴底时，在输入区上方、消息列右下显示一个圆形玻璃按钮（`arrow.down`）
- [x] 不贴底期间有新消息或流式内容增长时，按钮加一个圆点（或显示“新消息”）
- [x] 点击滚到底并恢复 `FollowEnd`
- [x] 快捷键 ⌘↓ 或 ⌘End（Windows 上为 Ctrl）同样回到底部（焦点不在输入框里时）
- [x] 高亮跳转（`reveal`）之后按钮自然出现
- [x] Tester：滚上去出现按钮，点击后贴底；贴底时不出现

## 实现说明

- 新文件 `internal/shell/follow.go`。`sessionView.follow` 记下列表上次显示末尾时末尾的样子（`endMark`：消息条数、最后一条的 seq、最后一条的内容长度，运行中再加一），以及之后有没有新内容（`fresh`）。
- `jumpToEnd` 每帧读 `ListState.AtEnd()`（上一帧是否显示了末尾）：在末尾或没有消息时不显示按钮，并更新记录；不在末尾时显示圆形玻璃按钮（`arrow.down`），末尾的样子变了就加一个强调色圆点，Label 从“回到最新”改为“下面有新消息：回到最新”。
- 点按钮、⌘↓ 或 ⌘End（`ui.Super`，Windows 上是 Ctrl）调用 `ListState.ScrollToEnd()`，`FollowEnd` 随之恢复跟随。`c.Shortcut` 让获得焦点的控件先处理按键，所以焦点在输入框时这两个键留给输入框移动光标。
- 按钮在消息区右下、输入区上方 8 处（`bottomRoom(composerHeight) - 8`），让开并排的详情面板；进出有淡入和小幅上移。
- 选择模式和高亮跳转关掉了 `FollowEnd`，离开末尾时按钮同样出现，符合清单最后一条。
- 新图标 `arrow.down` 补了 SVG 后备；新文字 `jumpToEnd`、`newBelow`。
- 测试 `TestJumpToEnd`（新文件 `follow_test.go`）：在末尾时没有按钮；往上滚后出现；新回复到达后变为“下面有新消息”；点击回到末尾、按钮消失；⌘↓ 回到末尾；焦点在输入框时 ⌘↓ 不回到末尾。

## 没有验证

- 按钮的位置在会话区右边，不跟着消息列（最宽 820）。窗口很宽时离消息有些远，没有运行应用看过。
- 流式回复时，每帧末尾的样子都在变，圆点会立即出现；回复中途滚上去是否显得太“急”，没有看过。
- Windows 上 Ctrl+End、Ctrl+↓ 在其他控件（例如详情面板的编辑器）获得焦点时由谁处理：只测了输入框。
- `go test -race`：这台机器没有 gcc。
