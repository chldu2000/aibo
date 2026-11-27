# 02: 记住侧栏宽度并限制范围

Status: ready-for-agent

**What to build:** 侧栏的宽度在重启后保持，拖动有合理的上下限，双击分隔线回到默认宽度。

现状：`split` 初始化为 260（`internal/shell/shell.go:163`），不保存；`ui.Split` 只保证离窗口边缘 40 DIP，可以拖到很窄或很宽；没有用 `SplitReset`。

- [ ] 宽度限制在 200–480（拖动时夹住；读出的偏好越界也夹住）
- [ ] `Split.Changed()` 时用 `Pref` 保存宽度（拖动结束后保存一次即可，不必每帧写）
- [ ] `SplitReset` 让双击回到 260
- [ ] Tester：拖动后重建 Shell 宽度不变；拖出范围被夹住；双击复位

## 不做

- 收起侧栏（01）。
