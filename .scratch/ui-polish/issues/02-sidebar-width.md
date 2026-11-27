# 02: 记住侧栏宽度并限制范围

Status: resolved

**What to build:** 侧栏的宽度在重启后保持，拖动有合理的上下限，双击分隔线回到默认宽度。

现状：`split` 初始化为 260（`internal/shell/shell.go:163`），不保存；`ui.Split` 只保证离窗口边缘 40 DIP，可以拖到很窄或很宽；没有用 `SplitReset`。

- [x] 宽度限制在 200–480（拖动时夹住；读出的偏好越界也夹住）
- [x] `Split.Changed()` 时用 `Pref` 保存宽度（拖动结束后保存一次即可，不必每帧写）
- [x] `SplitReset` 让双击回到 260
- [x] Tester：拖动后重建 Shell 宽度不变；拖出范围被夹住；双击复位

## 不做

- 收起侧栏（01）。

## 实现说明

- `sidebar.go`：`sidebarWidth`、`sidebarMin`、`sidebarMax` 为 260、200、480。`sidebarResized` 每帧把 `s.split` 夹在范围内。`Split.Changed()` 时记下时间，停 300ms（`widthRest`）没再动才用偏好 `sidebarWidth` 保存一次，计时用 `c.Now()` / `c.After`。键盘方向键移动分隔线也算移动。
- `View`：`Split` 加了 `SplitReset(sidebarWidth)`，双击分隔线回到 260，同样会保存。
- `New` 读偏好并夹住范围。`Close` 时如果还有没保存的移动，补存一次，免得拖完马上关窗口时丢掉。
- 侧栏隐藏（01）时不画 `Split`，宽度保持原样，再显示时回到原来的宽度。
- 测试 `TestSidebarWidth`：拖到 340 后停下前不保存、停下后保存；拖过 480 和 200 都被夹住；重建 Shell 后宽度保持；双击回到 260 并保存。

## 没有验证

- 夹住是在 `Split` 返回之后做的：拖过上下限时，可能有一帧按越界的宽度画出来。Tester 里看不出来，实际窗口里有没有闪动没有看过。
- 没有运行应用：拖动的手感、双击的识别间隔，只在 Tester 里跑过。
- `go test -race`：这台机器没有 gcc。
