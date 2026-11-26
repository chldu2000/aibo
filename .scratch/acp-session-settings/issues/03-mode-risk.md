# 03: 在 Agent 配置里标注 ACP 模式的风险

Status: ready-for-agent

**What to build:** ACP 的模式只有 ID、名称和说明，没有风险等级和只读标记。aibo 不按名字猜（不同 Agent 的同名模式含义可能不同）。不认识的模式一律当作 Caution、非只读；用户可以在 `agents.json` 的 Agent 配置里为模式标注风险、只读和默认。预置 OpenCode 自带标注。

决定（用户，2026-11-26）：选这个方案，而不是只显示配置里标注过的模式。风险标低了会漏掉 Danger 的二次确认，例如某个 ACP 适配器暴露的 `bypassPermissions`，所以要留出配置的口子。

**Blocked by:** 02

- [ ] `agents.ACPConfig` 加 `modes`，按模式 ID 给 `risk`（`safe` / `caution` / `danger`）、`readOnly`、`default`。例如：

  ```json
  {"id": "my-agent", "command": "...", "modes": {"bypassPermissions": {"risk": "danger"}}}
  ```

  校验：`risk` 只能取三个值，最多一个 `default`；配置里有、Agent 没报告的模式忽略。保存和读取的往返测试放在 `internal/agents/config_test.go`
- [ ] 预置 OpenCode（`defaultOpenCode`）：`plan` 为 Safe、只读；`build` 为 Caution、默认。用户编辑 OpenCode 时保留这份标注
- [ ] 适配器生成 `agent.PermissionMode` 时套用标注；没有标注的为 Caution、非只读。`Default` 优先用配置，其次用 `session/new` 报告的当前值
- [ ] 模式的说明用 Agent 给的原文（ADR 0005，Agent 的原话不翻译）。`build` 这类模式的实际权限由 Agent 自己的配置决定（OpenCode 是 `opencode.json` 的 `permission`），界面上不另加措辞
- [ ] ADR 0003 补一条：ACP Agent 的会话模式也作为权限模式显示；风险和只读来自 Agent 配置，没有标注时为 Caution
- [ ] `docs/acp-agents.md`：说明 `modes` 字段和默认风险；OpenCode 一节说明 `build`、`plan` 出现在权限模式菜单里
- [ ] `GLOSSARY.md` 的“权限模式”条目核对是否需要补充
- [ ] 测试：工作台用假 Agent 确认 Danger 模式切换前要确认；适配器确认标注生效、未标注为 Caution

## 不做

在设置页的添加或编辑表单里编辑模式标注。先只支持 `agents.json`，有需要再加界面。
