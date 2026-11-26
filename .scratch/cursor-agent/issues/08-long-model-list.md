# 08: 模型很多时，模型菜单显示不全

Status: ready-for-agent

**What to build:** 用 Cursor CLI 时，输入框底部的模型菜单列出 49 个模型（2026.11.22，带参数化列表），弹出层超出窗口，下面的模型看不到也点不到。菜单要能滚动，并且模型多时能搜索。

发现于：用户实机使用 Cursor（2026-11-26）。

现状（`internal/shell/modelctl.go` 的 `ui.Popover(c, mb, &st.models, …)`）：

- 弹出层是一个 `ui.Column(c).Width(320)`，每个模型一行（`pickRow`，名称加最多两行说明），没有 `ui.Scroll`、没有高度上限，模型有多少行就画多高。
- OpenCode（11 个左右）和 Claude Code、Codex 的列表短，没碰到；Cursor 的 49 个就超出了。别的 ACP Agent 也可能报告很长的列表（OpenCode 登记了多个提供方时就更多）。
- 推理强度菜单（同文件）和权限模式菜单（`internal/shell/mode.go`）是同样的写法，但列表短（最多 6 个推理强度、几个模式），这次不改。

做法：

- [ ] 模型列表放进可滚动的区域，高度上限按弹出层上方（或下方）可用的空间算，参照 `@` 面板（`internal/shell/pull.go` 的 `room := max(0, b.Y-headerBottom-16)`、`content.MaxHeight(min(320, room))`），标题留在滚动区外
- [ ] 打开时把当前模型滚进可见范围。MyGO 有 `ui.ListState` 和 `ScrollIntoView(i)`（例子见 MyGO 的 `examples/launcher/main.go`），或者按现有写法给当前行一个 key 再滚动，实现时选能用的
- [ ] 模型超过一定数量（比如 12 个）时，标题下加一个搜索框：按名称和 ID 不区分大小写过滤，打开时聚焦，没有匹配时说“没有匹配的模型”（中英文）。参照 `@` 面板的文件搜索（`fileSearch`）
- [ ] 键盘：搜索框里上下键移动、回车选中、Esc 关闭（如果 `@` 面板已经有这套，复用）
- [ ] 测试（`internal/shell/models_test.go`）：用报告 50 个模型的假 Agent，打开菜单后最后一个模型能滚到并选中；搜索过滤后只剩匹配的；当前模型在列表下半部分时，打开后是可见的
- [ ] 在 Windows 上实机看一遍 Cursor 的菜单（窗口较矮时也看）

## 不做

- 按提供方或系列分组：ACP 的 `configOptions` 允许分组（`group`），aibo 读时已经把分组展平（`choices()`），Cursor 也没有分组。真有 Agent 报告分组时再说。
- 推理强度和权限模式菜单的滚动。
