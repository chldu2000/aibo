# Phase 4：统一会话体验

> 状态：macOS 实现与离线门禁完成；真实模型 smoke 需在 provider/网络可用时复跑
> 平台：macOS arm64 首发基线
> 前置：Phase 1/2 已完成；Phase 3 macOS 门禁已完成

## 本批目标

让 Codex 与 Pi 在同一工作区内复用统一的会话列表、筛选、生命周期操作和时间线入口，同时保持各自 adapter 的原生 binding 与 generation 隔离。

## 当前已实现

- `list_sessions` 支持名称、Agent 和消息内容搜索。
- 支持活动、全部、已归档以及具体 session state 筛选。
- 支持统一会话改名。
- Codex/Pi 共用归档与取消归档 Tauri command；Pi 归档会释放 SDK host，保留本地时间线和原生 session binding。
- 默认仅显示未归档会话，归档会话可通过“已归档”筛选恢复。
- 会话列表显示 Agent 标识和本地化状态标签。
- 新增 `AgentEventReplay` contract harness，以脱敏 Codex/Pi fixture 回放统一事件。
- 回放强制校验 schema version、session/workspace/external binding、generation、sequence 和重复事件。
- 覆盖工具生命周期、Pi SDK 事件映射、旧 generation 丢弃、重复 completion 和崩溃后审批清理。
- 时间线支持按批次加载更早消息，并对长条目启用 `content-visibility` 延迟渲染。
- 工具输出支持折叠查看，diff 内容使用独立代码块呈现；usage 在时间线工具栏汇总。
- `turn.failed`/adapter crash 提供上一条用户提示的重试入口。
- contract harness 覆盖交错 Codex/Pi session binding 和 unsupported capability 的负向用例。

## 下一步

1. 在 Codex/Pi 真实会话上验证同一工作区并行运行和异常退出后的 UI 状态恢复。
2. 将时间线批次加载替换为滚动锚点，并评估超大工具输出的 artifact 外置策略。

## 退出条件

同一工作区可并行运行 Codex/Pi，会话搜索、改名、归档和状态筛选行为一致；不同 session/thread 的事件不会串线；异常退出可解释并可恢复。

## 当前门禁证据

- `pnpm test`：27 项通过，包含 Codex/Pi fixture 回放、交错 session binding、重复事件、旧 generation 和崩溃恢复。
- `pnpm build`、`pnpm exec tsc --noEmit`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：17 项通过。
- `pnpm run probe:pi:sdk-host`：协议 host 启动/释放通过。
- macOS Phase 1/2/3 的真实 Codex/Pi 会话、恢复和 Pi session tree 门禁已在对应阶段记录中通过；本次 UI 批次未修改 adapter 进程逻辑。

真实模型 smoke 对外部 provider/网络敏感；最近一次复跑出现 Codex 响应超时和 Pi 空文本重试，已作为环境告警保留，不能替代离线 contract 门禁。
