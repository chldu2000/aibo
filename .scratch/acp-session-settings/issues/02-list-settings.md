# 02: 列出 ACP Agent 的模型、推理强度和模式

Status: ready-for-agent

**What to build:** ACP Agent 实现 `Models(ctx)`（`workbench.ModelLister`）和 `PermissionModes(ctx)`（`agent.ModeLister`），这样输入框底部的模型、推理强度、模式菜单，以及设置里“新会话的默认模式”，都对 ACP Agent 出现。

难点：ACP 没有 Agent 级别的列表，要先建会话才能拿到；推理强度跟着模型变，要逐个模型切换才知道（[实测](../research/opencode-config-options.md)）。

**Blocked by:** 01

- [ ] 先补实测：`session/delete` 能否删掉探测会话；项目级 `opencode.json` 是否改变列表
- [ ] 探测：起一个独立进程，`initialize`、`session/new`（工作区用 aibo 数据目录下的空目录，不传 MCP），读出模型和模式；再对每个模型调一次 `set_config_option`，记下它的 `thought_level` 可选值，填进 `agent.Model.Efforts`（去掉 `default`）。`DefaultEffort` 留空，默认值以 Agent 上报的为准。最后 `session/delete`，关掉进程
- [ ] Agent 的 `sessionCapabilities` 没有 `delete` 时不探测，避免在它的历史里留下空会话；改为从真实会话学习：01 记下的配置项交回 Agent，缓存最近一次看到的模型和模式列表。没有缓存时，`Models` 和 `PermissionModes` 返回空，界面像现在一样不显示菜单
- [ ] 真实会话里只知道当前模型的推理强度。别的模型的推理强度要么来自探测，要么未知；未知时，换到那个模型后再按会话上报的配置项显示推理强度菜单（需要确认界面能处理“列表里没有、会话里有”）
- [ ] 缓存：工作台已经按 Agent 缓存模型列表（`modelLists`）。编辑或恢复 Agent 配置后（`RegisterAgent`）失效重读
- [ ] 模式列表按 category `mode` 或旧接口的 `availableModes` 生成；风险等级先一律 Caution、非只读，`Default` 标在 `session/new` 报告的当前值上（03 再接配置）
- [ ] 测试：适配器用测试程序模拟两种 Agent（有 `delete`、没有 `delete`）；工作台用假 Agent 测缓存失效；界面测试确认 ACP Agent 出现模型、推理强度、模式三个菜单
- [ ] 契约测试：OpenCode 的探测列表包含 `build`、`plan`，探测后它的会话列表里没有多出会话

## 已知局限

列表来自中立目录。如果某个工作区的项目配置多出模型或模式，会话里的实际值可能不在列表里，界面按会话上报的值显示原名。
