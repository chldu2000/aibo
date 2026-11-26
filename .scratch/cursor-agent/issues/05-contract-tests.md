# 05: Cursor CLI 的契约测试，含一轮真实消息

Status: resolved

**Blocked by:** 02, 03

**What to build:** 用真实的 Cursor CLI 固定 02、03 依赖的行为，并补上实测时没做的部分：发一轮消息之后的审批请求、工具名、会话恢复。发消息会用用户的 Cursor 额度，用 Auto（`default`）模型，一轮只问一个要用工具的小问题。

**运行前先问用户**：契约测试会改 `~/.cursor/cli-config.json`（见 02 的“全局设置”），测试开始时备份、结束时恢复；会在 Cursor 的历史里留下一个会话（Cursor 不能删除会话）。

- [x] `internal/contract/cursor_settings_test.go`，在 `AIBO_CONTRACT=1` 下运行，找不到 Cursor 或没登录时跳过：
  - 模型列表是裸 ID，含 `default`；换到一个有推理强度的模型（`AIBO_CURSOR_EFFORT_MODEL`，默认 `claude-opus-5-5`）后能列出、能设置推理强度；
  - 模式：`agent`/`plan`/`ask`，标注符合 02；
  - 轻探测（03）：探测前后 `session/list` 都为空，`selectedModel` 不变。
- [x] 一轮消息（Auto 模型，`agent` 模式）：让 Cursor 读一个文件、写一个文件，记录：
  - `session/request_permission` 的选项（文档说 `allow-once`、`allow-always`、`reject-once`），aibo 的审批界面是否正常；
  - 工具调用的名称和种类，据此决定 02 留空的工具名前缀；
  - 结束原因和用量字段。
- [x] 重启进程后 `session/load` 这个会话：能否恢复，模型、推理强度、模式是否保留，是否重放历史
- [x] 抓取数据（改写路径，去掉邮箱等账号信息）存进 `internal/agent/acp/testdata/`，结论补进 `.scratch/acp-session-settings/research/cursor-config-options.md` 和 `docs/acp-agents.md`
- [x] 如果审批或恢复的行为和 aibo 现有处理不符，另开 issue

## 不做

`--force`、`--auto-review`、`--sandbox` 等启动参数的测试。aibo 不加这些参数。

## 实现说明

- 没有备份和恢复 `cli-config.json`，改为隔离：契约测试把 `CURSOR_CONFIG_DIR` 设成临时目录。实测这样登录状态不变（凭据不在配置目录），模型选择写进临时目录；测试结束时检查用户自己的 `~/.cursor/cli-config.json`（或原来的 `CURSOR_CONFIG_DIR`）一个字节都没变。
- `internal/contract/cursor_test.go`：
  - `cursor(t)`：`AIBO_CONTRACT=1` 才跑；未安装、未登录时跳过，其他不可用时失败。
  - `TestContractCursorSettings`（不发消息）：探测出的模型是裸 ID（没有 `[`，即请求了参数化列表）、含 `default` 和 `AIBO_CURSOR_EFFORT_MODEL`（默认 `claude-opus-5-5`）；模式按内置标注；探测目录（`aibo-acp-probe-*`）在新进程的 `session/list` 里没有会话；以 `high`、`plan` 启动，换成 `low`、`agent`，再换到 Auto 后推理强度为空；学到的推理强度没有默认档。
  - `TestContractCursor`（发消息，Auto）：经工作台读 `note.txt`、读引用（提示里不点工具名，只靠 aibo 的摘要），批准 `echo AIBO-ALLOW`（选项 `allow_once`/`allow_always`/`reject_once`），拒绝 `echo AIBO-DENY`，重启工作台后经 `session/load` 续聊，原生会话 ID 不变、记得文件内容。
  - 2026-11-26 在 Windows Cursor CLI 2026.11.22 上两个都通过（设置 109 秒，消息 109–131 秒）。之前各有一次 `session/new` 超过 45 秒而失败，重跑通过，另开 06。
- 结论：
  - 审批：选项和 ACP 一致，aibo 现有的映射直接可用。只有不在 Cursor 允许列表里的 shell 命令要审批；读文件、搜索、MCP 工具不问。
  - **修了一处显示**：审批请求里没有 `rawInput`，命令只在标题里，带反引号；`updates.go` 在标题整个包在一对反引号里时去掉它们，审批显示 `echo AIBO-ALLOW`。
  - 工具名前缀：Cursor 调 aibo 的 MCP 工具时标题是 `aibo: read_reference`；摘要里写的 `aibo_read_reference`（默认前缀）它能对上，**保持默认 `aibo_`**，不需要改。
  - 恢复：`session/load` 先重放历史，回包有设置、没有 `sessionId`；aibo 现有的 load 处理可用（跳过重放、保留 ID）。
  - 网络失败时 Cursor 把错误当回复文字、`end_turn` 结束，aibo 照原样显示，Cursor 的行为，不改。
- 抓取：`internal/agent/acp/testdata/cursor-2026.11.22-turns.jsonl`（路径改写成 `C:/tmp/cursor-ws`，没有账号信息），`TestCursorTurnCapture` 回放命令那一轮：审批的命令、动作、三个选项及其 ID、工具输出、回复、正常结束。探针源码同步到 `.scratch/acp-session-settings/research/cursor/probe.go.txt`（加了 `prompt:` 和自动批准），结论补进研究笔记的“补充实测：一轮真实消息”。
- 文档：`docs/acp-agents.md` 的 Cursor 一节加审批、MCP 前缀、网络错误和启动慢；“验证”一节加 Cursor 契约测试的运行方式，写明会用额度、不改用户设置。
