# 27: 徽章行和横幅跟输入区一样宽

Status: resolved

**What to build:** 输入区上方的徽章（运行中的命令、子 Agent、收到的引用等）和横幅，左右边缘和输入区、消息列对齐，宽窗口里不会伸到消息列外面。

现状：`167bcd8` 把输入区限制在 `streamWidth`（828）以内并居中，`35d78d8` 让选择栏也这样做，但提交说明里写明“banners and badges stay as they were”。`badges`（`internal/shell/badges.go:55`）的行还是占满整个会话区宽度，横幅（`banners`）也是一样，所以宽窗口里徽章贴在会话区的最左边，和输入框的左边缘对不齐。

- [x] 徽章行：外层用 `ui.Row(c).Justify(ui.Center)` 包住，内层 `Grow(1).MaxWidth(streamWidth)`，做法和 `composer` 一样；徽章在这一列里左对齐，换行也只在这一列里换
- [x] 横幅、未开始的审批卡同样处理（先核实它们现在多宽）
- [x] 窄窗口里照旧占满可用宽度
- [x] 在 `composer_layout_test.go` 里加测试：宽窗口里徽章行和横幅的左右边缘不超出输入区

## 来源

用户 2026-11-28 提出。

## 实现说明

- 横幅和审批卡原来也占满会话区。现在不再逐个限宽，而是把输入区上方整列（横幅、未开始的审批卡、徽章行、输入区或选择栏）放进一列，宽度最多 `streamWidth`，在会话区里居中（`internal/shell/view.go` 的 `pane`）。外层从 `Column` 改成居中的 `Row`，`composer.Bounds()` 量到的高度不变，底部留白和窄窗口下详情面板的位置照旧。
- 输入区和选择栏仍各自包一层 `Row`，因为它们的卡片靠 `Grow(1)` 横向撑满。
- 测试 `TestComposerWidth` 加了一条高亮横幅和一个“收到的引用”徽章：宽窗口里两者的左边缘在消息左边缘附近，右边缘不超出消息列。去掉改动时测试失败，横幅从 x=28 一直伸到 1539。
- 横幅和徽章贴着输入区卡片的边缘，消息正文比它们往里缩 4。
- `view.go` 超过 800 行，把 `banners` 和 `resumeBanner` 原样挪进新文件 `banners.go`。

## 没有验证

- 没有在真机上看宽窗口和窄窗口下的效果。
