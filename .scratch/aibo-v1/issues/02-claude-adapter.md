# 02: 在 aibo 里和 Claude Code 对话

**What to build:** 用户新建一个 Claude Code 会话后，可以像在终端里一样和本机的 `claude` 对话：看到流式回复、工具调用、思考内容、计划和子代理的工作，并且能随时停止。重启 aibo 后，在旧会话里发消息会续接原来的原生会话。

实现 Claude 适配器：每个会话一个常驻的 stream-json 进程，把事件归一化为统一事件流。这一条不含审批（另见“审批卡片与原生选项”），也不含 MCP 注入（另见“真实 Agent 读取引用”）。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（Agent 适配器 · Claude、会话模型与存储）。调研：`.scratch/multi-agent-workbench-v1/research/01-agent-integration.md`、`.scratch/multi-agent-workbench-v1/research/13-probes`。

**Blocked by:** 01（工作台骨架：用假 Agent 跑通一个会话）

**Status:** ready-for-agent

- [ ] 只调用本机未经修改的 `claude`，不读取、不转交 `~/.claude` 里的凭据
- [ ] 流式回复正确显示；思考内容附在对应的回复上
- [ ] 工具调用和结果合成一条消息，默认折叠；输出超过 4 KB 时用只读编辑器显示；单条输出超过约 1 MB 时截断并标记
- [ ] TodoWrite 显示为一条计划消息；子代理的消息嵌套在父工具调用里
- [ ] 点击停止后，当前回复以“已中断”保存
- [ ] 原生会话 ID 记入会话元数据；重启后发首条消息时用 `--resume` 续接
- [ ] 消息归一化有主接缝测试（用录制的事件脚本驱动假 Agent 或适配器的解析层）
- [ ] 契约测试默认不跑，用环境变量开启后调用真实 `claude`，覆盖流式输出、工具调用和续接
