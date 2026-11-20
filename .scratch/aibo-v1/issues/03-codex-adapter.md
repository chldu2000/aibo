# 03: 在 aibo 里和 Codex 对话

**What to build:** 用户新建一个 Codex 会话后，可以和本机的 `codex` 对话：看到流式回复、工具调用（命令、文件修改）、思考内容和计划，并且能随时停止。多个 Codex 会话共用一个 app-server 进程，各自是一个 thread。重启 aibo 后，在旧会话里发消息会续接原来的 thread。

实现 Codex 适配器：一个 `codex app-server` 进程（stdio JSONL）承载多个 thread，Go 类型由 `generate-json-schema` 生成。这一条不含审批和 MCP 注入。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（Agent 适配器 · Codex、会话模型与存储）。调研：`.scratch/multi-agent-workbench-v1/research/01-agent-integration.md`、`.scratch/multi-agent-workbench-v1/research/08-codex-thread-tools.md`、`.scratch/multi-agent-workbench-v1/research/08-probes`。

**Blocked by:** 01（工作台骨架：用假 Agent 跑通一个会话）

**Status:** ready-for-agent

- [ ] 多个 Codex 会话共用一个 app-server 进程，事件按 thread 正确分发到各自的会话
- [ ] 流式回复、思考内容、工具调用（调用和结果合为一条）、plan 都按规范会话模型显示
- [ ] 点击停止后，当前回复以“已中断”保存
- [ ] thread ID 记入会话元数据；重启后发首条消息时用 `thread/resume` 续接
- [ ] app-server 进程意外退出时，受影响的会话显示错误，下次发消息时重新拉起
- [ ] 消息归一化有主接缝测试
- [ ] 契约测试（环境变量开启）调用真实 `codex`，覆盖流式输出、工具调用、多 thread 和续接
