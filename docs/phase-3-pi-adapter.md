# Phase 3：Pi SDK Adapter

状态：macOS Phase 3 门禁已完成，Windows 作为后续兼容性验证门。

## 本批范围

Aibo 在 Rust Core 中为每个 Pi 会话启动一个 Node SDK host（`src-tauri/pi-sdk-host.mjs`）。host 只负责持有 `AgentSession` 和转发事件，SQLite、generation、会话状态和 `AgentEvent v1` 投影仍由 Rust 管理。

协议是单行 JSONL，并固定为 `aibo-pi-sdk-host.v1`：

- `start`：以工作区路径和 Aibo 管理的 `sessionDir` 创建或打开 `SessionManager`。
- `prompt`：立即返回 accepted，在同一 stdout 流中异步转发 SDK 事件。
- `steer` / `followUp`：仅在活动 turn 中接受排队消息，分别对应“插入当前响应”和“当前响应结束后跟进”。
- `abort`：调用 `AgentSession.abort()`。
- `tree`：读取 Pi 原生 `SessionManager` 树，返回当前 leaf、父子关系、角色和截断后的摘要。
- `dispose`：释放 SDK session 和 host 进程。

Pi SDK 的 `message_start/update/end`、`turn_end`、`agent_start`、`agent_error` 和工具执行事件在 Rust 侧被收敛为 `turn.*`、`message.*`、`tool.*`、`usage.updated`、`adapter.*`；队列、compaction、retry、extension 和 session metadata 分别投影为 `queue.updated`、`compaction.*`、`retry.*`、`extension.updated`、`session.info_changed`，因此前端继续复用 Codex 的时间线和 composer。

## 安全边界

首批只向 SDK 传入 `read`、`grep`、`find`、`ls` 工具。Pi 本身没有 Codex 那样的原生 OS 沙箱，UI 和诊断均显示“只读工具 / 无原生沙箱”；工作区 trust 仍是 Agent 操作前的显式确认，不能把工具白名单误报成系统隔离。

认证不由 Aibo 保存，继续使用 Pi SDK/native agent 的凭据存储。`sessionDir` 放在应用数据目录下，绑定表只保存 Pi session id 与 generation，应用重启后通过 `SessionManager.list/open` 恢复。

## 本机验证

已在 macOS 上验证 Node host 可启动并返回协议版本、Pi session id、持久化 session 文件和只读 capability；真实模型 smoke 已覆盖首轮响应、session tree leaf、流式 `steer`、`followUp` 和 `abort`。Windows 仍需重新验证 Node 路径、session 路径及进程退出行为。

## 当前批次已完成

1. `steer` / `followUp` 已映射到统一 composer 队列语义，并在真实 SDK host smoke 中验证 accepted 和 abort 边界。
2. Pi session tree 已通过 host、Rust command 和 Svelte inspector 展示当前 leaf 与父子层级。
3. SDK host fixture 已增加 tree response 及 compaction/retry/extension 生命周期事件。

## 下一批

1. 在 Windows 上重新验证 Node 路径、session 路径及进程退出行为。
2. 将 snapshot 接口接入跨 Agent handoff 的不可变快照工件。
3. 进入 Phase 4，补齐统一会话搜索、状态筛选和时间线体验。
