# 08: 模型很多时，模型菜单显示不全

Status: resolved

**What to build:** 用 Cursor CLI 时，输入框底部的模型菜单列出 49 个模型（2026.11.22，带参数化列表），弹出层超出窗口，下面的模型看不到也点不到。菜单要能滚动，并且模型多时能搜索。

发现于：用户实机使用 Cursor（2026-11-26）。

现状（`internal/shell/modelctl.go` 的 `ui.Popover(c, mb, &st.models, …)`）：

- 弹出层是一个 `ui.Column(c).Width(320)`，每个模型一行（`pickRow`，名称加最多两行说明），没有 `ui.Scroll`、没有高度上限，模型有多少行就画多高。
- OpenCode（11 个左右）和 Claude Code、Codex 的列表短，没碰到；Cursor 的 49 个就超出了。别的 ACP Agent 也可能报告很长的列表（OpenCode 登记了多个提供方时就更多）。
- 推理强度菜单（同文件）和权限模式菜单（`internal/shell/mode.go`）是同样的写法，但列表短（最多 6 个推理强度、几个模式），这次不改。

做法：

- [x] 模型列表放进可滚动的区域，高度上限按弹出层上方（或下方）可用的空间算，参照 `@` 面板（`internal/shell/pull.go` 的 `room := max(0, b.Y-headerBottom-16)`、`content.MaxHeight(min(320, room))`），标题留在滚动区外
- [x] 打开时把当前模型滚进可见范围。MyGO 有 `ui.ListState` 和 `ScrollIntoView(i)`（例子见 MyGO 的 `examples/launcher/main.go`），或者按现有写法给当前行一个 key 再滚动，实现时选能用的
- [x] 模型超过一定数量（比如 12 个）时，标题下加一个搜索框：按名称和 ID 不区分大小写过滤，打开时聚焦，没有匹配时说“没有匹配的模型”（中英文）。参照 `@` 面板的文件搜索（`fileSearch`）
- [x] 键盘：搜索框里上下键移动、回车选中、Esc 关闭（如果 `@` 面板已经有这套，复用）
- [x] 测试（`internal/shell/models_test.go`）：用报告 50 个模型的假 Agent，打开菜单后最后一个模型能滚到并选中；搜索过滤后只剩匹配的；当前模型在列表下半部分时，打开后是可见的
- [ ] 在 Windows 上实机看一遍 Cursor 的菜单（窗口较矮时也看）：用 Tester 渲染看过，真实窗口留给用户

## 不做

- 按提供方或系列分组：ACP 的 `configOptions` 允许分组（`group`），aibo 读时已经把分组展平（`choices()`），Cursor 也没有分组。真有 Agent 报告分组时再说。
- 推理强度和权限模式菜单的滚动。

## 实现说明

- `internal/shell/modelctl.go`：
  - 模型列表放进 `ui.Scroll`，高度上限 `max(160, min(480, room-40))`，`room` 是模型按钮上方到窗口标题栏的距离（同 `@` 面板的算法），有搜索框时再减去它的高度。标题、读取中/失败的提示和搜索框在滚动区外。
  - 打开菜单时（`modelState.reveal`）对当前模型那一行调一次 `Element.ScrollIntoView()`，列表读到后就清掉，不会每帧都拉回去。没有用 `ui.List`/`ListState`：49 行不需要虚拟化，普通滚动区加 `ScrollIntoView` 就够。
  - 模型数 ≥ `modelSearchFrom`（12）时显示搜索框（自动聚焦，“搜索模型”/“Search models”）：`matchModels` 按名称和 ID 不区分大小写过滤；没有匹配时显示“没有匹配的模型”/“No matching models”。
  - 键盘：搜索框里 ↑↓ 在匹配项之间移动（高亮为悬停色，只在按键那一帧滚进可见范围），回车选高亮的，没有高亮时选第一个匹配。Esc 关闭是弹出层本来就有的。改了搜索词，高亮清掉。
  - 推理强度、权限模式菜单没动。
- 测试：`internal/shell/models_test.go` 的 `TestLongModelList`，假 Agent 报告 50 个模型（`manyModels`），会话在 Model 40：打开后有搜索框、Model 40 可直接点到（先确认 50 行比菜单的 480 高，否则测试不成立）；搜 “MODEL 5” 只剩 Model 5、Model 50，点 Model 50；搜不到时的提示；搜 “model 4” 按两次 ↓ 再回车选到 Model 40，菜单关上。去掉实现后这个测试失败。
- 看过渲染：用 Tester 把打开的菜单存成图（窗口高 800 和 520，以及搜索后），菜单停在模型按钮上方，矮窗口时缩短、列表滚动，打开时 Model 40 在可见范围底部。没有在真实窗口里用 Cursor 看，实机这一项留给用户。
