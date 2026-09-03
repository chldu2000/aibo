# Phase 2：Codex Adapter 能力扩展

> 状态：审批闭环与 thread list/read 已实现，后续批次开发中
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
pnpm tauri dev --no-watch
```

真实 UI 验证：让 Codex 产生 command/file approval request，确认卡片显示 command/cwd；点击“拒绝”后 turn 安全结束；在允许路径可用时点击“允许”，确认请求只发送一次且状态回到 running。

## 第二批：线程读取与发现

本批次新增两个 typed Tauri command：

- `list_codex_threads(workspaceId)`：以短生命周期 App Server 客户端读取当前工作区的远端线程列表。
- `read_codex_thread(sessionId)`：通过已有 session binding 读取远端 thread，并返回状态、工作目录和 turn 数量。

前端右侧诊断区显示最近线程，当前会话标题旁显示远端 turn 数量；这些读取结果仍以 Codex 为权威，不覆盖 Aibo 的 SQLite 时间线投影。

## 后续批次

1. 将 thread resume/fork/archive 补齐为统一 session API，并为 list/read 增加绑定一致性检查。
2. 归一化 command、file change、diff、usage 等 tool/item 事件并投影到 timeline。
3. 为 approval、adapter crash、旧 generation 增加 fixture replay 和 contract tests。
4. 评估待审批请求在应用重启后的可解释恢复策略；不能假定原生 server request 可安全重放。

## 退出条件

macOS 上不显示 Codex 原生 UI；Aibo 能完成会话创建、流式显示、显式审批、拒绝/允许结果投影和恢复，并通过 Codex adapter contract tests。
