# 06: 详情面板记住上次的标签页

Status: ready-for-agent

**What to build:** 关掉详情面板再打开时回到上次看的标签页；打开面板有快捷键。

现状：
- `closeDetails` 把 `page` 清成概览（`internal/shell/details.go:29`），再打开总在概览。
- 切换会话时又保留了 `page`，只清 `selected`，两边不一致。
- 只能点标题栏的按钮打开，没有快捷键。

- [ ] 关闭时保留 `page`，只清打开的单项（`selected`、子历史）；再次打开回到该页的列表
- [ ] 上次的页用 `Pref` 保存
- [ ] 快捷键 ⌥⌘I / Ctrl+Alt+I 开关面板（避开系统和 MyGO 已占的）
- [ ] 快捷键 ⌘1…⌘5 在面板打开时切换标签页（先核实是否与别处冲突）
- [ ] 从徽章打开（`openActivities`）照旧直达对应页
- [ ] Tester：在 Git 页关掉再打开仍是 Git 页；快捷键开关
