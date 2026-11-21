# 05: 新建会话不再选模型

**What to build:** 点工作区的“+”，选好 Agent（只有一个可用的 Agent 时连这一步也省掉）就直接新建会话，用的是这个 Agent 自己的默认模型。模型列表从新建流程里拿掉，改到会话里去换（任务 06）。

现状：`internal/shell/sidebar.go` 的 `newSessionButton` 选完 Agent 后进 `modelPicker`，要等模型列表读出来（Claude 要起一个进程问 initialize，Codex 要问 `model/list`），慢而且多一步。新建的会话 `Model` 为空即“Agent 的默认”，这一点已经支持，不需要改工作台。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 新建会话的弹出菜单只列 Agent，点一下就新建；只有一个可用 Agent 时点“+”直接新建
- [ ] 删掉 `modelPicker` 和 `side.choosingModel`；`loadModels` 如果任务 06 还要用就留着，否则一并删掉
- [ ] 新会话的 `Model` 为空；输入框底部的模型显示为“默认模型”，能读到 Agent 的默认模型名时显示真名（例如 Codex 的 `isDefault` 那一项）
- [ ] 现有的界面测试改成新流程：新建会话不再经过模型列表
