# Phase 3：Pi SDK Adapter

状态：macOS 首批垂直链路已实现，Windows 作为后续验证门。

## 本批范围

Aibo 在 Rust Core 中为每个 Pi 会话启动一个 Node SDK host（`src-tauri/pi-sdk-host.mjs`）。host 只负责持有 `AgentSession` 和转发事件，SQLite、generation、会话状态和 `AgentEvent v1` 投影仍由 Rust 管理。

协议是单行 JSONL，并固定为 `aibo-pi-sdk-host.v1`：

- `start`：以工作区路径和 Aibo 管理的 `sessionDir` 创建或打开 `SessionManager`。
- `prompt`：立即返回 accepted，在同一 stdout 流中异步转发 SDK 事件。
- `abort`：调用 `AgentSession.abort()`。
- `dispose`：释放 SDK session 和 host 进程。

Pi SDK 的 `message_start/update/end`、`turn_end`、`agent_start`、`agent_error` 和工具执行事件在 Rust 侧被收敛为 `turn.*`、`message.*`、`tool.*`、`usage.updated`、`adapter.*`，因此前端继续复用 Codex 的时间线和 composer。

## 安全边界

首批只向 SDK 传入 `read`、`grep`、`find`、`ls` 工具。Pi 本身没有 Codex 那样的原生 OS 沙箱，UI 和诊断均显示“只读工具 / 无原生沙箱”；工作区 trust 仍是 Agent 操作前的显式确认，不能把工具白名单误报成系统隔离。

认证不由 Aibo 保存，继续使用 Pi SDK/native agent 的凭据存储。`sessionDir` 放在应用数据目录下，绑定表只保存 Pi session id 与 generation，应用重启后通过 `SessionManager.list/open` 恢复。

## 本机验证

已验证 Node host 可在 macOS 上启动并返回协议版本、Pi session id、持久化 session 文件和只读 capability。完整真实模型 smoke 仍使用项目已有 `pnpm run probe:pi:sdk -- --smoke` 门禁；Windows 需要重新验证 Node 路径、session 路径及进程退出行为。

## 下一批

1. 将 steer/follow-up 映射到统一 composer/队列语义。
2. 显示 Pi session tree、分支和恢复关系。
3. 投影 compaction/retry/extension 状态，并为 SDK host 增加录制 fixture 与崩溃恢复测试。
