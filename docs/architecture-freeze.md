# Aibo 架构评审冻结：macOS 首发与 Phase 1 准备

> 日期：2026-09-02
> 状态：已冻结（首发平台为 macOS）
> 范围：本地桌面 MVP、Codex、Pi、Phase 1 应用骨架

## 1. 评审结论

Phase 0 的 macOS 本机门禁已经通过，Aibo 现在进入 Phase 1。Windows 不再是 Phase 1 的前置退出条件，而是后续的兼容性验证和发布准备工作。

首发开发与验证基线为 macOS arm64。Phase 1 不承诺 Intel/universal 安装包；这两项在首个可演示垂直切片稳定后单独评估。

冻结的运行时路线是：

- Codex 使用 `codex app-server` stdio JSON-RPC。
- Pi 使用项目锁版 `@earendil-works/pi-coding-agent@0.84.4`，由独立 Node SDK host 承载。
- Pi RPC 保留为兼容、诊断和协议回归路径，不与 SDK host 并行维护一套完整产品逻辑。

Phase 1 的目标不是接通完整 Agent 聊天，而是交付一个能稳定管理工作区、持久化状态并展示 Agent 诊断的 macOS 应用骨架。

## 2. 已冻结的架构决策

### 2.1 平台与发布范围

| 项目 | 决策 |
| --- | --- |
| 首发平台 | macOS；当前自动化基线为 arm64 |
| Windows | Phase 1 并行保留验证项，不阻塞 macOS 开发 |
| Linux、Intel/universal | 不进入 Phase 1 交付承诺 |
| Agent 认证 | 复用 Codex/Pi 原生登录状态，Aibo 不接管 secret |
| 原生 Agent UI | 不嵌入；Aibo UI 是唯一交互界面 |

### 2.2 进程与 adapter 边界

```text
Svelte UI
  │ typed Tauri commands/events
  ▼
Rust Aibo Core
  ├─ workspace trust、路径校验、SQLite、状态机
  ├─ 进程监管、generation、超时和崩溃恢复
  ├─ Codex adapter ── stdio ── codex app-server
  └─ Pi adapter ───── JSONL ── 项目锁版 Node SDK host
                                  └─ AgentSession / SessionManager
```

- WebView 只能调用细粒度 Tauri command，不能获得任意 shell、任意路径文件系统或通用 SQL 权限。
- Rust Core 是工作区、信任、进程生命周期、归一化事件和持久化的权威层。
- adapter 负责厂商协议、原生 ID 和能力差异；不得把 vendor payload 直接暴露给 UI。
- Pi SDK host 的对外接口使用带版本的 JSONL 命令/事件；host 退出、超时或升级时由 Core 通过 `generationId` 隔离迟到事件。
- 初版每个活跃 Aibo Pi session 使用一个 SDK host 进程；空闲时可以释放，恢复时依据 binding 重新打开原生 session。

### 2.3 契约与标识

- `contracts/agent-event.v1.schema.json` 是 durable `AgentEvent v1` 的权威 schema；`schemaVersion`、`generationId`、`sequence`、事件类型和状态集合不得在 Phase 1 中静默修改。
- session state machine 冻结为：

  ```text
  created -> starting -> idle -> running -> idle
                                |       |
                                |       +-> interrupted -> starting
                                +-> waiting_approval -> running
  任意活动态 -> failed
  idle/failed/interrupted -> closed
  ```

- Aibo 使用 ULID 作为稳定的 `workspaceId`、`sessionId` 和事件 ID；Codex thread ID、Pi session ID/file 只保存在 binding 中。
- `SessionSnapshot v1` 冻结最小语义：`workspaceId`、`sessionId`、`agent`、`externalSessionId`、`throughTurnId`、状态、可验证 `currentState` 和 `evidence`。未完成 turn 不得成为默认快照边界。
- `Handoff Envelope v1` 冻结现有计划中的字段集合（source、objective、constraints、decisions、completed、currentState、evidence、remaining、openQuestions、requiredCapabilities、attachments、redactions、contentHash）；Phase 1 只保留接口位置，不实现 handoff UI。
- 破坏性契约变化必须升级版本或新增 ADR，不在 adapter 内私自兼容成隐式行为。

### 2.4 存储、权限与观测

- Rust Core 使用 SQLite、WAL 和 embedded migrations；Phase 1 采用 `sqlx`，不向 WebView 暴露通用 SQL。
- 原生 session 仍是恢复 Agent 的权威来源；SQLite 只保存 Aibo 投影、binding、诊断和可搜索状态。
- Pi 首版明确标识“继承当前用户权限”，workspace trust 不等于沙箱；未信任工作区不启动可写 Pi session。
- `tracing` 日志默认脱敏；auth token、原始协议内容和隐藏推理不写入 Aibo 日志、SQLite 或 handoff。原始协议仅在显式 debug 模式下短期保留并受访问控制。

## 3. Phase 1 实施边界

### 必须交付

1. Svelte 5 + Vite + Tauri 2 + Rust Core 脚手架，保留根目录 `contracts/` 作为契约源。
2. typed IPC、统一错误模型、`tracing` 初始化和 SQLite migration。
3. 工作区添加、删除、最近使用、canonical path 校验、symlink 逃逸检查和显式 trust 状态。
4. Codex/Pi 安装探测与诊断：可执行路径、版本、已知能力和认证状态；不得读取 secret 内容。
5. 三栏 UI 壳、空时间线、工作区/Agent 状态投影和重启恢复。
6. macOS arm64 的路径、子进程退出、generation 和迁移测试。

### 明确不做

- Phase 1 不实现 Codex/Pi 的完整会话 UI；真实 adapter 接入分别进入 Phase 2/3。
- 不实现 `@`、handoff、MCP、云同步、自动提交/推送或远程 Agent host。
- 不在 Phase 1 引入 Pi 容器/VM；如果安全评审拒绝宿主机权限模型，必须先开新的决策变更。
- 不因为 Windows 尚未重跑就复制一套平台分支；平台差异收敛在 adapter/tool factory 和 Core 的路径/进程抽象中。

## 4. Phase 1 退出条件

在 macOS arm64 上同时满足以下条件，才进入 Phase 2：

- `pnpm tauri dev` 可启动应用，WebView 没有任意 shell/文件系统能力。
- 用户添加的工作区被 canonicalize、持久化，关闭并重启后能恢复；越界路径和未信任写入会被拒绝。
- 诊断页能稳定展示 Codex/Pi 的发现结果和明确的 unsupported/missing-auth 状态，且不泄漏 secret。
- SQLite migration 可重复执行，WAL 开启，损坏/版本错误返回可解释错误。
- 进程 generation、超时和退出状态有测试；旧 generation 的事件不会污染新会话。
- 三栏壳和空时间线能消费 `AgentEvent v1` fixture，后续接入真实 adapter 不需要改 UI 数据模型。

## 5. Windows 后续验证门

Windows 在 Phase 1 之后单独执行，不改变已冻结的 macOS 主路线：

1. 完成 Pi 原生登录后重跑 SDK host 的真实 prompt、stream、abort、history 和 session tree。
2. 验证 PowerShell tool、路径 quoting、进程组终止和应用重启恢复。
3. 将结果加入独立的 Windows fixture/矩阵；若发现协议差异，只通过 capability negotiation 或平台 adapter 修复。
4. 在发布阶段再决定 Windows installer、Node host 是否捆绑及所需认证前置条件。

## 6. Phase 1 开工顺序

1. 先创建 Tauri/Svelte/Rust 空壳和 `sqlx` migration。
2. 实现 Core 的 workspace repository、trust policy、agent probe 和 typed IPC。
3. 用脱敏 fixture 驱动三栏壳与空时间线，先验证投影和重启恢复。
4. 在 macOS 上完成一次“添加工作区 → 诊断 Agent → 退出 → 重启恢复”的演示门禁。
5. 退出条件满足后，再进入 Codex adapter 的真实会话垂直切片。
