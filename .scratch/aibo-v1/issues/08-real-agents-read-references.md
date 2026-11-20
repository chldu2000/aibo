# 08: 真实 Agent 读取引用

**What to build:** 用户把一个会话引用给 Claude Code 或 Codex 的会话后，真实的 Agent 能看到 aibo 的四个工具，不需要审批就能调用，并按概要里写的工具名去读引用。跨 Agent 的核心场景在这一条里第一次真正跑通：比如在 Claude 里讨论方案，然后引用给 Codex 去实现。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（Agent 适配器、引用概要 · 工具名）。调研：`.scratch/multi-agent-workbench-v1/research/03-mcp-injection.md`、`.scratch/multi-agent-workbench-v1/research/08-codex-thread-tools.md`。

**Blocked by:** 02（在 aibo 里和 Claude Code 对话）、03（在 aibo 里和 Codex 对话）、04（把整个会话推送为引用）

**Status:** resolved

- [x] Claude 用 `--mcp-config` 加 `--strict-mcp-config` 注入，token 通过环境变量传入，`--allowedTools 'mcp__aibo__*'` 免审批
- [x] Codex 用 `config.mcp_servers.aibo` 按 thread 注入，token 放在按 thread 设置的 `http_headers` 里，`default_tools_approval_mode = "approve"` 免审批
- [x] 实测 Codex 侧模型看到的工具名，写进概要的工具名规则，并回填规格的待验证项 1
- [x] 概要里的工具名按接收方 Agent 的写法生成
- [x] 契约测试（环境变量开启）：两家真实 Agent 都能调用 `read_reference` 读到引用内容；Codex 的两个 thread 之间互相读不到对方的引用

## Comments

- 实现说明：
  - Claude：`--mcp-config` 里只有 aibo 一个 server，类型 http；`Authorization` 头写成 `Bearer ${AIBO_MCP_TOKEN}`，token 只放在该进程的环境变量里，不出现在命令行。另加 `--strict-mcp-config` 和 `--allowedTools mcp__aibo__*`。
  - Codex：`thread/start` / `thread/resume` 的 `config.mcp_servers.aibo` 写入 `url`、按 thread 设置的 `http_headers` 和 `default_tools_approval_mode = "approve"`。
  - 读取工具的报错信息也按接收方 Agent 的写法给出工具名。
- 实测（Claude Code 2.1.318、codex-cli 0.169.0）：
  - Codex 的模型看到的工具名是 `mcp__aibo__<tool>`，和 Claude 一样。app-server 的条目里写作 `aibo.<tool>`，但模型看不到。规格的待验证项 1 已回填。
  - Claude 会展开 `--mcp-config` 里的 `${VAR}`。
  - Claude 把 MCP 工具延迟加载，模型要先用 `ToolSearch` 找到 `mcp__aibo__read_reference` 才能调用，所以概要里写明完整工具名是必要的。
- 测试：
  - 单元测试：Claude 的命令行带上了 MCP 配置，且不含 token。
  - 契约测试（新增 `internal/contract`，`AIBO_CONTRACT=1` 时运行，本机已通过）：真实的 Claude 和 Codex 都能通过 MCP 读到假 Agent 会话里的“暗号”，工作台也记下了读取记录；同一个 app-server 里的两个 Codex thread，B 用 A 的引用 ID 读取会报“本会话没有该引用”，A 的引用没有被读取。
