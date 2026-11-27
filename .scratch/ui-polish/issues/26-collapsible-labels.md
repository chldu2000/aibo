# 26: “显示参数”和“思考”的折叠标签不重复

Status: resolved

**What to build:** 同时展开好几个工具调用、或者好几条回复都带思考时，每个折叠块的 Label 在画面内仍然唯一，读屏和 Tester 能分清楚。

现状：“显示参数”（`internal/shell/render.go:130`，`locales.ShowArgs()`）和“思考”（`render.go:59`，`locales.Thinking()`）的 `ui.Collapsible` 都用固定文字当标签。同屏有两个以上时 Label 重复。09 的“没有验证”里已经记下这一点。

- [x] 显示的文字不变，Label 带上序号：“显示参数 #ID”（ID 同 09 的活动 ID，子调用是 `父ID.序号`），“思考 #seq”
- [x] 先核实 `ui.Collapsible` 能不能把显示文字和 Label 分开；不能的话给它加一个设置 Label 的方法
- [x] Tester：展开两个调用的参数、两条回复的思考，四个 Label 都不同；已有测试里按“显示参数”“思考”查找的地方相应改掉

## 来源

09 的“没有验证”。用户 2026-11-28 确认要做。

## 实现说明

- `ui.Collapsible` 只返回外层的列，拿不到触发区，没法单独设 Label。MyGO 是外部依赖，所以没有改它，而是在新文件 `internal/shell/fold.go` 里写了 `fold(c, text, label, open, fn)`：用 `ui.CollapsibleBase` 照 `coreCollapsible` 的样子搭（间距、圆角、悬停底色、转动的箭头、面板缩进都相同），只是触发区多了 `.Label(label)`。箭头的画法照搬 MyGO 里私有的 `disclosurePath`，不考虑从右到左的布局（aibo 目前没有这类语言）。
- 新文案 `thinkingLabel`（“思考 #{seq}”）和 `showArgsLabel`（“显示参数 #{id}”），显示的文字仍是原来的 `thinking` 和 `showArgs`。
- 已有测试按文字点“显示参数”“思考”，文字节点还在，所以不用改。
- 测试 `TestFoldLabels`：两条带思考的回复、两个调用，全部展开，按新 Label 逐个点开，四段内容都出现，画面里没有重名的按钮。已确认去掉 `.Label(label)` 时测试失败。

## 没有验证

- 没有在真机上和 `ui.Collapsible`（比如工具调用那一行）并排对比，看两者是否完全一样。MyGO 以后改了 `Collapsible` 的样式，`fold` 不会跟着变。
- 侧栏的“已归档”和审批卡的“显示规则”仍用 `ui.Collapsible`。它们在同一画面里只出现一次，不会重名。
