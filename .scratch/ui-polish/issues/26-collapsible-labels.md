# 26: “显示参数”和“思考”的折叠标签不重复

Status: ready-for-agent

**What to build:** 同时展开好几个工具调用、或者好几条回复都带思考时，每个折叠块的 Label 在画面内仍然唯一，读屏和 Tester 能分清楚。

现状：“显示参数”（`internal/shell/render.go:130`，`locales.ShowArgs()`）和“思考”（`render.go:59`，`locales.Thinking()`）的 `ui.Collapsible` 都用固定文字当标签。同屏有两个以上时 Label 重复。09 的“没有验证”里已经记下这一点。

- [ ] 显示的文字不变，Label 带上序号：“显示参数 #ID”（ID 同 09 的活动 ID，子调用是 `父ID.序号`），“思考 #seq”
- [ ] 先核实 `ui.Collapsible` 能不能把显示文字和 Label 分开；不能的话给它加一个设置 Label 的方法
- [ ] Tester：展开两个调用的参数、两条回复的思考，四个 Label 都不同；已有测试里按“显示参数”“思考”查找的地方相应改掉

## 来源

09 的“没有验证”。用户 2026-11-28 确认要做。
