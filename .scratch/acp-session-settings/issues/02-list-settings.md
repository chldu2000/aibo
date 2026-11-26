# 02: 列出 ACP Agent 的模型、推理强度和模式

Status: resolved

**What to build:** ACP Agent 实现 `Models(ctx)`（`workbench.ModelLister`）和 `PermissionModes(ctx)`（`agent.ModeLister`），这样输入框底部的模型、推理强度、模式菜单，以及设置里“新会话的默认模式”，都对 ACP Agent 出现。

难点：ACP 没有 Agent 级别的列表，要先建会话才能拿到；推理强度跟着模型变，要逐个模型切换才知道（[实测](../research/opencode-config-options.md)）。

**Blocked by:** 01

- [x] 先补实测：项目级 `opencode.json` 是否改变列表（`session/delete` 已在 01 的补充实测里确认可用）
- [x] 探测：起一个独立进程，`initialize`、`session/new`（工作区用系统临时目录下新建的空目录，不传 MCP；实现时改了，见实现说明），读出模型和模式；再对每个模型调一次 `set_config_option`，记下它的 `thought_level` 可选值，填进 `agent.Model.Efforts`（实现时保留了 `default`，见实现说明）。最后 `session/delete`，关掉进程
- [x] Agent 的 `sessionCapabilities` 没有 `delete` 时不探测，避免在它的历史里留下空会话；改为从真实会话学习：01 记下的配置项交回 Agent，缓存最近一次看到的模型和模式列表。没有缓存时，`Models` 和 `PermissionModes` 返回空，界面像现在一样不显示菜单
- [x] 真实会话里只知道当前模型的推理强度。别的模型的推理强度要么来自探测，要么未知；未知时，换到那个模型后再按会话上报的配置项显示推理强度菜单（需要确认界面能处理“列表里没有、会话里有”）
- [x] 缓存：工作台已经按 Agent 缓存模型列表（`modelLists`）。编辑或恢复 Agent 配置后（`RegisterAgent`）失效重读
- [x] 模式列表按 category `mode` 或旧接口的 `availableModes` 生成；风险等级先一律 Caution、非只读，`Default` 标在 `session/new` 报告的当前值上（03 再接配置）
- [x] 测试：适配器用测试程序模拟两种 Agent（有 `delete`、没有 `delete`）；工作台用假 Agent 测缓存失效；界面测试确认 ACP Agent 出现模型、推理强度、模式三个菜单
- [x] 契约测试：OpenCode 的探测列表包含 `build`、`plan`，探测后它的会话列表里没有多出会话

## 已知局限

列表来自中立目录。如果某个工作区的项目配置多出模型或模式，会话里的实际值可能不在列表里，界面按会话上报的值显示原名。

## 实现说明

- 新文件 `internal/agent/acp/catalog.go`：ACP Agent 实现 `Models`、`PermissionModes`、`TellsModels`、`OnListsChanged`。
  - **探测**：第一次需要列表时，在 `os.MkdirTemp` 建的空目录里起进程，握手。Agent 没有声明 `sessionCapabilities.delete` 就停下，之后不再探测。声明了就 `session/new`，对当前模型以外的每个模型调一次 `set_config_option`，再 `session/delete`，关进程，删目录。用的是 aibo 数据目录以外的临时目录，因为适配器不知道数据目录；目录用完即删。
  - **学习**：每个会话的 `configure`（`session/new` / `resume` / `load` 的回包）和 `replace`（`set_config_option` 回包、`config_option_update`）都交给 Agent 合并：模型列表按会话看到的为准；当前模型的推理强度按会话看到的为准，其他模型保留之前知道的。模式列表同理。新会话（不是续接）当时的模式记为默认模式。列表有变化才通知（`reflect.DeepEqual` 比较前后）。
  - 探测期间的学习不通知，探测结束后通知一次。列表已经从会话里知道时，`ready()` 不等探测，探测在后台跑，结束后再通知。
  - 探测失败：列表还不知道时，下一次需要列表时重试，并把错误交给调用方（菜单显示原因）；列表已经知道时只记日志。
  - `Configure` 换了可执行文件时清空列表（`forget`），之前还在跑的探测按 `gen` 判断已过时，不再写入。
  - 不能探测、也还没有会话时，`Models` 和 `PermissionModes` 返回新的哨兵错误 `agent.ErrListsUnknown`，外壳翻译成“这个 Agent 要在会话开始后才列出模型和模式……”。不返回空列表，因为空的模式列表会让工作台的 `hasMode` 判定任何模式都不存在。
  - `TellsModels`：已知没有模型配置项（例如只有旧接口 `modes` 的 Agent）时为 false，模型显示成不可点的标签，和原来一样。
- **推理强度保留 Agent 的原文**，包括 `default`；`DefaultEffort` 在列表里有 `default` 时就是 `default`。01 原来把 `default` 报成空，改成原样报告。原因：外壳的推理强度菜单拿会话上报的值和列表里的值比较、打勾；报成空的话，`default` 那一行永远不会被选中，标签也会显示“默认”而菜单里写着 `default`。
- 模式一律 `Caution`、非只读，名称和说明用 Agent 的原文（03 再接配置）。
- 工作台：
  - `agent.ListsChanger`（新接口）：`RegisterAgent` 和 `Open` 时挂上回调。回调先确认这个 Agent 没被换掉，然后丢掉缓存的模型列表、给这个 Agent 的 `ListsVersion` 加一、通知窗口。`replaceAgent` 也加一。
  - `TellsModels` 先看 Agent 是否实现可选的 `TellsModels() bool`。
- 外壳：
  - 模式缓存记下读取时的 `ListsVersion`，版本变了就重新读。新列表到之前先显示旧的；读失败时保留旧的。
  - `words.go` 加了 `ErrListsUnknown`（中英文）。
- 测试：
  - 适配器 `catalog_test.go`（假 Agent 加了 `delete` 能力和 `options-nodelete` 变体，日志改成追加写，探测和会话共用一个文件）：
    - `TestProbeLists`：请求顺序、每个模型的推理强度、只通知一次、不再重复探测；
    - `TestListsLearnedFromSessions`：不能删除时不探测，返回 `ErrListsUnknown`，会话开始后学到列表，换模型学到推理强度，只换当前模式不算列表变化；
    - `TestResumedSessionKeepsDefault`、`TestLegacyAgentTellsNoModels`、`TestProbeFailsThenRetries`。
  - 工作台 `TestListsChanged`：通知后缓存丢掉、版本变化、重新读到新列表；换掉的 Agent 发通知不起作用。
  - 外壳 `TestMenusFollowLearnedLists`：列表未知时模型菜单显示原因；学到之后模式标签显示 Agent 的默认模式，模型菜单列出模型。
  - 契约测试 `TestContractOpenCodeLists`：2026-11-26 在 Windows OpenCode 2.4.2 上通过，10 个模型、`build`/`plan`，探测不到 1 秒，没有“探测会话没删掉”的警告。
  - `TestContractModels` 原来要求第一个模型的 ID 为空，Codex 自 v1 后续 06 起就不满足（每个模型保留自己的 ID），OpenCode 也不满足；改成只要求至少两个模型。三家都通过。
- `docs/acp-agents.md` 的兼容范围表：模型、推理强度、模式一行重写，附件单列，“其他操作”去掉推理强度。

## 已知局限

- **项目级配置**：实测（同日，2.4.2）项目目录的 `opencode.json` 里登记的 primary agent 会出现在模式列表里（`build | plan | reviewer`）。探测在临时目录里看不到它们；在那个工作区开会话后会学到，之后其他工作区的菜单里也会出现，在那里选它会被 OpenCode 拒绝（报错显示给用户）。按工作区分列表需要改 `Models` / `PermissionModes` 的接口，留待以后。
- 模型列表同样按 Agent 而不按工作区。

## 没有验证

- `go test -race`：这台机器没有 gcc。
- 没有在真实界面里看过菜单（只有 MyGO Tester 的界面测试）。
- 设置页“新会话的默认模式”对 ACP Agent 的显示：代码路径和权限模式菜单共用 `modesOf`，没有单独测。
- 不支持 `session/delete` 的真实 Agent：只用假 Agent 测过。
