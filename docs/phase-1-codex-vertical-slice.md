# Phase 1：Codex 真实会话垂直链路

> 状态：开发中
> 平台：macOS arm64 首发基线
> 范围：Codex App Server；Pi、handoff 和完整工具审批 UI 不在本切片内

## 目标

把一条最小但真实的会话链路贯通，而不是只在 UI 中模拟 Agent：

```text
工作区
  → Rust Core 启动 codex app-server --stdio
  → initialize / thread/start
  → turn/start
  → turn/item/delta/completed
  → AgentEvent v1
  → SQLite projection + Tauri event
  → Svelte timeline
```

## 已实现边界

- Core 发现 `codex` 可执行文件，并以工作区目录作为子进程 `cwd`。
- App Server 使用 JSON-RPC over JSONL；请求具备超时、pending request 清理和进程退出传播。
- 创建 Aibo session 后绑定 Codex thread；每次启动使用新的 `generationId`。
- `turn/start`、assistant message delta、完成/失败/中止映射到 `AgentEvent v1`。
- `sessions`、`turns`、`messages`、`agent_events` 写入 SQLite；应用重启后通过 `thread/resume` 恢复 binding。
- UI 支持新建/选择会话、流式时间线、发送提示和中止当前 turn。
- 初始 thread 固定 `approvalPolicy=never`、`sandbox=read-only`；审批请求会被记录并安全拒绝，审批卡片交互留待后续批次。

## macOS 验证门

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm probe:codex:smoke
pnpm tauri dev --no-watch
```

其中 `pnpm probe:codex:smoke` 在本机权限下验证 App Server 的真实 turn、流式事件和 `thread/resume`；Tauri 开发应用验证 Core、migration 和 WebView 启动路径。真实 UI 操作门禁为：添加工作区 → 新建 Codex 会话 → 发送只读提示 → 观察 delta → 中止或等待完成 → 重启后读取时间线。

## 当前刻意保留的缺口

1. 还没有审批请求的允许/拒绝 UI；默认只读策略保证本切片不会隐式获得写权限。
2. 尚未实现 thread 列表、分叉、归档和完整工具事件投影。
3. Pi adapter、跨 Agent handoff 和 Windows 进程行为继续作为后续验证/阶段。
4. 需要在真实 UI 操作门禁中进一步确认 macOS 原生认证、异常退出和恢复后的用户体验。
