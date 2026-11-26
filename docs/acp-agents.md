# 在 aibo 中使用 OpenCode、Cursor CLI 和其他本机 ACP Agent

## 使用 OpenCode

安装 OpenCode，并在它自己的终端里确认模型可用。打开 aibo 的 Agent 设置页，检查 OpenCode 的路径和版本。Windows 默认会查找 `%USERPROFILE%\.opencode\bin\opencode.exe` 和 PATH，macOS 也会查找 `~/.opencode/bin`。如果装在别处，点击 OpenCode 卡片上的 **编辑…** 选择可执行文件。新建会话时选择 **OpenCode** 即可。默认启动命令为 `opencode acp`。

要把已有对话交给 OpenCode，从源会话创建会话引用并发送到 OpenCode 会话。aibo 随消息发送摘要，OpenCode 可以通过 MCP 工具读取该引用确定的消息范围。接收方只获得快照的访问权，源工作区目录不会加入它的可读目录列表。

## 使用 Cursor CLI

按 [Cursor 的说明](https://cursor.com/docs/cli/installation) 安装 Cursor CLI，在终端里运行 `cursor-agent login` 登录。Agent 设置页用 `cursor-agent status --format json` 检查是否已登录（不显示账号），未登录时给出在终端里登录的按钮；登录后点 **重新检测**。会话启动时 Cursor 报告未登录（ACP 的 `-32000`）时，消息不会发出，留在输入框里，设置页随之显示未登录。aibo 预置了 **Cursor**，启动命令为 `cursor-agent acp`（安装脚本同时装了 `agent`，aibo 不找这个太常见的名字）。要求 2026.11.22 或更新的版本。

- **Windows**：安装脚本只装启动脚本（`%LOCALAPPDATA%\cursor-agent\cursor-agent.cmd` 和 `.ps1`），由它经 PowerShell 运行 `versions\<最新版本>\node.exe index.js`。aibo 在 `%LOCALAPPDATA%\cursor-agent` 和 PATH 里找到这个安装后，直接运行最新版本目录里的 `node.exe` 和 `index.js`，这样结束会话时 Cursor 的进程也会结束。在 **编辑…** 里把命令改成别处的 `cursor-agent.cmd` 或某个版本目录里的 `node.exe` 也可以。启动脚本会先把下载好的更新换上来，aibo 不做这一步：更新在下次从终端运行 Cursor 时生效。
- **macOS / Linux**：安装脚本放的是 `~/.local/bin/cursor-agent`，按普通可执行文件查找。尚未实测。

模型、推理强度和模式：

- aibo 握手时请求 Cursor 的参数化模型列表（`clientCapabilities._meta.parameterizedModelPicker`），模型菜单是 Cursor 的模型 ID 和名称，**Auto** 是 `default`。推理强度是当前模型的单独一项，名称和取值随模型变（`effort`、`reasoning_effort` 或 `reasoning`），Auto 和部分模型没有。Cursor 的推理强度没有“默认”一档；每个模型记着自己上次用的推理强度，换模型不重置。
- **在 aibo 里换模型会改 Cursor 自己的设置。** Cursor 把通过 ACP 选的模型和各模型的参数写进 `~/.cursor/cli-config.json`，终端里的 Cursor 下次启动就用这个模型，反过来也一样。aibo 只在选择和当前不同时才切换。新会话没有指定模型时，用的是 Cursor 上一次的选择。
- Cursor 的 **Context**、**Fast** 选项不在 aibo 里显示，用 Cursor 记住的值。
- 模式是 `agent`、`plan`、`ask`。没有在 `agents.json` 里标注时，`agent` 按“注意”显示并作为默认，`plan`、`ask` 按安全、只读显示。工具审批由 Cursor 自己的配置决定；aibo 不加 `--force`、`--auto-review`、`--sandbox` 这些启动参数。
- Cursor 不能删除会话，但没发过消息的会话在进程结束后就不在它的会话列表里了。aibo 第一次需要列表时，在空的临时目录里用 Cursor 建一个探测会话，只读出模型和模式列表，不切换模型（每次切换都会写进 Cursor 的设置），也不发消息。所以菜单一开始只知道 Cursor 当前模型的推理强度，其他模型的推理强度在会话切到它们之后补上。探测要 10–30 秒。

## 登记另一个 ACP 实例

打开 **设置 → Agent → 添加 Agent…**，填写显示名称、稳定的 Agent ID 和可执行文件。启动参数每行填写一个，路径中的空格会保留。若该 Agent 使用自己的 MCP 工具命名方式，可修改工具前缀。保存后 aibo 会检测可执行文件，并将新 Agent 加入新建会话菜单。配置会保存在当前数据目录的 `agents.json` 中，下次启动仍然有效。

### 修改和移除

在 **设置 → Agent** 中，点击 OpenCode 或自定义 Agent 卡片上的 **编辑…**，即可修改显示名称、可执行文件、启动参数和 MCP 工具前缀。参数每行一个，例如 `--config` 与含空格的配置路径应分别占一行，路径无需加引号。Agent ID 固定，旧会话仍指向同一实例。保存后，新会话和已有会话的下一轮使用新配置，正在进行的轮次可以完成。

点击卡片上的 **移除…** 并确认后，该 Agent 会从新建会话菜单移除。历史消息仍可查看。要继续使用原会话，可用相同 ID 重新添加 Agent，或点击 **恢复默认 OpenCode**（**恢复默认 Cursor**）。恢复后的 OpenCode 使用默认命令 `opencode` 和启动参数 `acp`，Cursor 使用 `cursor-agent` 和 `acp`。续聊还需要 Agent 保有对应的原生会话数据。

### 手动编辑配置文件

在 **aibo 当前数据目录** 中创建 UTF-8 编码的 `agents.json`，然后重启 aibo。默认目录在 Windows 上是 `%LOCALAPPDATA%\aibo`，在 macOS 上是 `~/Library/Application Support/aibo`。如果更改过数据目录或设置了 `AIBO_DATA_DIR`，使用更改后的目录。

下面的配置用已安装的 OpenCode 增加一个名为 **OpenCode Lab** 的实例。也可以换成其他本机 ACP 程序的命令和参数。

```json
[
  {
    "id": "opencode-lab",
    "name": "OpenCode Lab",
    "command": "opencode",
    "args": ["acp"],
    "toolPrefix": "aibo."
  }
]
```

| 字段 | 含义 |
| --- | --- |
| `id` | 会话持久化的身份。以小写英文字母开头，后续可用小写字母、数字、下划线和连字符。每套配置需要自己的 ID。`claude`、`codex`、`fake` 已保留，`opencode`、`cursor` 专用于修改预置的 OpenCode 和 Cursor 实例。 |
| `name` | 工作台显示名，可以改名。 |
| `command` | 可执行文件的名称或绝对路径。Windows 选择 `.exe`。对于脚本型 Agent，可填写本机运行时的可执行文件，将脚本绝对路径放在 `args` 中。 |
| `args` | 启动参数数组，默认空数组。每项作为一个参数直接传入，其中的空格无需再加引号。 |
| `toolPrefix` | 引用摘要中，Agent 在 MCP 工具名前看到的前缀。默认 `aibo_`。OpenCode 1.19.6 使用 `aibo_read_reference`，2.4.2 的 Code Mode 使用 `aibo.read_reference`。内置 OpenCode 会根据检测到的版本选择。 |
| `modes` | 可选。按模式 ID 标注 ACP 不报告的信息：`risk` 为 `safe`、`caution` 或 `danger`（省略即 `caution`，对应界面上的安全、注意、危险），`readOnly` 表示该模式不改文件，`default` 表示新会话的默认模式（最多一个）。没有标注的模式按“注意”、非只读显示，切换前不会再确认，所以 Agent 有不经询问就执行操作的模式时，请标为 `danger`。例如 `"modes": {"bypassPermissions": {"risk": "danger"}}`。设置页编辑 Agent 时保留这一项，但不提供编辑界面。 |

文件中没有 `opencode`（`cursor`）条目时，aibo 加载预置的 OpenCode（Cursor）。在设置页移除它会保存 `{"id":"opencode","removed":true}`（`cursor` 同理），重启后仍然生效。移除自定义 Agent 则直接删去对应条目。请为不同的 Agent 分配不同的 `id`。

## 兼容范围

| 操作 | 当前行为 |
| --- | --- |
| 新建与对话 | 每个工作台会话独占一个 stdio 进程，协商 ACP v1。用户登记的可执行文件在启动会话和读取模型、模式列表（见下）时进行协议握手。回复、思考、计划和工具结果进入工作台时间线。 |
| 引用 | 工作台会话要求 Agent 声明支持 HTTP MCP。新建和续接都会传入当前工作区和该会话的 MCP 地址、Bearer 令牌。缺少 HTTP 支持时，启动会报告原因。 |
| 审批与停止 | 显示 Agent 给出的选项，用原选项 ID 答复。等待审批时停止，会同时通知 Agent 取消轮次并取消挂起的审批。Agent 提前退出时，工作台结束该轮并保留已收到的内容。 |
| 重启续聊 | 优先使用 `session/resume`。只支持 `session/load` 时，在其响应前跳过历史回放，已有时间线由 aibo 保管。如果 Agent 无法恢复原生会话，工作台进入已有的恢复流程。 |
| 模型、推理强度与模式 | 按 ACP 的 `configOptions` 读取和切换：category 为 `model`、`thought_level`、`mode` 的配置项分别对应输入框底部的模型、推理强度和权限模式菜单，名称和取值沿用 Agent 的原文（例如 OpenCode 的 `default`）。只提供旧接口 `modes` 的 Agent 用 `session/set_mode` 切换模式。列表要在会话里才能拿到：Agent 声明支持 `session/delete` 时，aibo 第一次需要列表时在空的临时目录里建一个探测会话，逐个模型读出推理强度，然后删除它；不支持删除的 Agent 不探测，先用它新建一个会话后菜单才有内容（预置 Cursor 例外，见上）。之后每个会话看到的列表也会更新菜单。模式的风险等级来自 `modes` 字段（见上），没有标注的按“注意”显示。OpenCode 的 `build`、`plan` 是 Agent 角色，实际权限由 `opencode.json` 决定；预置 OpenCode 在自己的配置没有 `modes` 时，把 `plan` 标为安全、只读，`build` 标为注意、默认。写了 `modes` 就只用写出的标注。预置 Cursor 同样有内置标注，并请求参数化的模型列表（见“使用 Cursor CLI”）。 |
| 附件 | 文件以路径发送，图片仅在对端声明支持时发送。 |
| 登录 | 登录、模型供应商和工具权限规则由本机 Agent 管理。任何 ACP Agent 在启动会话或一轮对话中返回 `-32000`（ACP 的 `auth_required`）时，aibo 按未登录处理：提示先登录，消息不发出。只有预置 Cursor 能事先检查登录状态。 |
| 其他操作 | 通用适配器暂不提供手动压缩、外部目录授权或 Agent 自定义斜杠命令。 |

## 验证

Windows 上可在 PowerShell 运行以下契约测试。测试使用临时工作区、OpenCode 数据目录和合成消息，调用本机 OpenCode 的可用模型。若 Git Bash 位于非默认目录，可设置 `OPENCODE_GIT_BASH_PATH`。`AIBO_OPENCODE` 可选，用于指定程序的绝对路径。

```powershell
$env:AIBO_CONTRACT = "1"
$env:CGO_ENABLED = "0"
go test ./internal/contract -run '^TestContractOpenCode$' -count=1 -v
```

`TestContractOpenCodeSettings` 不发消息，只切换模型、推理强度和模式，再在新进程里续接，检查设置是否保留。默认使用 OpenCode 2.4.2 的免费模型 `opencode/deepseek-v4.1-flash-free`，它支持 `low` 和 `high`。可用 `AIBO_OPENCODE_EFFORT_MODEL` 指定其他模型。

Windows OpenCode 2.4.2 已用工作台契约验证对话、实际读取引用、同目录双会话隔离、批准、拒绝、等待审批时中断和重启续接。另一个只提供历史回放的测试程序通过 `agents.json` 登记，覆盖 `session/load`、字符串请求 ID 和进程异常退出。该程序用于验证协议差异，其他商用或开源 Agent 仍需各自的实机验收。[Windows 协议记录](../.scratch/agent-extensibility/research/opencode-windows.md) · [macOS OpenCode 1.19.6 协议记录](../.scratch/agent-extensibility/research/opencode-local.md) · [ACP 会话协议](https://agentclientprotocol.com/protocol/v1/session-setup)
