# 05: 新建会话不再选模型

**What to build:** 点工作区的“+”，选好 Agent（只有一个可用的 Agent 时连这一步也省掉）就直接新建会话，用的是这个 Agent 自己的默认模型。模型列表从新建流程里拿掉，改到会话里去换（任务 06）。

现状：`internal/shell/sidebar.go` 的 `newSessionButton` 选完 Agent 后进 `modelPicker`，要等模型列表读出来（Claude 要起一个进程问 initialize，Codex 要问 `model/list`），慢而且多一步。新建的会话 `Model` 为空即“Agent 的默认”，这一点已经支持，不需要改工作台。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 新建会话的弹出菜单只列 Agent，点一下就新建；只有一个可用 Agent 时点“+”直接新建
- [x] 删掉 `modelPicker` 和 `side.choosingModel`；`loadModels` 如果任务 06 还要用就留着，否则一并删掉
- [x] 新会话的 `Model` 为空（显示真名的部分在 06 做：06 从 Agent 读回实际在用的模型）；输入框底部的模型显示为“默认模型”，能读到 Agent 的默认模型名时显示真名（例如 Codex 的 `isDefault` 那一项）
- [x] 现有的界面测试改成新流程：新建会话不再经过模型列表

## 实现说明

- “+”：只注册了一个 Agent 并且它可用时，直接新建；否则弹出菜单只列 Agent，点一下就新建，菜单随即关闭。不可用的 Agent 仍然灰显并写明原因。有一家可用、一家不可用时，菜单照样弹出，好让用户看到另一家为什么不能用（`TestAgentsFoundAndSignedOut` 依赖这一点）。
- 删掉了 `modelPicker`、`side.choosingModel`、`loadModels` 和 `Shell.models`。06 换模型时要读模型列表，按那边的需要重新写。`workbench.TellsModels` 留着，06 用来判断要不要显示模型菜单。
- `Shell.newSession` 不再带模型参数，新会话的 `Model` 为空。
- 测试：`TestNewSessionChoosesAgent`、`TestAgentsFoundAndSignedOut` 去掉了选模型那一步；`TestSidebarManagement` 改为检查只有一个 Agent 时点“+”直接新建、`Model` 为空、输入框底部显示“默认模型”。
