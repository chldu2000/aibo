# Phase 2：Codex Adapter 能力扩展

> 状态：审批闭环、thread 生命周期、工具事件投影与恢复契约已实现
> 平台：macOS arm64 首发基线
> 前置：Phase 1 Codex 真实会话已通过 macOS UI 验收

## 首批范围：审批请求闭环

本批次把 Codex App Server 的 server request 从“安全自动拒绝”升级为 Aibo 内的显式确认：

```text
Codex approval request
  → Rust pending request registry
  → AgentEvent v1 approval.requested
  → Svelte approval card
  → Tauri resolve_codex_approval
  → JSON-RPC response { decision: accept | cancel }
```

- `thread/start` 使用 `approvalPolicy=on-request`，仍固定 `sandbox=read-only`。
- request id 以字符串形式贯穿 Rust、事件 envelope、前端和 Tauri command，兼容 JSON-RPC 字符串/数字 id。
- Aibo 不自动批准；UI 仅暴露 Codex 声明的 `availableDecisions`。
- 审批请求当前只保存在活动 adapter 内存中，进程退出会清空 pending 状态并标记 session interrupted。

## macOS 验证门

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm probe:codex:approval
pnpm probe:codex:lifecycle
pnpm tauri dev --no-watch
```

真实 UI 验证：让 Codex 产生 command/file approval request，确认卡片显示 command/cwd；点击“拒绝”后 turn 安全结束；在允许路径可用时点击“允许”，确认请求只发送一次且状态回到 running。

## 第二批：线程读取与发现

本批次新增两个 typed Tauri command：

- `list_codex_threads(workspaceId)`：以短生命周期 App Server 客户端读取当前工作区的远端线程列表。
- `read_codex_thread(sessionId)`：通过已有 session binding 读取远端 thread，并返回状态、工作目录和 turn 数量。

前端右侧诊断区显示最近线程，当前会话标题旁显示远端 turn 数量；这些读取结果仍以 Codex 为权威，不覆盖 Aibo 的 SQLite 时间线投影。

## 第三批：线程生命周期

本批次补齐了持久 Codex 线程的分支与归档：

- `fork_codex_thread(sessionId, throughTurnId?)` 使用最近一条已完成 turn 作为默认边界，创建新的 Aibo session，并复制本地可见的 turns/messages 投影。
- `archive_codex_thread(sessionId)` 只归档远端 Codex 日志，将本地 session 标记为 `archived`，保留 SQLite 时间线，不执行永久删除。
- `unarchive_codex_thread(sessionId)` 调用 `thread/unarchive` 恢复远端日志，保持原 external thread binding，并将本地会话恢复为可继续发送的状态。
- 分支 binding 记录 `parentExternalSessionId`，为后续统一 session tree 和 handoff provenance 保留关系。
- 活跃 turn 不允许 fork/archive；归档会话不能继续发送消息或再次创建分支。

## 本批次：事件投影与一致性

1. `item/started|updated|completed` 及 command/file/MCP output progress 被归一化为 `tool.started|updated|completed`，工具摘要写入 `messages(role=tool)`，原始协议字段不直接暴露给 UI。
2. token usage 通知被归一化为 `usage.updated`，仅保留可审计的 token 计数。
3. 事件循环按绑定 thread ID 丢弃跨线程通知；每次持久化仍校验当前 `generationId`，旧 generation 事件不会污染新运行。
4. read/unarchive 使用短生命周期客户端，并校验响应 thread ID 与本地 binding 一致；read 不会为了读取历史而启动持久 runtime，fork 也拒绝复用源 thread ID。
5. approval、工具生命周期、fork/archive/unarchive、进程退出和旧 generation 均有脱敏 fixture replay/contract tests。进程退出会显式记录被丢弃的 pending approval 数量，不自动重放审批。

## 退出条件

macOS 上不显示 Codex 原生 UI；Aibo 能完成会话创建、流式消息与工具事件显示、显式审批、拒绝/允许结果投影、线程归档/取消归档和恢复，并通过 Codex adapter contract tests。
