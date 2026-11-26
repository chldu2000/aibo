# Windows 上的 OpenCode 2.4.2 ACP 实测

2026-11-26，Windows x64（build 26300.9974），aibo `904caa0`。使用已安装的 `%USERPROFILE%\.opencode\bin\opencode.exe acp`；当前 PowerShell 的 PATH 查不到该命令，绝对路径可用。握手报告 OpenCode 2.4.2、ACP v1。默认模型 `opencode/big-pickle` 实际回答了测试请求。

工作区、OpenCode 配置、缓存和数据均指向临时目录。Python 3.12 探针用后台线程读取 UTF-8 子进程管道，再用队列等待指定响应；原 macOS 探针使用的 `select` 不适用于 Windows 匿名管道。会话引用使用仓库的 [refbench](01-probes/refbench/main.go)：由假 Agent 提供合成消息，实际启动 aibo 工作台、HTTP MCP 和会话令牌。收发 ACP 的是探针，aibo 的 Go ACP 适配器仍待端到端验证。

## 验证结果

下面的表格记录协议探针的观测。后续已在同机用 Go 适配器通过工作台验证 OpenCode 2.4.2，测试从注册表启动真实进程，覆盖跨会话读取、审批与中断、重启后的原生记忆与新 MCP 绑定。[工作台契约测试](../../../internal/contract/opencode_test.go)

最终的工作台契约用时 54.57 秒。源会话由测试 Agent 写入合成消息，接收方为真实 OpenCode。已授权会话的工具输出包含正文中的标记，排除了快照创建后追加的标记；同目录另一会话尝试读取相同引用后，服务端成功读取次数没有增加。工作台重启后分别检查了原生 ID、模型记忆和服务端新增的引用读取记录。中断场景发现过已结束工具仍挂着待处理审批的问题；修复后已验证审批过期，下一轮能返回新指令指定的内容。

| 操作 | 实际观察 |
| --- | --- |
| 握手与对话 | 声明 HTTP MCP、图片、`resume`、`loadSession` 和 `close`，SSE 为 false。新会话返回 `model`、`mode` 配置项，普通对话返回预期文字，以 `end_turn` 结束。图片只检查了能力声明。 |
| 单次允许与拒绝 | 在临时工作区对 `shell` 设置 `ask`。单次允许后，echo 的工具状态为 `completed`、退出码为 0、轮次为 `end_turn`。单次拒绝后，工具为 `failed`、轮次为 `cancelled`；探针在拒绝轮没有发送 `session/cancel`。 |
| 两个中断时机 | 等待审批时发送 `session/cancel` 并答复取消；另一次允许执行回环 ping，三秒后中断。两次工具均为 `failed`、轮次均为 `cancelled`，随后同一原生会话均可继续对话。 |
| 固定范围与双会话 | 在同一目录中为两个会话各启动一个进程，服务名均为 `aibo`，各自使用独立令牌。授权会话收到 aibo 生成的引用概要，调用工具后从正文取到合成标记；工具结果中没有创建引用后追加的标记。另一会话能列出自己的空引用列表，已知同一引用 ID 时，调用自己的读取工具仍得到错误。 |
| 重启续聊 | 在新进程中以原生会话 ID、原工作区和新 MCP 参数调用 `session/resume`。响应前没有收到历史更新；模型能答出上一进程留下的记忆标记，新令牌只看到自己的空列表。再换进程调用 `session/load`，响应前已回放四条用户消息、四条 Agent 消息及工具活动；传回原授权令牌后可再次读取引用。`session/list` 能找到原会话。 |
| 审批期间进程退出 | 只终止探针启动的 OpenCode 进程。客户端读到 stdout EOF，退出码为 1，挂起的 prompt 没有收到响应。新进程可续接同一原生会话、答出退出前一轮保存的标记，空闲时 `session/close` 成功。 |

每条[观测记录](01-probes/windows-2.4.2-observations.jsonl)对应一个实测步骤，保存响应字段、事件顺序或合成标记匹配结果。它们是字段摘录，不能用作逐帧回放夹具。`two-process-other` 的 `denial_in_tool` 检查工具文本是否含预设的拒绝措辞。该字段为 false；本次真正表明读取被拒的是外层 `completed` 返回的嵌套调用 `aibo.read_reference` 的 `status: error` 与 `metadata.error: true`。模型也未得到正文标记。

## 对适配器的影响

- 与 [macOS 1.19.6](opencode-local.md) 一样，每会话独立进程、使用当前会话的 MCP 参数、通过 `session/resume` 重连，是已跑通的组合。本次 Windows 验证覆盖此部署方式；共享进程在 2.4.2 上的行为仍未测。
- 同样的拒绝操作在两次记录里得到不同的轮次结束原因。适配器应分别记录用户的审批决定、工具结果和轮次结束原因。同样，EOF 时由工作台收尾等待中的审批与轮次，不能继续等待 prompt 响应。
- 两次测试的平台与 OpenCode 主版本同时变化，不能据此归因于 Windows。Windows 2.4.2 的测试配置使用 `permissions` 数组，规则为 `{"action":"shell","resource":"*","effect":"ask"}`。[OpenCode 权限文档](https://opencode.ai/docs/permissions/)
