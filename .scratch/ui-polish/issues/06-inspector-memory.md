# 06: 详情面板记住上次的标签页

Status: resolved

**What to build:** 关掉详情面板再打开时回到上次看的标签页；打开面板有快捷键。

现状：
- `closeDetails` 把 `page` 清成概览（`internal/shell/details.go:29`），再打开总在概览。
- 切换会话时又保留了 `page`，只清 `selected`，两边不一致。
- 只能点标题栏的按钮打开，没有快捷键。

- [x] 关闭时保留 `page`，只清打开的单项（`selected`、子历史）；再次打开回到该页的列表
- [x] 上次的页用 `Pref` 保存
- [x] 快捷键 ⌥⌘I / Ctrl+Alt+I 开关面板（避开系统和 MyGO 已占的）
- [x] 快捷键 ⌘1…⌘5 切换标签页；面板关着时也能用，会打开到那一页（先核实是否与别处冲突：aibo 里没有）
- [x] 从徽章打开（`openActivities`）照旧直达对应页
- [x] Tester：在 Git 页关掉再打开仍是 Git 页；快捷键开关

## 实现说明

- `closeDetails` 不再清 `page`，只清打开的单项（`selected`、子历史）和待确认的模式。文件页打开的文件、Git 页打开的差异属于工作区的状态（`workspacePanel`），照旧保留。
- 新的 `showPage` 统一处理换页：清掉上一页打开的单项，再用偏好 `inspectorPage` 保存。标签栏、徽章（`openActivities`）和快捷键都走它。
- `New` 读这个偏好；值不是现有标签页的（例如以后改了页名）时回到概览（`knownPage`）。
- `toggleDetails` 供标题栏按钮和 ⌥⌘I 共用。`detailsKeys` 在有会话时每帧检查快捷键，设置窗口打开时不检查：
  - ⌥⌘I（`ui.Cmd|ui.Alt`，Windows 上是 Ctrl+Alt+I）开关面板；
  - ⌘1…⌘5（`ui.Cmd`）打开面板并切到对应的页。比工单多做了一步：面板关着时也能用，会直接打开到那一页。
- 测试 `TestInspectorRemembersPage`（新文件 `inspector_memory_test.go`）：切到命令页后关掉再开仍是命令页；重建 Shell 后打开仍是命令页；⌥⌘I 关和开；⌘1 回到概览；面板关着时 ⌘4 打开到命令页。

## 没有验证

- Windows 上 Ctrl+Alt 在不少欧洲键盘布局里等于 AltGr，Ctrl+Alt+I 可能用来输入字符。焦点在输入框时由谁先处理没有测，用这些布局的用户可能会遇到冲突。
- 标签页和标题栏按钮的提示还没有写出快捷键，用户只能从文档里知道。要写进 Label 的话，得同时改按 Label 找元素的测试，留到 18（标签页改版）一起做。
- 没有运行应用。
- `go test -race`：这台机器没有 gcc。
