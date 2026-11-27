# 20: 详情面板里的长列表

Status: needs-triage

**What to build:** 终端、子 Agent 和 Git 页在条目很多时仍然好找。

现状：
- `activityPage`（`internal/shell/activities.go`）列出全部调用，没有过滤和上限；先核实顺序（`workbench.Activities` 的返回顺序），常见做法是最新在上、运行中置顶。
- `gitPage` 列出全部改动，大仓库可能上千行；`../session-workspace-sidebar/map.md` 的“Not yet specified”已记下这一点。

- [ ] 终端、子 Agent：运行中的置顶，其余最新在上；列表顶部加过滤框（按命令或描述）
- [ ] 终端：可以只看失败的（退出码非零）
- [ ] Git：每组超过 100 条时折叠，显示“还有 N 个”；分组标题可折叠
- [ ] 列表用 `ui.List` 虚拟化（如果 Scroll 里的 Column 在千行时卡顿，先测）
- [ ] Tester：200 条命令时过滤生效；Git 千条改动时首屏流畅

## 待定

- 先在真实的大会话和大仓库里测一下现状是否真的卡，再决定是否需要虚拟化。
