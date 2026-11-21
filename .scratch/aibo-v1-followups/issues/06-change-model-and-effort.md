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

**Status:** ready-for-agent

- [ ] 把实测结论回填规格；`06-probes/` 的抓取数据整理进适配器的 `testdata/`，加契约测试（`AIBO_CONTRACT=1`）：换模型、换推理强度、续接后的值
- [ ] `agent.Model` 增加支持的推理强度（可为空，表示不支持）；`agent.StartOptions` 增加推理强度
- [ ] `agent.Session` 增加换模型和推理强度的方法，以及上报实际值的事件；适配器（Claude、Codex、假 Agent）实现
- [ ] 会话表加推理强度一列（追加迁移，跑 `OpenVersion` 升级前备份测试）
- [ ] 工作台 `SetModel(sessionID, model, effort)`：空闲时改，持久化，交给原生会话；运行中返回 `workbench.ErrTurnRunning`。用假 Agent 测：空闲时换、运行中被拒、换后下一轮带上新选项、重启续接后仍是新选项、Agent 上报的实际值写回会话
- [ ] 输入框底部：模型和推理强度各是一个下拉菜单，模型不支持推理强度时不显示后者；换了模型后，原来的推理强度如果新模型不支持，就换成新模型的默认档
- [ ] 会话详情显示模型和推理强度
- [ ] 界面文字进 `locales/`（中英文）
