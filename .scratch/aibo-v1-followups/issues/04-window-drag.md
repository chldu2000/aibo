# 04: 窗口可以拖动

**What to build:** 主窗口和独立的会话窗口都能像普通 macOS 窗口一样拖动：按住侧栏顶部（红绿灯所在的那一条）、浮动标题栏的空白处拖动，窗口跟着走；双击这些地方，按系统设置缩放或最小化窗口。按钮、标题文字的选择、消息列表的拖选不受影响。

现状：两种窗口都是 `TitleBarHiddenInset` + `Transparent`（`cmd/aibo/main.go` 的两处 `mygo.NewWindow`），系统标题栏让给了内容，但内容里没有一处标成可拖动区域，所以窗口拖不动。MyGO 原生界面用 `ui.Element.DragWindow` 标记拖动区域（见 `WindowOptions` 的 `TitleBarStyle` 注释，以及 `ui.Context.TitleBar` 取标题栏高度和红绿灯位置）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 侧栏顶部到红绿灯下沿的一条、会话区浮动标题栏（图标按钮以外的部分）标为 `DragWindow`；高度取 `ui.Context.TitleBar`，不写死
- [ ] 独立会话窗口没有侧栏，浮动标题栏同样可拖
- [ ] 没有选中会话时（空白页、设置页）也有可拖动的区域
- [ ] 双击拖动区域，行为跟随系统“双击窗口标题栏以…”设置（如果 MyGO 的 `DragWindow` 不处理，记进实现说明，另开任务）
- [ ] 拖动区域里的按钮照常可点；消息列表的 `DragSelect` 不受影响
- [ ] 界面测试：标题栏和侧栏顶部的元素带有拖动标记（如果 Tester 能看到）；真机上把两种窗口各拖一次，结论写进实现说明
