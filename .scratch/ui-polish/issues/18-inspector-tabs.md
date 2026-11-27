# 18: 详情标签页显示数量并分组

Status: ready-for-agent

**What to build:** 详情面板的标签页不用挨个点开就知道哪里有东西；会话的页和工作区的页分得开。

现状（`internal/shell/details.go` 的 `inspectorTabs`、`inspectorTabBar`）：五个只有图标的分段按钮——概览、文件、Git、终端、子 Agent，名字只在 Tooltip 里。概览、终端、子 Agent 跟着会话，文件和 Git 跟着工作区（见 `../session-workspace-sidebar/map.md`），但排在一起没有区分。正在运行的终端和子 Agent 数量只出现在输入区上方的徽章里。

- [ ] 顺序改为概览、终端、子 Agent | 文件、Git，两组之间加分隔线
- [ ] 面板顶部（标签栏下、面包屑上）写明当前范围：会话页写会话标题，工作区页写“工作区 · 名字”
- [ ] 标签加角标：终端和子 Agent 显示正在运行的数量（`running`）；Git 显示改动数；为零不显示
- [ ] Git 的角标只在面板打开时读（面板打开就观察工作区，不再只在文件和 Git 页时观察，见 `watchPanel`）；面板关着不跑 git
- [ ] 面板够宽时（例如 ≥ 360）当前标签旁显示文字名称
- [ ] Label 保持唯一：角标数字不进 Label
- [ ] Tester：有两个改动时 Git 标签显示 2；切到 Git 页顶部显示工作区名

## 决定（2026-11-27）

- 分隔线加顶部的范围说明，不做原型。
- 只在面板打开时读 Git 状态。
