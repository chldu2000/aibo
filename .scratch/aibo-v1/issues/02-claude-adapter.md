# 02: 在 aibo 里和 Claude Code 对话

**What to build:** 用户新建一个 Claude Code 会话后，可以像在终端里一样和本机的 `claude` 对话：看到流式回复、工具调用、思考内容、计划和子代理的工作，并且能随时停止。重启 aibo 后，在旧会话里发消息会续接原来的原生会话。

实现 Claude 适配器：每个会话一个常驻的 stream-json 进程，把事件归一化为统一事件流。这一条不含审批（另见“审批卡片与原生选项”），也不含 MCP 注入（另见“真实 Agent 读取引用”）。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（Agent 适配器 · Claude、会话模型与存储）。调研：`.scratch/multi-agent-workbench-v1/research/01-agent-integration.md`、`.scratch/multi-agent-workbench-v1/research/13-probes`。

**Blocked by:** 01（工作台骨架：用假 Agent 跑通一个会话）

**Status:** resolved

- [x] 只调用本机未经修改的 `claude`，不读取、不转交 `~/.claude` 里的凭据
- [x] 流式回复正确显示；思考内容附在对应的回复上
- [x] 工具调用和结果合成一条消息，默认折叠；输出超过 4 KB 时用只读编辑器显示；单条输出超过约 1 MB 时截断并标记
- [x] TodoWrite 显示为一条计划消息；子代理的消息嵌套在父工具调用里
- [x] 点击停止后，当前回复以“已中断”保存
- [x] 原生会话 ID 记入会话元数据；重启后发首条消息时用 `--resume` 续接
- [x] 消息归一化有主接缝测试（用录制的事件脚本驱动假 Agent 或适配器的解析层）
- [x] 契约测试默认不跑，用环境变量开启后调用真实 `claude`，覆盖流式输出、工具调用和续接

## Comments

- 实现说明：
  - 进程参数：`claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --forward-subagent-text [--model] [--resume]`。启动后先发 control `initialize`；中断用 control `interrupt`。
  - 统一事件新增思考增量、工具开始/结束、计划，以及表示子代理归属的 `Parent`。消息模型新增 `Tool`、`Plan`、`Children`（子代理的消息，没有序号）；存储新增 `detail` 列（数据库结构版本 3）。工具输出超过 1 MB 时截断并标记。
  - 回复的切分：同一个 API 消息里，两次工具调用之间的文本和思考算一条回复。会话自己的回复靠 `stream_event` 流式显示，子代理的消息只会整条到达。
  - 中断时，Claude 会先发一条完整的部分回复，再发 “[Request interrupted by user]”，然后才是 `content_block_stop`。所以解析器等到 block 结束才把回复标为完成；如果先看到中断提示，就保留“已中断”。轮次结束时还没拿到结果的工具调用，也标为“已中断”。
  - 读取工具和搜索里，工具调用写成“工具、参数（约 300 字）、结果”，子代理的步骤列在下面；计划写成清单。
  - 界面：思考折叠在回复上方；工具调用折叠成一行（工具名 · 主要参数 · 状态），展开后显示参数、子代理步骤和结果，结果超过 4 KB 时用只读编辑器显示；计划显示为勾选清单。Claude 图标是自绘的 SVG。
  - `main` 里先用 PATH 和几个固定位置找 `claude`，正式的发现逻辑见任务 15；只有设置 `AIBO_DEMO=1` 时才加入假 Agent。
- 实测（Claude Code 2.1.318）：
  - `--resume` 后原生会话 ID 不变。
  - haiku 的思考块只有签名、没有正文，所以思考内容只在有正文时显示。
  - `-p` 模式下没有 TodoWrite 和 Glob，计划识别只在出现 TodoWrite 时生效。子代理工具叫 `Agent`。
  - 被中断的轮次，`result` 是 `error_during_execution` + `terminal_reason: aborted_streaming`，按中断处理，不算出错。
- 暂不包含：审批（任务 10），在那之前，需要审批的工具会被拒绝；MCP 注入（任务 08）。
- 测试：
  - 解析器测试：录制的真实输出放在 `testdata/`，已去掉本机的工具、插件和命令清单，经回放 Agent 进入真实工作台核心。
  - 契约测试：`AIBO_CONTRACT=1` 时运行，覆盖工具调用加续接、中断后继续，已在本机通过。
