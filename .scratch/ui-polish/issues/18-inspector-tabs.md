# 18: 详情标签页显示数量并分组

Status: resolved

**What to build:** 详情面板的标签页不用挨个点开就知道哪里有东西；会话的页和工作区的页分得开。

现状（`internal/shell/details.go` 的 `inspectorTabs`、`inspectorTabBar`）：五个只有图标的分段按钮——概览、文件、Git、终端、子 Agent，名字只在 Tooltip 里。概览、终端、子 Agent 跟着会话，文件和 Git 跟着工作区（见 `../session-workspace-sidebar/map.md`），但排在一起没有区分。正在运行的终端和子 Agent 数量只出现在输入区上方的徽章里。

- [x] 顺序改为概览、终端、子 Agent | 文件、Git，两组之间加分隔线
- [x] 面板顶部（标签栏下、面包屑上）写明当前范围：会话页写会话标题，工作区页写“工作区 · 名字”
- [x] 标签加角标：终端和子 Agent 显示正在运行的数量（`running`）；Git 显示改动数；为零不显示
- [x] Git 的角标只在面板打开时读（面板打开就观察工作区，不再只在文件和 Git 页时观察，见 `watchPanel`）；面板关着不跑 git
- [x] 面板够宽时（例如 ≥ 360）当前标签旁显示文字名称
- [x] Label 保持唯一：角标数字不进 Label
- [x] Tester：有两个改动时 Git 标签显示 2；切到 Git 页顶部显示工作区名

## 决定（2026-11-27）

- 分隔线加顶部的范围说明，不做原型。
- 只在面板打开时读 Git 状态。

## 实现说明

- **顺序**：概览、命令记录、子 Agent | 工作区文件、Git，两组之间是一条竖线。
  - ⌘1–⌘5（06）跟着新顺序走，现在 ⌘2 是命令记录。
- **范围说明**：标签栏下面、面包屑上面加了一行淡色小字。会话的页写会话标题，工作区的页写“工作区 · 名字”（`workspacePage`）。
- **角标**（`tabCounts`）：
  - 命令和子 Agent 显示运行中的数量，沿用徽章行的 `running`；
  - Git 显示改动数；
  - 为零时不显示。
  - 角标是标签右上角的一个小数字，不进 Label。
- **Git 状态只在面板打开时读**：`watchPanel` 的条件从“文件页或 Git 页”改成“面板打开”，面板关着就不观察工作区，也不跑 git。Git 角标只在工作区被观察时读 `GitStatus`。
- **宽面板显示名称**：面板宽度不小于 360 时，当前标签在图标旁显示文字名称。宽度取上一帧的面板宽度。
- **快捷键提示**：标签的提示带上快捷键，按平台显示（`cmdKey`：macOS 上是 ⌘1，其他平台是 Ctrl+1）。顺便把 16 的两个新会话按钮也改成按平台显示（`shiftCmdKey`），文案里不再写死 ⌘。
- **测试**：
  - 新增 `TestInspectorTabs`：五个标签从左到右的顺序；两个未跟踪文件时 Git 标签的角上显示 2，且标签名不变；概览页顶部写会话标题；Git 页顶部写“工作区 · 名字”。
  - 更新 `TestInspectorRemembersPage`：⌘4 改为 ⌘2。
  - 更新 `TestNewSessionShortcut`：提示文字按平台。
  - 更新 `TestInspectorFileSelectionFollowsWorkspace`：见下面第一条。

## 没有验证

- **观察范围扩大带来的变化**：面板一打开就读 Git 状态，这时如果目录还不是仓库，结果会被缓存。之后在面板开着的情况下 `git init`，文件监视看不到 `.git` 的出现，要点“刷新工作区”才会更新。测试里 `git init` 后加了一次刷新。以前是切到 Git 页时才第一次读，所以没有这个问题。
- **快捷键提示没统一**：其他地方写死的 ⌘（侧栏的“隐藏侧栏（⌘\）”、设置的“设置（⌘,）”）还没有改成按平台显示。⌘, 本身还在用 `ui.Super`，也没改，等你决定。
- 角标、竖线、名称在真机上的大小和对齐没有看过。

## 后续：监视 .git 的变化（2026-11-28）

- **原来的问题**：应用的工作区监视（`cmd/aibo/workspace_watch.go`）忽略整个 `.git`。所以不只是 `git init`，在终端里提交、切分支这些只改 `.git` 的操作，理论上 Git 页都看不到。
- **改法**：新的 `ignoreInWorkspace` 在 `.git` 里只忽略 `refs` 以外的子目录。也就是监视 `.git` 本身、它顶层的 `HEAD`、`index` 等文件和 `refs/`，`objects/`、`logs/`、`hooks/` 这类仍然忽略。
- **不会自己触发自己**：工作台自己跑的 git 命令都带 `--no-optional-locks`，不会写 `.git/index`，所以不会形成刷新循环。
- **测试**：
  - `TestIgnoreInWorkspace` 覆盖各种路径，包括子目录里的仓库；
  - `TestWatchSeesGit` 用真实的 `WatchFiles` 检查 `git init` 和 `git commit` 都会触发通知。

### 没有验证

- 在这台 Windows 机器上，旧规则也能通过 `TestWatchSeesGit`。可能是 Windows 的递归监视把目录树的变化都报上来了，所以这个测试在 Windows 上区分不出新旧规则。真正的差别应该在 macOS（FSEvents）上，没有在 macOS 上跑过。
- 外壳测试不提供 `WatchWorkspace`，`TestInspectorFileSelectionFollowsWorkspace` 里 `git init` 后的那次刷新仍然需要。
