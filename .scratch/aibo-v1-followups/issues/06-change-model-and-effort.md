# 06: 会话空闲时更换模型和推理强度

**What to build:** 会话没有轮次在运行时，用户可以在输入框底部换模型、换推理强度（reasoning effort），从下一轮开始生效。会话运行中这两个控件灰显，提示“等这一轮结束后再换”。换过的模型和推理强度存进会话，重启 aibo、续接原生会话后仍然有效。输入框底部和会话详情显示的是 Agent 实际在用的模型和推理强度。

现状：
- 输入框底部的模型只显示、不可改（`internal/shell/view.go`，“模型（新建会话时选择）”）。
- 模型只在 `StartOptions.Model` 里给一次（Claude 是 `--model`，Codex 是 `thread/start` 的 `model`），没有推理强度。
- `agent.Model` 只有 ID、名称和说明，不知道每个模型支持哪些推理强度。

实测结论见 [06 实测](../research/06-model-and-effort.md)：两家都能热切换，不需要重启原生会话。
- Claude：`set_model` 和 `apply_flag_settings {effortLevel}` 两个控制请求；用 `get_settings` 的 `applied` 读出实际值。续接不保留推理强度，要重新传 `--effort`。
- Codex：在 `turn/start` 里带 `model`、`effort`，之后的轮次一直沿用，续接后也保留；实际值来自 `thread/start`/`thread/resume` 的回包和 `thread/settings/updated`。
- “默认”以 Agent 回报的实际值为准，不取模型列表里的默认档（Codex 的用户配置会覆盖它）。

**Blocked by:** 05（新建会话不再选模型），两者改同一块界面

**Status:** resolved

- [x] 把实测结论回填规格；`06-probes/` 的抓取数据整理进适配器的 `testdata/`，加契约测试（`AIBO_CONTRACT=1`）：换模型、换推理强度、续接后的值
- [x] `agent.Model` 增加支持的推理强度（可为空，表示不支持）；`agent.StartOptions` 增加推理强度
- [x] `agent.Session` 增加换模型和推理强度的方法，以及上报实际值的事件；适配器（Claude、Codex、假 Agent）实现
- [x] 会话表加推理强度一列（追加迁移，跑 `OpenVersion` 升级前备份测试）
- [x] 工作台 `SetModel(sessionID, model, effort)`：空闲时改，持久化，交给原生会话；运行中返回 `workbench.ErrTurnRunning`。用假 Agent 测：空闲时换、运行中被拒、换后下一轮带上新选项、重启续接后仍是新选项、Agent 上报的实际值写回会话
- [x] 输入框底部：模型和推理强度各是一个下拉菜单，模型不支持推理强度时不显示后者；换了模型后，原来的推理强度如果新模型不支持，就换成新模型的默认档
- [x] 会话详情显示模型和推理强度
- [ ] 界面文字进 `locales/`（中英文）：没做，仓库里还没有语言目录，留给 03 统一迁移

## 实现说明

- `agent`：
  - `Model` 加了 `Resolved`（实际运行的模型 ID，Claude 的 `resolvedModel`）、`Efforts`、`DefaultEffort`，以及 `Runs(id)`，用来把 Agent 报的 ID 对回列表里的模型。
  - `StartOptions` 加了 `Effort`；`Session` 加了 `SetModel(ctx, model, effort)`，只在两轮之间调用。
  - 新事件 `SettingsReported{Model, Effort}`：Agent 实际在用的值。
- Claude 适配器：
  - 启动和续接时带 `--effort`。
  - `initialize` 回应后马上发 `get_settings`，读出启动时实际在用的值。
  - `SetModel` 依次发 `set_model`（空即 `"default"`）、`apply_flag_settings {effortLevel}`（空即 `null`，回到默认）、`get_settings`。
  - 解析器只认请求 ID 以 `settings-` 开头的 `control_response`，从 `applied` 里读出 `SettingsReported`。
  - `Models` 读 `resolvedModel`、`supportsEffort`、`supportedEffortLevels`。
- Codex 适配器：
  - `StartOptions.Effort` 和 `SetModel` 的值记在会话里，随下一次 `turn/start` 发出（由新的 `turnParams` 组装）。Codex 之后的轮次和续接都会沿用。
  - `thread/start`、`thread/resume` 回包里的 `model`、`reasoningEffort`，以及 `thread/settings/updated`，转成 `SettingsReported`。
  - `Models` 不再把默认模型写成空 ID：空 ID 没法在 `turn/start` 里再要回来。每个模型保留自己的 ID，默认的排第一。新会话的 `Model` 仍为空，即按 Codex 自己的配置。
- 假 Agent：`SetModel` 改的是之后轮次看到的选项，并记进 `ModelSets()`；启动和换模型后都上报 `SettingsReported`，没给模型时报 `fake.DefaultModel`。
- 存储：追加迁移，给会话表加 `reasoning_effort` 列；`Store.SetModel` 同时写模型和推理强度。
- 工作台：
  - `SetModel` 新放在 `models.go`（`workbench.go` 接近 800 行）。运行中返回 `ErrTurnRunning`。没连着原生会话时，清掉上次上报的值，下次启动时带上新选项。
  - `Status.Model`、`Status.Effort` 是 Agent 最后一次上报的值。`SettingsReported` 不清除“正在重试”的提示。
- 界面（`internal/shell/modelctl.go`）：
  - 输入框底部的模型和推理强度各是一个菜单，样式和审批档位一样；运行中灰显，悬停提示“等这一轮结束后再换”。
  - 显示的值：选过就用选的，否则用 Agent 上报的（对回列表里的名字，多个模型都对得上时优先具体模型，而不是“默认”），都没有就显示“默认模型”。模型列表每个 Agent 只在第一次用到时读一次。
  - 模型不支持推理强度，或者列表还没读到时，不显示推理强度菜单。
  - 换模型时，原来的推理强度新模型不支持，就换成新模型的默认档（Claude 没有给默认档，就清空，回到 Claude 自己的默认）。
  - 会话详情把“Agent”和“模型”分成两行，模型一行写上推理强度。
- 测试：
  - 工作台 `TestSetModel`（假 Agent）：空闲时换、运行中被拒、下一轮带上新选项、重启续接后仍有效、上报的值写进 `Status`、断开时换。
  - 适配器：`TestSettingsReported`、`TestModelsOfInitialize`、`TestArgsEffort`（Claude），`TestModelsOfModelList`、`TestSettingsReported`、`TestTurnCarriesModelAndEffort`（Codex），数据来自 `testdata/` 里的真实抓取。
  - 界面 `TestChangeModelAndEffort`：运行中菜单打不开，换模型、换推理强度，不支持的档位换成默认档，会话详情显示。
  - 契约测试 `TestContractModelAndEffort`（两家，`AIBO_CONTRACT=1`）：2026-11-22 在 Claude Code 2.1.318、codex-cli 0.169.0 上通过。Claude 在 haiku/low 上启动，换成 sonnet/high 后没有新开原生会话，续接后仍是 sonnet/high。Codex 换成模型列表里的第二个模型和一个非默认档位后生效，续接后仍有效。
- 补充实测（`set_model "default"`、`effortLevel: null`、`resolvedModel`）记在 [06 实测](../research/06-model-and-effort.md) 的补充一节；规格的第 4 条用户故事、适配器接口、事件、输入框、范围外、待验证项 7 已回填。

## 没有验证

- 没有在真机界面上点过这两个菜单，只用了界面测试和契约测试。
- Codex 没法回到“按 Codex 自己的配置”：列表里每一项都是具体模型。用户的 `config.toml` 指定了别的模型时，选过一次就回不去了，只能再选那个模型。
- Claude 的模型列表要起一个 `claude` 进程才能读到，第一次打开 Claude 会话时读一次。
- 其他契约测试这次没有重跑；`get_settings` 加在了每个 Claude 会话的启动路径上，只有新的契约测试覆盖到。
