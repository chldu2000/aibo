# Phase 4：统一会话体验

> 状态：开发中
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

## 下一步

1. 将时间线拆分为可延迟加载/可虚拟化的消息、工具输出、diff、usage 和错误重试区域。
2. 在 Codex/Pi 真实会话上验证同一工作区并行运行和异常退出后的 UI 状态恢复。
3. 将 contract harness 扩展到并行 session binding 和 unsupported capability 的负向用例。

## 退出条件

同一工作区可并行运行 Codex/Pi，会话搜索、改名、归档和状态筛选行为一致；不同 session/thread 的事件不会串线；异常退出可解释并可恢复。
