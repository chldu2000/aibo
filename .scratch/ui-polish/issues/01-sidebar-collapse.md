# 01: 侧栏可以收起

Status: resolved

**What to build:** 用户能把左侧栏收起，让会话区占满窗口，再一键展开。

现状：`View` 总是用 `ui.Split` 画侧栏（`internal/shell/view.go:37`），没有按钮也没有快捷键收起它；窗口很窄时侧栏照样占 260。

- [x] 侧栏顶部加收起按钮（`sidebar.leading`）；收起后，会话区的浮动标题栏最左侧出现展开按钮（Windows 上在标题栏起点，macOS 上让开红绿灯）
- [x] 快捷键 ⌘\ / Ctrl+\ 切换收起
- [x] 收起状态用 `Pref` 保存，重启后保持
- [x] 窗口宽度小于某个值（建议 640）时自动按收起显示，但不改写保存的偏好；窗口变宽后恢复
- [x] 展开有过渡（参照 `inspectorMotion`）；收起没有，见实现说明
- [x] Tester：点按钮和按快捷键都能切换；收起后能从标题栏展开；重启（重建 Shell）后保持

## 不做

- 侧栏宽度（02）。
- 会话的独立窗口（`Options.Only`）本来就没有侧栏，不受影响。

## 实现说明

- `sidebarUI` 加了 `collapsed`（用户的选择，存为偏好 `sidebarCollapsed`）、`narrowOpen`（窄窗口里临时展开）、`hidden`（这一帧是否隐藏）。`New` 时读偏好。
- `sidebarHidden`：独立窗口总是隐藏；窗口宽度小于 640（`narrowWindow`）时隐藏，除非用户临时展开；变宽后清掉临时展开，回到用户的选择。
- `toggleSidebar`：窄窗口里只切换临时展开，不写偏好；否则切换并保存。按钮和 ⌘\ / Ctrl+\（`ui.Super` + `KeyBackslash`）都调用它。
- `View`：隐藏时不画 `Split`，会话区直接占满窗口（没有左边距和圆角，也不把根背景设成透明，Windows 上不露 Mica）。重命名和删除的对话框从 `sidebar` 移到 `View`，侧栏隐藏时也能弹出。
- `pane`：侧栏隐藏时，浮动标题栏和独立窗口一样让开红绿灯（`bar.Left + 12`），左上角也能拖动窗口；标题栏最左边是“显示侧栏”。没有打开会话时，这个按钮单独浮在标题栏的位置。
- 侧栏头部加“隐藏侧栏”，放在“添加工作区”右边。新图标 `sidebar.leading` 补了 SVG 后备。
- 新文字 `hideSidebar`、`showSidebar`。
- 测试 `TestSidebarCollapse`（新文件 `sidebar_collapse_test.go`）：没有会话时和有会话时都能隐藏、显示；⌘\ 切换；偏好写入，重建 Shell 后保持；窄窗口自动隐藏、临时展开不改偏好、变宽后恢复、再变窄又隐藏。

## 没有验证

- 没有运行应用：macOS 上红绿灯和展开按钮的位置、Windows 上 Mica 和自绘窗口按钮的效果，只在 Tester 里检查了文字和行为。
- 收起没有动画：整个 `Split` 被移走，`sidebar` 上的 Exit 是否生效没有把握，所以只加了展开时的 Enter。看实际效果再决定要不要补。
- 没有会话时，提示仍写“在左侧选一个会话”。侧栏隐藏时，左上角就是展开按钮，意思还对得上，没有改。
- `go test -race`：这台机器没有 gcc。
