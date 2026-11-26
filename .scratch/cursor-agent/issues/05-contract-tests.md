# 05: Cursor CLI 的契约测试，含一轮真实消息

Status: ready-for-agent

**Blocked by:** 02, 03

**What to build:** 用真实的 Cursor CLI 固定 02、03 依赖的行为，并补上实测时没做的部分：发一轮消息之后的审批请求、工具名、会话恢复。发消息会用用户的 Cursor 额度，用 Auto（`default`）模型，一轮只问一个要用工具的小问题。

**运行前先问用户**：契约测试会改 `~/.cursor/cli-config.json`（见 02 的“全局设置”），测试开始时备份、结束时恢复；会在 Cursor 的历史里留下一个会话（Cursor 不能删除会话）。

- [ ] `internal/contract/cursor_settings_test.go`，在 `AIBO_CONTRACT=1` 下运行，找不到 Cursor 或没登录时跳过：
  - 模型列表是裸 ID，含 `default`；换到一个有推理强度的模型（`AIBO_CURSOR_EFFORT_MODEL`，默认 `claude-opus-5-5`）后能列出、能设置推理强度；
  - 模式：`agent`/`plan`/`ask`，标注符合 02；
  - 轻探测（03）：探测前后 `session/list` 都为空，`selectedModel` 不变。
- [ ] 一轮消息（Auto 模型，`agent` 模式）：让 Cursor 读一个文件、写一个文件，记录：
  - `session/request_permission` 的选项（文档说 `allow-once`、`allow-always`、`reject-once`），aibo 的审批界面是否正常；
  - 工具调用的名称和种类，据此决定 02 留空的工具名前缀；
  - 结束原因和用量字段。
- [ ] 重启进程后 `session/load` 这个会话：能否恢复，模型、推理强度、模式是否保留，是否重放历史
- [ ] 抓取数据（改写路径，去掉邮箱等账号信息）存进 `internal/agent/acp/testdata/`，结论补进 `.scratch/acp-session-settings/research/cursor-config-options.md` 和 `docs/acp-agents.md`
- [ ] 如果审批或恢复的行为和 aibo 现有处理不符，另开 issue

## 不做

`--force`、`--auto-review`、`--sandbox` 等启动参数的测试。aibo 不加这些参数。
