# Aibo 多 Agent 工作台：调研、架构建议与实施计划

> 状态：架构已冻结（macOS 首发）；Phase 0 macOS 复验完成，Phase 1 Codex 真实会话已验收，Phase 2 审批、Codex thread 生命周期、工具事件投影与恢复契约已实现，Phase 3 Pi SDK host 首批垂直链路已开始，Windows 后续验证
> 调研日期：2026-09-02  
> 首批目标：Codex、Pi；首发平台：macOS（当前基线为 arm64）
> 技术栈：Svelte 5 + Tauri 2

## 1. 结论先行

Aibo 应定位为“本地 Agent 客户端与上下文交换层”，而不是又一个 Agent，也不是多个原生 UI 的壳。

推荐采用四层结构：

1. **Aibo Core**：工作区、统一会话目录、进程生命周期、权限与本地持久化。
2. **Agent Adapter**：把 Codex App Server、Pi RPC/SDK 的不同协议映射成统一事件与命令。
3. **Context Exchange**：实现稳定的 `@会话` 引用、版本化 handoff 工件、预算控制与审计。
4. **Aibo UI**：唯一输入输出界面；不嵌入、不转发 Agent 原生 TUI/GUI。

最重要的架构判断：

- **Codex 首选 App Server，不以 `codex exec` 或 SDK 作为主客户端接口。** App Server 原生覆盖认证、线程历史、审批、流式事件、读取、恢复、分叉等工作台所需能力。[Codex App Server](https://learn.chatgpt.com/docs/app-server)
- **Pi 首版采用项目锁版 SDK adapter host。** SDK 直接提供 `AgentSession`、事件订阅、abort 和会话树能力；RPC 保留为兼容/诊断路径。[Pi RPC](https://pi.dev/docs/latest/rpc)
- **handoff 的权威实现必须在 Aibo，不应依赖单个 Agent 的插件。** Agent Skill 用于统一“如何生成、如何消费”handoff 的语义；会话读取、快照冻结、传输、权限、引用解析和持久化由 Aibo 控制。
- **首版不宣称无损迁移 Agent 内部上下文。** 可移交的是可观察记录、用户约束、工具结果、文件/版本状态、决策、未完成事项和工件；不可依赖或伪造隐藏推理、进程内私有状态和厂商未公开状态。
- **Pi 安全模型必须单独处理。** Pi 官方说明其没有内建沙箱，默认继承启动用户权限。首版必须把“工作区信任”和“执行隔离”分开表达，不能把 project trust 当成沙箱。[Pi Security](https://pi.dev/docs/latest/security)

## 2. 当前仓库与本机基线

当前工作区包含 Phase 0 探针、脱敏 fixture、`AgentEvent v1` envelope，以及已通过 macOS 验收的 Phase 1 Svelte/Tauri/Rust 应用骨架。架构评审冻结记录见 [docs/architecture-freeze.md](architecture-freeze.md)；Phase 2 继续以 macOS arm64 为开发和验收基线，不需要兼容历史产品实现。

本机已检测到：

- Node.js `24.19.0`
- pnpm `11.21.0`
- Rust/Cargo `1.94.1`
- Pi `0.84.1`
- 可发现 Codex 可执行文件；版本探测在当前受限环境中没有成功返回版本号

这足以开展 macOS 首发的 Phase 1 工程；Windows 的真实 Pi 会话和平台进程行为仍需在目标环境单独验证。正式工程应锁定并验证项目级版本，而不是依赖本机全局版本。

## 3. 调研结果

### 3.1 Codex

Codex App Server 是当前最贴合 Aibo 的接口：

- 使用双向 JSON-RPC 2.0 风格协议；默认 stdio 为逐行 JSON。
- 支持 `thread/start`、`thread/resume`、`thread/fork`、`thread/read`、`thread/list`。
- 可以读取完整 turn 历史、流式接收 turn/item 事件，并把审批请求交给客户端处理。
- 可以生成与本机 Codex 版本一致的 TypeScript 或 JSON Schema，降低协议漂移风险。
- WebSocket transport 当前仍标为实验性且不支持生产，因此桌面首版应使用 stdio。

参考：[Codex App Server 协议与线程能力](https://learn.chatgpt.com/docs/app-server)

Codex SDK 适合自动化任务或在程序中启动/恢复线程，但官方把需要认证、历史、审批和流式事件的自定义客户端明确导向 App Server。因此 Aibo 的 Codex adapter 应直接面向 App Server，SDK 只用于测试辅助或未来服务端自动化。[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)

Codex 的 skill 是带 `SKILL.md` 的目录，可附带脚本、参考资料和资产；仓库级 skill 可放在 `.agents/skills`。这为跨 Agent 的共享 handoff 语义提供了基础。[Build skills](https://learn.chatgpt.com/docs/build-skills)

### 3.2 Pi

Pi 提供两条可用集成路线：

- **RPC 模式**：`pi --mode rpc`，stdin 接收 JSON 命令，stdout 输出 JSONL response/event；支持 prompt、steer、follow-up、abort、会话切换、状态查询、模型设置、队列、compaction 和扩展 UI 请求。
- **TypeScript SDK**：`@earendil-works/pi-coding-agent`，可直接创建 `AgentSession`、订阅事件、操作会话树并注入自定义 skill/tool/resource loader。[Pi SDK](https://pi.dev/docs/latest/sdk)

对于 Tauri 桌面端，SDK host 的优势是类型完整、可定制工具和资源加载器，且 macOS 本机已验证真实 turn、stream、abort 和 session resume。它要求额外的 Node adapter host，因此 RPC 仍保留作兼容/诊断路径；Windows 主路径以项目锁版 SDK 为准。

Pi 会话为 JSONL，entry 通过 `id/parentId` 组成树，原生支持分支。这一模型与 Codex 的 thread/fork 不完全相同，Aibo 需要保留各自原生标识，同时对 UI 暴露统一的 session/branch 概念。[Pi Session Format](https://pi.dev/docs/latest/session-format)

Pi 实现 Agent Skills 标准，也能读取 `.agents/skills`，并明确支持加载 Codex skill 目录。这意味着同一份 `aibo-handoff` skill 可以被两者消费，是首版最有价值的可移植扩展点。[Pi Skills](https://pi.dev/docs/latest/skills)

### 3.3 Svelte 5 与 Tauri 2

前端建议采用 Svelte 5 runes：`$state` 管理可变视图状态，`$derived` 管理派生状态，`$effect` 只用于与外部系统同步；跨组件领域状态放在 `.svelte.ts` 模块中。Svelte 5 的 reactivity 可以脱离组件顶层使用，适合工作台的多会话状态模型。[Svelte 5 文档](https://svelte.dev/docs/svelte/llms.txt)

Tauri 可以嵌入 sidecar binary，但首版更适合由 Rust Core 发现并启动用户已安装的 `codex`/`pi`，降低发行包和许可证复杂度；发行阶段再决定是否捆绑固定版本。Tauri 的 capabilities 用于限制 WebView 能调用的系统接口，但不能替代 Agent 进程自身的 OS 级隔离。[Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)、[Tauri Capabilities](https://v2.tauri.app/security/capabilities/)

### 3.4 插件、Skill、MCP 的边界

建议明确分工：

| 能力 | 放置位置 | 原因 |
| --- | --- | --- |
| 会话发现、读取、恢复 | Agent Adapter | 厂商协议不同，必须由适配层处理 |
| `@` 解析、权限确认、快照冻结 | Aibo Core | 需要稳定、可审计，不能依赖模型自觉 |
| handoff JSON/Markdown 生成 | Context Exchange | 需要统一 schema、版本和哈希 |
| handoff 的写法与消费规则 | 共享 Agent Skill | Codex、Pi 均能使用 `.agents/skills` |
| 从 Agent 内主动查询 Aibo | 可选 MCP/扩展 | 属于反向集成，不是首版主链路 |
| Codex 插件分发 | 后续 | Codex 插件可打包 skill/MCP，但 Pi 不原生消费 Codex 插件 |

Agent Skills 规范定义了 `SKILL.md`、frontmatter 和渐进加载结构，适合作为语义层的最低公共约定。[Agent Skills Specification](https://agentskills.io/specification)

MCP 更适合暴露工具与资源，不应被当作跨 Agent 会话数据库或唯一传输协议。后续可以由 Aibo 暴露只读资源，例如 `aibo://sessions/{id}`、`aibo://handoffs/{id}`，再为支持 MCP 的 Agent 提供按需检索。

## 4. 推荐产品模型

### 4.1 核心对象

- **Workspace**：一个已规范化的本地目录，可关联 Git 状态、信任状态、默认 Agent 与权限策略。
- **Agent Installation**：某个 Agent 的安装、版本、可执行路径、认证状态与 capability 集合。
- **Aibo Session**：Aibo 的稳定会话 ID；可绑定一个 Codex thread ID 或一个 Pi session ID/file。
- **Turn / Message / Event**：Aibo 归一化后的可见输入输出和运行事件。
- **Mention**：指向某会话某个已完成 turn 的不可变引用，不只是文本中的 `@名字`。
- **Handoff Bundle**：版本化的 machine-readable envelope 与 human-readable Markdown 投影。
- **Artifact**：代码 diff、文件、日志、测试报告或其他由会话产生的可引用结果。

### 4.2 UI 信息架构

建议使用三栏主布局：

1. 左栏：工作区、筛选、会话列表、Agent/运行状态。
2. 中栏：统一时间线、输入框、`@` 选择器、运行控制、审批卡片。
3. 右栏：上下文检查器，显示本次发送将携带的 mention、handoff、文件、token 估算和权限。

关键原则：

- Agent 名称只是会话属性，不为不同 Agent 复制一套 UI。
- 工具调用、审批、diff、错误均用统一组件呈现；适配器私有字段放到“原始详情”。
- 输入框里的 `@` 必须是结构化 mention token，存储时记录 ID 和 pinned revision，不能只靠发送前正则替换。

## 5. 推荐技术架构

```mermaid
flowchart LR
  UI[Svelte 5 Workbench UI] -->|typed Tauri commands/events| CORE[Rust Aibo Core]
  CORE --> DB[(SQLite + artifact store)]
  CORE --> HX[Context Exchange]
  CORE --> SUP[Process Supervisor]
  SUP --> CA[Codex Adapter]
  SUP --> PA[Pi Adapter]
  CA -->|stdio JSON-RPC| C[codex app-server]
  PA -->|versioned JSONL| P[Pi SDK host]
  P -->|AgentSession / SessionManager| PI[@earendil-works/pi-coding-agent]
  HX --> SKILL[shared aibo-handoff skill]
  HX -. later .-> MCP[optional Aibo MCP/resource bridge]
```

### 5.1 前端

- Svelte 5 + TypeScript + Vite；桌面首版无需 SSR，暂不引入 SvelteKit。
- 按领域组织：`workspaces`、`sessions`、`composer`、`timeline`、`approvals`、`handoffs`、`settings`。
- 使用 runes store 保存 UI 投影；Rust/SQLite 是持久状态权威源。
- 流式 token 先在内存聚合，按帧批量更新 UI，避免每个 delta 触发完整列表渲染。
- 长会话时间线必须虚拟化；工具输出和大 diff 延迟加载。
- Markdown 必须经过可信度分级和 HTML 清洗；Agent 输出不能获得 Tauri IPC 能力。

### 5.2 Rust Core

Rust Core 负责：

- 路径规范化与工作区信任。
- Agent 探测、版本/能力检查和进程监管。
- stdio framing、请求关联、超时、重试、崩溃恢复。
- 统一状态机和事件落库。
- 细粒度 Tauri command；不向 WebView 暴露通用 shell 或任意 SQL。
- secret 只保存在各 Agent 原生认证存储或 OS secret store，SQLite 只保存引用和状态。

建议库：

- async/runtime：Tokio
- 序列化：Serde
- SQLite：`sqlx` 或 `rusqlite`，启用 WAL 和 migration
- ID：ULID
- 日志：`tracing`，默认脱敏
- schema：Rust 类型为 Aibo contract 权威源，通过代码生成导出 TypeScript 类型

### 5.3 Agent Adapter Contract

不要做“所有 Agent 最小公分母”接口；采用基础命令加 capability negotiation：

```ts
interface AgentAdapter {
  probe(): Promise<AgentInstallation>;
  capabilities(): AgentCapabilities;
  listSessions(workspace: WorkspaceRef): Promise<ExternalSession[]>;
  start(request: StartSessionRequest): Promise<SessionBinding>;
  resume(binding: SessionBinding): Promise<void>;
  snapshot(binding: SessionBinding, through?: TurnRef): Promise<SessionSnapshot>;
  send(input: AgentInput): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  approve?(requestId: string, decision: ApprovalDecision): Promise<void>;
  fork?(sessionId: string, through?: TurnRef): Promise<SessionBinding>;
  archive?(sessionId: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
}
```

`AgentCapabilities` 至少包含：

- `history.read/list`
- `session.resume/fork/archive`
- `input.steer/followUp/images`
- `events.toolDelta/usage`
- `approval.command/file`
- `permissions.nativeSandbox`
- `skills.discovery`

适配器只输出统一 `AgentEvent`：

- `session.started | session.state_changed`
- `turn.started | turn.completed | turn.failed`
- `message.delta | message.completed`
- `tool.started | tool.updated | tool.completed`
- `approval.requested | approval.resolved`
- `usage.updated`
- `adapter.warning | adapter.crashed`

### 5.4 进程模型

- Codex：一个安装/身份 profile 对应一个常驻 App Server，可多路复用多个 thread；首版只用 stdio。
- Pi：每个活跃 Aibo session 一个项目锁版 Node SDK host 进程，打开/继续其原生 session；会话空闲后可释放进程，再按 binding 恢复。RPC 进程仅用于兼容/诊断。
- 每个进程有 generation ID，旧进程迟到事件不得写入新 generation。
- 应用退出时先停止接收输入，再中断/等待正在运行的 turn，最后关闭 sidecar；崩溃后标记 session 为 `interrupted` 而非假定完成。

## 6. 跨 Agent Handoff 设计

### 6.1 目标

支持以下主路径：

1. 用户在目标会话输入 `@源会话`。
2. Aibo 将 mention 绑定到源会话最后一个已完成 turn，或用户选择的 turn/range。
3. 源 adapter 生成统一 `SessionSnapshot`；Aibo 同时采集工作区的可验证状态。
4. Context Exchange 生成不可变 Handoff Bundle。
5. 用户在右侧检查器查看将发送的内容、大小、敏感项和缺失能力。
6. Aibo 把精简 handoff 注入目标 Agent；目标会话继续运行。
7. mention、bundle hash、目标 turn 写入审计关系，之后可回溯。

如果源会话仍在运行，只允许默认捕获到最后一个已完成 turn，并在 handoff 中明确标记“源会话仍在运行”。不拼接半个工具调用或未完成 assistant message。

### 6.2 双格式工件

每个 handoff 同时保存：

- `envelope.json`：机器读取、严格 schema、可升级。
- `handoff.md`：人和 Agent 可读，由 JSON 确定性渲染。

默认存放在 Aibo app data 中，不自动污染工作区。用户可以显式导出到 `.aibo/handoffs/`。向目标 Agent 发送时可以内联 Markdown；后续支持通过 Aibo MCP/resource bridge 按需读取。

建议 schema：

```json
{
  "schema": "aibo.handoff/v1",
  "id": "01...",
  "createdAt": "2026-09-02T00:00:00Z",
  "source": {
    "workspaceId": "...",
    "agent": "codex",
    "aiboSessionId": "...",
    "externalSessionId": "...",
    "throughTurnId": "..."
  },
  "objective": "...",
  "constraints": [],
  "decisions": [],
  "completed": [],
  "currentState": {},
  "evidence": [],
  "remaining": [],
  "openQuestions": [],
  "requiredCapabilities": [],
  "attachments": [],
  "redactions": [],
  "contentHash": "sha256:..."
}
```

`currentState` 应包含可验证信息，而不只是模型总结：

- canonical workspace path 的匿名/本地引用
- Git repo、branch、HEAD、dirty 状态
- changed files 和 diff 摘要
- 已执行命令、测试结论、退出码
- 关键工件路径与 hash
- 原 Agent、模型、权限 profile、skills/tools 依赖

### 6.3 生成策略

handoff 采用“确定性事实 + 受约束摘要”两阶段：

1. **Fact collector** 从 adapter 和工作区采集结构化事实，不让模型改写退出码、路径、hash 或 turn 边界。
2. **Summary compiler** 提炼目标、决定、进展和剩余事项；输出必须通过 schema 校验，并保留 evidence 引用。

如果摘要模型失败，仍应生成只含事实的 handoff，而不是阻断引用。

上下文分三级，避免一次 `@` 塞入整段历史：

- L0：身份、目标、最新状态、hash。
- L1（默认）：约束、决定、完成项、剩余项、关键证据。
- L2：用户选择的原文 turn、工具输出或附件。

发送前显示 token/字符估算；超预算时优先去重和降级 L2，不截断 schema 核心字段。

### 6.4 共享 `aibo-handoff` Skill

仓库级建议位置：

```text
.agents/skills/aibo-handoff/
├── SKILL.md
├── references/
│   └── handoff-v1.md
└── assets/
    └── handoff-v1.schema.json
```

Skill 只定义：

- 何时生成或消费 handoff。
- 不重复已经有证据证明完成的工作。
- 在继续前验证 workspace/HEAD/diff 是否仍匹配。
- 明确报告缺失文件、失效路径、能力不足和权限差异。
- 不把摘要当成事实，事实必须回链到 evidence。

Skill 不负责：读取任意会话数据库、解析 `@`、跨进程通信、保存 secret 或绕过审批。

### 6.5 `@` 语义

UI 展示可使用：

```text
@Codex/重构登录流程
@Pi/调查测试失败#turn-18
```

内部必须保存结构化对象：

```ts
type MentionRef = {
  workspaceId: string;
  sessionId: string;
  throughTurnId: string;
  handoffId: string;
  labelAtSendTime: string;
};
```

会话改名不影响已发送 mention；删除源会话时，已冻结的 handoff 仍可保留，是否连带删除必须显式询问。

## 7. 本地数据设计

SQLite 至少包含：

- `workspaces`
- `agent_installations`
- `sessions`
- `session_bindings`
- `turns`
- `messages`
- `tool_events`
- `approvals`
- `mentions`
- `handoffs`
- `artifacts`
- `process_runs`

原则：

- Aibo session ID 是 UI 与跨 Agent 引用的稳定主键；原生 session/thread ID 只存在 binding 中。
- 原生会话仍是恢复该 Agent 的权威来源；Aibo 保存足以展示、搜索和生成 handoff 的归一化投影。
- 默认不持久化隐藏推理或未向用户显示的内部内容。
- 原始协议 payload 只在显式 debug mode 下短期保留并脱敏。
- handoff 不可变；修订会产生新 ID，并记录 `supersedes`。

## 8. 安全与权限

### 8.1 信任不等于沙箱

需要分别显示：

- **Workspace trust**：是否加载仓库内 instructions、skills、extensions。
- **Execution permission**：Agent 进程实际能读写和执行什么。

Codex 可以映射其原生 approval/sandbox 能力。Pi 首版如果直接运行在宿主机，就必须清楚标注为“继承当前用户权限”；即便禁用部分工具，也不能把它宣传为 OS 沙箱。

### 8.2 首版安全基线

- WebView 不获得任意 shell、任意路径文件系统或通用 SQL 权限。
- 只有 Rust Core 能启动已注册 Agent；命令和参数由 adapter 构造。
- 工作区路径先 canonicalize，并防止 symlink/junction 逃逸。
- Codex 审批请求在 Aibo 中原样展示目标命令/文件范围。
- Pi 在首次进入每个 workspace 时要求显式信任；未信任时不启动可写会话。
- HTML/Markdown、文件链接和协议链接均按不可信输入处理。
- auth token 不写入 Aibo 日志、handoff 或 SQLite。
- handoff 生成前运行 secret pattern scanner，并允许用户预览/取消。

### 8.3 后续隔离

V1 后为 Pi 增加可选 container/VM/平台 sandbox runner；统一权限 profile 应显示“requested / enforced / unsupported”，不能静默降级。

## 9. 分阶段实施计划

以下以 1 名熟悉 TypeScript/Rust 的工程师为估算基线；多人可并行 UI、Core、adapter，但协议契约应先冻结。

### Phase 0：技术探针（3–5 天）

交付：两个独立 CLI probe，不做 UI。

- Codex：启动 App Server、initialize、start/list/read/resume、流式一次 turn、处理一次 approval。
- Pi：启动 RPC、prompt、stream、abort、恢复 session、读取 session tree。
- 保存双方原始事件样本和版本信息。
- 基于样本确定 `AgentEvent v1` 与 capability matrix。

退出条件：macOS 首发基线上的两个 Agent 都能在无原生 UI 条件下完成一次可恢复会话；失败/退出不会挂死父进程。Windows 目标环境的同一门禁作为后续兼容性验证。

### Phase 1：macOS 应用骨架与工作区（4–6 天）

- 初始化 Svelte 5 + Tauri 2 + pnpm + Rust workspace，macOS arm64 作为首发开发基线。
- 建立 typed IPC、SQLite migration（WAL）、tracing、错误模型。
- 工作区添加/删除/最近使用/canonical path 校验/symlink 逃逸检查/信任状态。
- Agent 安装探测与诊断页；不读取或保存认证 secret。
- 建立三栏壳和可消费 `AgentEvent v1` fixture 的空时间线。

退出条件：macOS arm64 上重启应用后工作区与 Agent 探测结果稳定恢复；路径越界和未信任写入被拒绝；WebView 无任意 shell 权限；Windows 只作为后续验证门。

### Phase 1B：Codex 真实会话垂直链路（已完成 macOS 验收）

- 在 Rust Core 内启动和监管 `codex app-server --stdio`。
- 完成 initialize、thread/start、turn/start、流式 delta、completed、interrupt 和 thread/resume。
- 以 `AgentEvent v1` 归一化事件，同时持久化 session、turn、message 和 event projection。
- 在 Svelte 时间线中完成新建会话、发送提示、流式显示、中止和重启读取。
- 初始会话固定只读 sandbox 与 `approvalPolicy=never`；审批请求安全拒绝并留下后续 UI 扩展点。

退出条件：macOS arm64 上可完成“工作区 → Codex thread → 真实 turn → 流式时间线 → SQLite 恢复”的演示门禁；进程异常、超时和旧 generation 不得静默污染当前会话。

### Phase 2：Codex Adapter 能力扩展（5–8 天，当前阶段）

- stdio JSON-RPC client、schema/version 适配。
- thread list/start/read/resume/fork/archive。
- turn/item 流式事件归一化。
- approval 卡片、interrupt、崩溃恢复。
- Codex capability contract tests。

当前门禁：不出现 Codex 原生 UI；Aibo 已完成会话创建、流式显示、审批、恢复、thread list/read/fork/archive/unarchive、工具 item/usage 投影与绑定一致性检查。下一门禁转向跨 Agent handoff 与统一 session tree。

### Phase 3：Pi Adapter（5–8 天，当前阶段）

- Node SDK host 生命周期、`AgentSession` 事件订阅与请求关联。
- prompt/steer/follow-up/abort 和模型/工具状态映射。
- session create/open/switch/tree 映射。
- tool/compaction/retry/extension UI event 归一化；RPC framing 仅保留兼容测试。
- project trust 提示和“不具备内建沙箱”状态标识。

当前门禁：已落地版本化 `aibo-pi-sdk-host.v1` JSONL host、Pi `AgentSession` 的 create/open、streaming、abort、steer/follow-up、SQLite 投影、session tree 读取和统一 `AgentEvent v1` 事件；首批 host 只开放 `read/grep/find/ls` 只读工具，并在诊断与会话 UI 中明确 Pi 没有原生沙箱。macOS 真实模型 smoke 已覆盖响应、tree leaf、排队消息和 abort。详细边界见 [Phase 3 记录](phase-3-pi-adapter.md)。下一批补齐 compaction/retry/extension 事件、崩溃恢复和安全分支动作。

退出条件：与 Codex 共用同一套时间线、composer 和 session state UI；恢复原生 Pi session 不丢失分支关系。

### Phase 4：统一会话体验（4–6 天）

- 会话搜索、改名、归档、状态筛选。
- 时间线虚拟化、工具输出、diff、usage、错误重试。
- 进程 generation、应用退出与重启恢复。
- adapter contract test harness，使用录制协议 fixture 做回放。

退出条件：同一工作区可并行运行 Codex/Pi，会话状态不会串线，异常退出可解释并可恢复。

### Phase 5：`@` 与 Handoff v1（6–10 天）

- mention picker 与结构化 token。
- immutable session snapshot、last-completed-turn 规则。
- Handoff Envelope v1、Markdown renderer、hash、redaction。
- 默认 L1 注入、L0/L2 选择、预算预览。
- `aibo-handoff` 共享 skill 与 Codex/Pi 验收样例。
- provenance UI：从目标 turn 反查源 session/turn/handoff。

退出条件：Codex → Pi、Pi → Codex 各完成 3 个真实任务 handoff；目标 Agent 能说明已完成、未完成与证据，且不会默认重做已验证工作。

### Phase 6：稳定性与发布（5–8 天）

- 数据 migration、崩溃恢复、日志脱敏、secret scan。
- Windows installer；明确 Agent 依赖与认证前置条件。
- 大会话性能测试、协议 fuzz/framing 测试。
- 威胁模型与权限文档。
- E2E：工作区 → 会话 → 工具/审批 → 重启 → handoff。

退出条件：核心 E2E 连续通过；已知不支持能力在 UI 中明确显示且不会静默降级。

粗略总工期：**32–51 个工程日**。建议先完成 Phase 0 再对后续排期二次估算，因为 Codex/Pi 版本差异和 Windows 进程控制会显著影响成本。

## 10. MVP 范围

MVP 必须有：

- 本地工作区管理。
- Codex/Pi 安装探测和诊断。
- 创建、恢复、改名、归档会话。
- 统一流式消息、工具事件、停止按钮。
- Codex 原生审批 UI 接管。
- Pi 无沙箱风险提示与工作区信任。
- `@会话`、冻结快照、Handoff v1、来源回链。
- 本地 SQLite、重启恢复、基础搜索。

MVP 不做：

- 云端同步、多人协作、移动端。
- 任意第三方 adapter 动态安装。
- 把多个 Agent 伪装成一个共享原生会话。
- 自动提交、自动 push 或自动合并代码。
- 对 Pi 声称强沙箱。
- handoff 完整转移隐藏推理或厂商私有状态。
- MCP bridge、公共插件市场、远程 Agent host。

## 11. 测试策略

### Contract tests

每个 adapter 使用同一套行为测试：

- create/send/stream/complete
- interrupt during text/tool
- process crash and resume
- history snapshot through a completed turn
- unsupported capability returns explicit result
- event ordering and duplicate suppression

### Fixture replay

录制脱敏后的 Codex/Pi 协议流，离线回放到 normalizer。这样 UI 和数据库测试不依赖真实模型调用，也能固定协议边界案例。

### Handoff eval

建立至少 12 个场景：

- 纯调研、代码修改、测试失败、部分完成、被中断、分支会话
- 源 dirty workspace、HEAD 已变化、缺失文件、目标能力不足
- Codex → Pi、Pi → Codex 双向

评分维度：事实准确率、重复工作率、遗漏约束、错误文件引用、目标恢复时间、用户需要补充的信息量。

## 12. 主要风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Agent 协议快速变化 | adapter 失效 | 版本探测、生成 schema、fixture 回放、capability negotiation |
| Pi 无内建沙箱 | 误操作/安全风险 | 明示权限、workspace trust、后续容器 runner、不静默降级 |
| handoff 摘要产生幻觉 | 错误继续工作 | 事实/摘要分层、evidence 引用、hash、目标侧先验证 |
| 长会话/大工具输出 | UI 卡顿、DB 膨胀 | 虚拟化、增量聚合、外置 artifact、保留策略 |
| `@` 引用随源会话变化 | 不可复现 | pinned turn + immutable handoff + content hash |
| 工作区外路径或 junction | 权限逃逸 | canonical path、scope 检查、平台测试 |
| 把 skill 当作安全边界 | 可绕过 | 权限在 Core/OS 层实施，skill 仅是行为说明 |
| 原生认证差异 | onboarding 复杂 | 首版复用各 Agent 登录状态，Aibo 不接管 secret |

## 13. 架构冻结与下一步

macOS 本机 Phase 0 已通过，架构评审结果已经冻结在 [docs/architecture-freeze.md](architecture-freeze.md)：

1. 首发平台为 macOS，当前基线为 arm64；Windows 改为后续验证门。
2. Codex 使用 App Server；Pi 使用项目锁版 SDK host，RPC 仅作兼容/诊断。
3. `AgentEvent v1`、session state machine、`SessionSnapshot v1` 和 `Handoff Envelope v1` 的边界已确定。
4. Pi 首版接受宿主机当前用户权限，但必须通过 workspace trust 明示风险；不提前引入容器/VM。
5. Phase 1 已完成应用骨架、工作区、诊断、持久化、安全边界和 Codex 最小真实会话垂直链路；Phase 2 已完成 Codex 能力扩展，当前进入 Phase 3 Pi SDK host 与统一会话事件链路。

Phase 1 的 macOS 验收切片已完成：添加工作区、路径/信任检查、真实 Codex thread、流式响应和退出后时间线恢复均已验证。Phase 2 当前批次见 [phase-2-codex-capability-expansion.md](phase-2-codex-capability-expansion.md)。
