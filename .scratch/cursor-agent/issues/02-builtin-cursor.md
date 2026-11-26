# 02: 预置 Cursor CLI：参数化模型选择和模式标注

Status: resolved

**Blocked by:** 01

**What to build:** 像 OpenCode 一样预置 Cursor CLI（`cursor-agent acp`），握手时带上 Cursor 的 `parameterizedModelPicker`，让模型菜单是裸 ID 加可读名称、推理强度单独可选；预置 `agent`/`plan`/`ask` 的风险标注。

实测依据：`.scratch/acp-session-settings/research/cursor-config-options.md`，抓取在同目录 `cursor/`。

- [x] `agents.Specs` 加 `Cursor`（Kind `cursor`，命令 `cursor-agent`，参数 `acp`，`MinVersion: "2026.11.22"`，安装页 `https://cursor.com/docs/cli/installation`）。用 `cursor-agent` 不用 `agent`：两个名字安装脚本都会装，`agent` 太泛
- [x] 预置方式照 OpenCode：`defaultCursor()`、可删除和恢复（`RestoreOpenCode` 那套推广到预置的 ACP Agent，或为 Cursor 加一份），设置页的说明文字中英文都要有
- [x] 适配器能接受额外的 `clientCapabilities._meta`（`acp.go` 的 `initialize` 现在发空对象）；只为 Cursor 设 `{"parameterizedModelPicker": true}`。这是 Cursor 私有的扩展，别的 Agent 不发
- [x] 模式标注（同 `openCodeModes`，配置里没有 `modes` 时生效）：`agent` Caution、默认；`plan`、`ask` Safe、只读
- [x] 核对现有逻辑对 Cursor 的结果（实测已知，需要测试固定下来）：
  - 推理强度按 category `thought_level` 找，ID 随模型变（`effort` / `reasoning_effort` / `reasoning`），不能按 ID 记；
  - 没有 `default` 推理强度：`DefaultEffort` 为空，`SetModel(m, "")` 不动推理强度；
  - category `model_config` 的 `context`、`fast` 忽略；
  - 只在值和当前不同时才 `set_config_option`（见下面“全局设置”）。
- [x] 用抓取数据做回放测试（照 OpenCode 的 `settings_test.go`）：把 `param-switch.jsonl`、`param-set.jsonl` 整理进 `internal/agent/acp/testdata/cursor-2026.11.22-settings.jsonl`，确认模型列表、各模型的推理强度、模式列表
- [x] `docs/acp-agents.md` 加 Cursor 一节：
  - **全局设置**：通过 ACP 换模型会写 `~/.cursor/cli-config.json`（`selectedModel`、每个模型的 `modelParameters`），在 aibo 里换模型会改变终端里 Cursor 下次启动的模型，反过来也一样；没选模型时，新会话用 Cursor 上一次的选择。
  - **推理强度**：每个模型记着自己上次的值，换模型不重置；没有“默认”。
  - `context`、`fast` 不在 aibo 里显示，用 Cursor 记住的值。
  - 审批不是模式（`--force`、`--auto-review`、`--sandbox` 是启动参数），aibo 不加这些参数。
- [x] 兼容范围表加 Cursor 一行

## 不做

- `context`、`fast` 的菜单。以后需要时做成通用的“其他模型选项”，不为 Cursor 单独写。
- 工具名前缀：没发过消息，不知道 Cursor 的工具名。留空，04 实测后再定。

## 实现说明

- 预置 ACP Agent 改成一张表（`internal/agents/config.go` 的 `builtinACPs`），原来散在各处的 `c.ID == OpenCode` 都改为查表：
  - 每项是默认配置、内置模式标注（配置里没有 `modes` 时生效）和握手时发的 `_meta`。OpenCode 是 `openCodeModes`、不发 `_meta`；Cursor 是 `cursorModes`、`{"parameterizedModelPicker": true}`。
  - `validate`、`AddACP`、`saveACP`（磁盘上没有条目时的默认值、移除时写 `removed`）、`applyACP`（安装页、图标、登录方式从 `Specs` 取；命令是内置的那个可执行文件或其启动脚本时才检查最低版本，`runsBuiltin` 去掉 `.exe`/`.cmd`/`.ps1` 比较）都按表处理。
  - `RestoreOpenCode` 换成 `RestoreACP(id)`，导出 `BuiltinACP()` 列出可恢复的。设置页对每个已移除的预置 Agent 显示“恢复默认 {name}”（`restoreOpenCode` 文案改为带参数的 `restoreACP`，中英文）。
- `Specs` 加 Cursor：Kind `cursor`，名称 Cursor，命令 `cursor-agent`，`MinVersion: "2026.11.22"`，安装页 `https://cursor.com/docs/cli/installation`。登录方式留给 04。没有图标，和 OpenCode 一样用默认的。
- 检测：命令写成绝对路径和在设置里选的路径走同一条路；Agent 是 Cursor 或路径是 `cursor-agent` 的启动脚本时按 01 的 `cursorChosen` 解析。
- 适配器：`acp.Agent.SetClientMeta`，`launch` 把它交给会话，`handshake` 放进 `clientCapabilities._meta`；探测会话也走 `launch`，同样带上。没设时 `clientCapabilities` 仍是 `{}`。
- 推理强度按 category 查找、没有 `default` 时 `SetModel(m, "")` 不动、`model_config` 忽略、只在值不同时切换：现有逻辑都满足，没有改代码，用回放测试固定。
- 测试：
  - `internal/agent/acp/cursor_test.go`：`TestCursorSettingsCapture` 回放 `testdata/cursor-2026.11.22-settings.jsonl`（研究目录里 `param-switch.jsonl` 和 `param-set.jsonl` 拼起来，路径已改写），确认每一步报告的模型、推理强度、模式，学到的 49 个模型的名称和各自的推理强度（Auto、Composer 没有，都没有默认档），模式列表。`TestClientMeta`：探测和会话的握手都带上 `_meta`，不设时为 `{}`；假 ACP Agent 设了 `AIBO_ACP_INIT` 时记下 `initialize` 请求。
  - `internal/agents/cursor_builtin_test.go`：`TestCursorBuiltin`（预置、ID 不能被添加占用、移除和恢复都能跨重启、恢复非预置 ID 报错）、`TestCursorModeLabels`、`TestCursorDetected`（Windows：常见位置、PATH、命令写成启动脚本的绝对路径三种方式找到，版本过旧报 TooOld）。假 CLI 认名为 `node` 的可执行文件，去掉第一个参数 `index.js` 后照常回答。
  - 原有测试里预置 Agent 的个数加一；外壳测试改用 `RestoreACP("OpenCode")` 的文案。
- 用本机 Cursor 2026.11.22 临时验证过：注册表检测为 Ready，经适配器建会话，得到 49 个带名称的模型，模式按内置标注显示。`session/new` 照例改写了 `cli-config.json`（值不变），已恢复。
- 文档：`docs/acp-agents.md` 加“使用 Cursor CLI”一节（Windows 启动方式、不换上暂存的更新、macOS/Linux 未实测、参数化模型列表、全局设置、推理强度、Context/Fast、模式与审批、不探测），ID 保留、移除和恢复、兼容范围表相应补充。
