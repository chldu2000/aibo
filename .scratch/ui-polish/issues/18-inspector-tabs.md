# 18: 详情标签页显示数量并分组

Status: needs-triage

**What to build:** 详情面板的标签页不用挨个点开就知道哪里有东西；会话的页和工作区的页分得开。

现状（`internal/shell/details.go` 的 `inspectorTabs`、`inspectorTabBar`）：五个只有图标的分段按钮——概览、文件、Git、终端、子 Agent，名字只在 Tooltip 里。概览、终端、子 Agent 跟着会话，文件和 Git 跟着工作区（见 `../session-workspace-sidebar/map.md`），但排在一起没有区分。正在运行的终端和子 Agent 数量只出现在输入区上方的徽章里。

- [ ] 标签加角标：Git 显示改动数（`GitStatus` 已有结果时），终端和子 Agent 显示正在运行的数量（`running`）；为零不显示
- [ ] 排序和分组：概览、终端、子 Agent 一组，文件、Git 一组，中间用分隔线隔开；或在面板顶部标出当前是“会话”还是“工作区 · 名字”
- [ ] 面板够宽时（例如 ≥ 360）当前标签旁显示文字名称
- [ ] Label 保持唯一（带数字的角标不进 Label，或 Label 用固定文字）
- [ ] Tester：有两个改动时 Git 标签显示 2；切到工作区组的页时能看到工作区名

## 待定

- 分隔线 vs 两排 vs 顶部说明：可以先用 `prototype` 比一下。
- 角标要不要读 Git 状态：只在面板打开或标签可见时读，避免每个会话都去跑 git（`watchPanel` 目前只在文件和 Git 页时观察工作区）。
