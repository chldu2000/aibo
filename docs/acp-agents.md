# 在 aibo 中使用 OpenCode 和其他本机 ACP Agent

## 使用 OpenCode

安装 OpenCode，并在它自己的终端里确认模型可用。打开 aibo 的 Agent 设置页，检查 OpenCode 的路径和版本。Windows 默认会查找 `%USERPROFILE%\.opencode\bin\opencode.exe` 和 PATH，macOS 也会查找 `~/.opencode/bin`。如果装在别处，在设置页选择可执行文件。新建会话时选择 **OpenCode** 即可。aibo 直接运行 `opencode acp`，主程序使用 Go 实现 ACP 客户端。

要把已有对话交给 OpenCode，从源会话创建会话引用并发送到 OpenCode 会话。aibo 随消息发送摘要，OpenCode 可以通过 MCP 工具读取该引用确定的消息范围。接收方只获得快照的访问权，源工作区目录不会加入它的可读目录列表。

## 登记另一个 ACP 实例

打开 **设置 → Agent → 添加 Agent…**，填写显示名称、稳定的 Agent ID 和可执行文件。启动参数每行填写一个，路径中的空格会保留。若该 Agent 使用自己的 MCP 工具命名方式，可修改工具前缀。保存后 aibo 会检测可执行文件，并将新 Agent 加入新建会话菜单。配置会保存在当前数据目录的 `agents.json` 中，下次启动仍然有效。

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
| `id` | 会话持久化的身份。以小写英文字母开头，后续可用小写字母、数字、下划线和连字符。每套配置需要自己的 ID。`claude`、`codex`、`opencode`、`fake` 已保留。 |
| `name` | 工作台显示名，可以改名。 |
| `command` | 可执行文件的名称或绝对路径。Windows 选择 `.exe`。对于脚本型 Agent，可填写本机运行时的可执行文件，将脚本绝对路径放在 `args` 中。 |
| `args` | 启动参数数组，默认空数组。每项作为一个参数直接传入，其中的空格无需再加引号。 |
| `toolPrefix` | 引用摘要中，Agent 在 MCP 工具名前看到的前缀。默认 `aibo_`。OpenCode 1.19.6 使用 `aibo_read_reference`，2.4.2 的 Code Mode 使用 `aibo.read_reference`。内置 OpenCode 会根据检测到的版本选择。 |

移动或重装可执行文件后，保留原 `id` 并更新路径。aibo 将用原生会话 ID 请求续接，成功还需要 Agent 自己保有相应会话。临时移除登记后，已有时间线仍保存在 aibo 中。重新登记原 `id` 并恢复对应的可执行文件和原生会话数据后即可续聊。请为另一个不同的 Agent 分配新的 `id`。

## 兼容范围

| 操作 | 当前行为 |
| --- | --- |
| 新建与对话 | 每个工作台会话独占一个 stdio 进程，协商 ACP v1。用户登记的可执行文件只在启动会话时进行协议握手。回复、思考、计划和工具结果进入工作台时间线。 |
| 引用 | 工作台会话要求 Agent 声明支持 HTTP MCP。新建和续接都会传入当前工作区和该会话的 MCP 地址、Bearer 令牌。缺少 HTTP 支持时，启动会报告原因。 |
| 审批与停止 | 显示 Agent 给出的选项，用原选项 ID 答复。等待审批时停止，会同时通知 Agent 取消轮次并取消挂起的审批。Agent 提前退出时，工作台结束该轮并保留已收到的内容。 |
| 重启续聊 | 优先使用 `session/resume`。只支持 `session/load` 时，在其响应前跳过历史回放，已有时间线由 aibo 保管。如果 Agent 无法恢复原生会话，工作台进入已有的恢复流程。 |
| 模型与附件 | Agent 提供模型配置项时，可按模型 ID 设置。文件以路径发送，图片仅在对端声明支持时发送。OpenCode 的 `build`、`plan` 是 Agent 角色，工作台不将它们显示为权限模式。 |
| 其他操作 | 通用适配器暂不提供手动压缩、外部目录授权、推理强度或 Agent 自定义斜杠命令。登录、模型供应商和工具权限规则由本机 Agent 管理。 |

## 验证

Windows 上可在 PowerShell 运行以下契约测试。测试使用临时工作区、OpenCode 数据目录和合成消息，调用本机 OpenCode 的可用模型。若 Git Bash 位于非默认目录，可设置 `OPENCODE_GIT_BASH_PATH`。`AIBO_OPENCODE` 可选，用于指定程序的绝对路径。

```powershell
$env:AIBO_CONTRACT = "1"
$env:CGO_ENABLED = "0"
go test ./internal/contract -run '^TestContractOpenCode$' -count=1 -v
```

Windows OpenCode 2.4.2 已用工作台契约验证对话、实际读取引用、同目录双会话隔离、批准、拒绝、等待审批时中断和重启续接。另一个只提供历史回放的测试程序通过 `agents.json` 登记，覆盖 `session/load`、字符串请求 ID 和进程异常退出。该程序用于验证协议差异，其他商用或开源 Agent 仍需各自的实机验收。[Windows 协议记录](../.scratch/agent-extensibility/research/opencode-windows.md) · [macOS OpenCode 1.19.6 协议记录](../.scratch/agent-extensibility/research/opencode-local.md) · [ACP 会话协议](https://agentclientprotocol.com/protocol/v1/session-setup)
