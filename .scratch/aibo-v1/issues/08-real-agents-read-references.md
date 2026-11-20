# 08: 真实 Agent 读取引用

**What to build:** 用户把一个会话引用给 Claude Code 或 Codex 的会话后，真实的 Agent 能看到 aibo 的四个工具，不需要审批就能调用，并按概要里写的工具名去读引用。跨 Agent 的核心场景在这一条里第一次真正跑通：比如在 Claude 里讨论方案，然后引用给 Codex 去实现。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（Agent 适配器、引用概要 · 工具名）。调研：`.scratch/multi-agent-workbench-v1/research/03-mcp-injection.md`、`.scratch/multi-agent-workbench-v1/research/08-codex-thread-tools.md`。

**Blocked by:** 02（在 aibo 里和 Claude Code 对话）、03（在 aibo 里和 Codex 对话）、04（把整个会话推送为引用）

**Status:** ready-for-agent

- [ ] Claude 用 `--mcp-config` 加 `--strict-mcp-config` 注入，token 通过环境变量传入，`--allowedTools 'mcp__aibo__*'` 免审批
- [ ] Codex 用 `config.mcp_servers.aibo` 按 thread 注入，token 放在按 thread 设置的 `http_headers` 里，`default_tools_approval_mode = "approve"` 免审批
- [ ] 实测 Codex 侧模型看到的工具名，写进概要的工具名规则，并回填规格的待验证项 1
- [ ] 概要里的工具名按接收方 Agent 的写法生成
- [ ] 契约测试（环境变量开启）：两家真实 Agent 都能调用 `read_reference` 读到引用内容；Codex 的两个 thread 之间互相读不到对方的引用
