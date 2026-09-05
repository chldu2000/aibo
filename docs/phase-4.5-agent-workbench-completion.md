# Phase 4.5：常规 Agent 工作台能力补全

> 状态：实施中；4.5A–4.5F 的核心链路已落地，当前进行自动化回归与 macOS 真实 Provider 验收（G5）
> 平台：macOS arm64 首发基线；Windows 延后验证
> 前置：Phase 4 统一会话体验的 macOS 实现与离线门禁完成
> 后续：Phase 5 `@` 与 Handoff v1

## 1. 阶段定位

Phase 4 已经让 Codex 与 Pi 共用工作区、会话目录、时间线、生命周期操作和基础审批，但 Aibo 当前更接近“统一会话客户端”，尚未形成常规 Agent 工作台所需的完整任务闭环。

Phase 4.5 在 Handoff 前补齐以下闭环：

```text
选择任务和执行方式
  -> 提供结构化上下文
  -> Agent 读取、修改并运行验证
  -> 用户审阅本轮变更和证据
  -> 接受、继续或安全恢复
  -> 形成可供 Handoff 引用的事实与工件
```

本阶段不是为了扩展更多 Agent，也不是把 Aibo 做成完整 IDE。其目标是让一个 Agent 在单个工作区内可靠完成常规代码任务，并让用户能理解、控制和恢复这次任务的影响。

## 2. 为什么必须位于 Handoff 前

Handoff v1 计划携带权限 profile、Git/文件状态、已执行命令、测试结论、附件与 evidence。如果 Aibo 在生成 Handoff 时仍不能可靠采集这些信息，Handoff 只能转交消息摘要，之后还要反向修改 snapshot、artifact 和 provenance 契约。

Phase 4.5 因此先建立三类权威事实：

1. **执行事实**：Agent 实际获得了哪些权限、调用了哪些工具、命令结果是什么。
2. **变更事实**：一个 turn 前后哪些文件发生变化，哪些变化可归因于 Agent。
3. **恢复事实**：哪些 Agent 变更能够恢复，恢复是否会覆盖用户的后续修改。

Phase 5 应直接复用这些事实生成 Handoff，不再从对话文本猜测工作区状态。

## 3. 当前基线与缺口

### 3.1 已有基础

- Codex/Pi 真实会话、流式消息、停止、重启恢复和原生 binding。
- Codex 审批、thread 生命周期与工具事件投影。
- Pi SDK host、session tree、steer/follow-up、只读工具与无原生沙箱提示；4.5B 增加了可选的 Core 写入网关。
- 工作区 canonical path、信任状态与统一会话生命周期。
- 会话搜索、筛选、归档、时间线工具分组、usage 与错误重试。
- UI 领域投影、业务动作和基础视觉组件已分层。

### 3.2 必须补齐的缺口

| 能力域 | 当前限制 | Phase 4.5 目标 |
| --- | --- | --- |
| 执行配置 | Codex profile 固定；Pi 默认只读 | 会话级、可解释、可验证的执行 profile |
| 写入与命令 | Pi 无安全的可写/命令主链路 | 通过 Core 控制的写入、命令和审批边界 |
| 变更审阅 | 没有 Git 状态、diff 和本轮变更归属 | Changes 视图与 `TurnChangeSet` |
| 安全恢复 | 没有文件 checkpoint | 有冲突检测的 Agent 变更恢复 |
| 输入上下文 | Composer 主要接收纯文本 | 结构化文件/目录/图片引用与预算提示 |
| 输出呈现 | 代码、文件和 diff 仍偏文本化 | 安全 Markdown 与可操作 artifact 卡片 |
| 任务控制 | 缺少明确的 Plan/Edit 和任务进度 | 模式、计划、等待状态与队列控制 |
| 工程验证 | 没有稳定的项目动作入口 | 受控 Test/Lint/Build 等 project actions |

## 4. 范围与优先级

### 4.1 P0：进入 Phase 5 的硬门禁

1. Execution Profile 与 capability resolution。
2. Codex/Pi 安全的工作区写入和命令执行主链路。
3. Git/文件变更采集、按 turn 归属与 Changes 审阅视图。
4. Checkpoint、恢复预检和用户修改冲突保护。
5. 结构化上下文附件和安全 Markdown/代码/diff 呈现。
6. 模式、任务状态、等待状态和队列的统一投影。
7. 崩溃及应用重启后，profile、变更、checkpoint 和任务状态可恢复。

### 4.2 P1：应在 Phase 4.5 内完成的工作台体验

- 在系统终端、Finder 和已配置编辑器中打开工作区或文件。
- 可配置的 Test/Lint/Build project actions。
- 完成、失败、等待审批和等待用户输入的系统通知。
- 当前 instructions、skills、tools、MCP 与 adapter capability 检查器。
- 常用动作的命令面板和键盘快捷键。

P1 不得延误 P0 安全边界；如果工期需要收缩，可以把完整命令面板和系统通知移到 Phase 6，但 project actions 与能力检查器至少要有可用入口。

### 4.3 明确不做

- 完整代码编辑器、语言服务器或 IDE 替代品。
- 自动 commit、push、创建或合并 PR。
- 向 WebView 暴露通用 shell、任意文件系统或任意 Git 命令。
- Pi 容器/VM 隔离或对 Pi 宣称具备原生沙箱。
- 云端 Agent、后台自动化、多 Agent 团队编排。
- MCP/插件市场和任意第三方 adapter 动态安装。
- 通用 worktree 编排；只为未来并行隔离保留数据边界。

## 5. 核心契约

### 5.1 Execution Profile

新增版本化的 `ExecutionProfile`。用户选择的是 requested profile，Core 根据 adapter 和平台能力生成 resolved profile；UI 与审计记录必须展示实际 enforced 值和 unsupported 项。

最小语义：

```ts
type ExecutionProfileV1 = {
  schema: "aibo.execution-profile/v1";
  interactionMode: "ask" | "plan" | "edit";
  approvalPolicy: "never" | "on-request" | "trusted";
  filesystemPolicy: "read-only" | "workspace-write";
  commandPolicy: "disabled" | "approved" | "trusted";
  networkPolicy: "disabled" | "agent-managed";
  model?: string;
  reasoningEffort?: string;
};

type ResolvedExecutionProfileV1 = {
  requested: ExecutionProfileV1;
  enforced: ExecutionProfileV1;
  unsupported: string[];
  adapterCapabilities: string[];
  nativeSandbox: boolean;
  resolvedAt: string;
};
```

约束：

- profile 在新建会话时解析并保存快照，不能只保存当前全局设置引用。
- 运行中的 profile 变化必须是显式操作，并写入时间线和审计事件。
- adapter 不支持的配置不得静默降级。
- `plan` 必须保持只读；`edit` 才能请求写入或命令能力。
- 模型和推理强度只在 adapter 报告支持时显示。
- 历史会话迁移为 `legacy/read-only`，首次提升权限时重新确认。

#### Codex 映射

- 优先使用 Codex 原生 sandbox 与 approval policy。
- Aibo 显示 requested 与 Codex 实际接受的配置。
- Codex 拒绝或忽略某个配置时，会话不得伪装成已启用。

#### Pi 映射

- Pi 没有原生 OS 沙箱；`nativeSandbox=false` 必须持续可见。
- 不直接给 SDK host 暴露不受控的宿主机 shell。
- 可写文件工具和命令工具必须经过 Aibo Core 的工作区范围检查、审批与结果审计。
- 所有路径在操作时重新 canonicalize；必须防止 symlink 逃逸。
- “信任工作区”只允许加载和操作该工作区，不代表自动批准所有命令。

### 5.2 TurnChangeSet

每个产生文件影响的 turn 生成 `TurnChangeSet`：

```ts
type TurnChangeSetV1 = {
  schema: "aibo.turn-changeset/v1";
  workspaceId: string;
  sessionId: string;
  turnId: string;
  baseline: { head?: string; dirty: boolean; capturedAt: string };
  result: { head?: string; dirty: boolean; capturedAt: string };
  files: FileChangeRef[];
  commands: CommandRunRef[];
  verification: VerificationRef[];
  attribution: "agent" | "mixed" | "unknown";
};
```

要求：

- turn 开始前采集 baseline，结束、失败、中止和进程崩溃时均尝试采集 result。
- 同时提供“本轮变化”和“整个工作区变化”，两者不得混淆。
- 工作区在 turn 前已 dirty 时，保留文件和内容 hash，不能把旧修改归因于 Agent。
- 同一文件存在用户旧修改、Agent 修改或 turn 期间外部修改时标记 `mixed/unknown`。
- Git 不是必需条件；非 Git 工作区仍要提供受限的文件 change set。
- 大文件、二进制文件和超大 diff 外置为 artifact，仅在数据库保存元数据、hash 和引用。

### 5.3 Checkpoint

Checkpoint 只覆盖 Aibo 能确认由 Agent 产生的文件变化，不替代 Git：

- turn 开始前保存受影响文件的内容/hash/存在状态。
- 保存 Agent 操作完成后的内容/hash，用于恢复前冲突检查。
- 恢复前显示将创建、修改、删除的文件。
- 当前内容与 checkpoint 记录的 Agent 后状态不一致时默认拒绝覆盖。
- 用户可以取消恢复；P0 不提供“强制覆盖冲突”快捷操作。
- 恢复本身生成新的审计事件和 change set。
- 命令造成但无法可靠捕获的外部副作用明确标记为不可恢复。

### 5.4 Context Attachment

输入上下文不得只保存展开后的提示文本。最小引用类型包括：

- 单个文件或文件范围。
- 工作区内目录。
- 图片；仅在目标 adapter 支持时启用。
- 选中的 diff/change set。
- 文本片段。

每个 attachment 保存稳定 ID、workspace-relative path、发送时 hash、大小、媒体类型、来源和发送策略。发送前 UI 显示数量、大小/上下文估算、缺失文件、超限与不支持项。

Phase 4.5 的文件附件与 Phase 5 的 `@session` mention 使用不同类型；后续可以同时组合，但不得用同一个字符串解析器表示。

### 5.5 Artifact 与 Verification

`Artifact` 是可审阅、可引用的任务结果，包括：

- 文件 diff 或完整补丁。
- 命令输出。
- 测试、lint、build 报告及退出码。
- 大型工具输出。
- 图片或其他附件。

artifact 默认保存在 Aibo app data 的内容寻址存储中，不自动污染工作区。SQLite 保存 hash、媒体类型、大小、来源 session/turn/tool、创建时间和保留策略。

Phase 5 的 Handoff evidence 必须引用这些结构化记录，不能只引用 assistant 的文字结论。

## 6. UI 与交互计划

### 6.1 Composer

- 增加 Ask/Plan/Edit 模式选择；当前 enforced profile 可一键查看。
- 增加文件、目录、图片入口以及拖放区域。
- 附件以可删除的 context chip 呈现，不把绝对路径塞入输入框。
- 显示上下文估算和 adapter 不支持项。
- 发送前遇到权限提升、越界路径或不支持能力时阻止发送并解释原因。
- 保留发送、停止、Pi steer/follow-up；队列内容可查看、编辑和移除。

### 6.2 Timeline

- 使用经过清洗的 Markdown；禁止 Agent 输出执行 HTML、脚本或 Tauri IPC。
- fenced code 支持语言标识、复制和合理的长行滚动。
- 文件、命令、测试和 diff 使用结构化卡片，不从自然语言猜测状态。
- 明确显示 Agent 正在规划、读取、编辑、运行命令、等待审批或等待用户。
- profile 变更、checkpoint 恢复和 conflict 都写入 system event。

### 6.3 Inspector / Review

右侧检查器至少提供：

1. **上下文**：执行 profile、附件、Agent 能力和 workspace trust。
2. **变更**：整个工作区、本轮 turn、文件列表、diff/hunk 与 attribution。
3. **任务**：计划步骤、队列、命令及 verification。

Changes 视图支持安全的 stage/unstage 和按文件或 hunk 恢复，但不得默认执行。存在用户旧修改、混合归属或 checkpoint 冲突时必须提升确认等级。

### 6.4 外部工具入口

- 打开系统终端、Finder 和配置的编辑器。
- Project action 只执行已登记的命令模板；UI 不接受任意拼接命令。
- action 显示 cwd、完整 argv、权限要求和最近运行结果。

## 7. Rust Core、Adapter 与存储计划

### 7.1 Core 职责

- 解析 execution profile 和 capability，不信任 WebView 自报的 enforced 状态。
- 工作区路径、symlink、文件写入和命令审批的最终校验。
- turn baseline/result、Git/文件状态和 checkpoint 编排。
- artifact 内容寻址、大小限制、脱敏和保留策略。
- project action 执行、退出码和 stdout/stderr artifact。
- 向前端暴露细粒度 typed command，不提供通用 shell/文件读写接口。

### 7.2 Adapter 职责

- 报告自身支持的模型、模式、权限、输入和工具 capability。
- 把 resolved profile 映射到厂商原生配置。
- Codex 使用原生审批和 sandbox；Pi 工具调用转入 Aibo 受控边界。
- 输出统一的任务、工具、命令、文件和等待状态事件。
- 不负责决定 workspace trust，也不直接写 Aibo 的 checkpoint/artifact 表。

### 7.3 建议新增持久化对象

- `execution_profiles`
- `session_execution_snapshots`
- `context_attachments`
- `turn_change_sets`
- `file_changes`
- `checkpoints`
- `artifacts`
- `command_runs`
- `verifications`
- `project_actions`

具体表结构在首个 migration PR 前冻结。所有 durable object 必须有 schema/version、创建时间、workspace/session/turn 归属和删除策略。

## 8. 实施批次

### 当前进度

4.5A 已落地：

- 新增 `aibo.execution-profile/v1` JSON Schema、Rust/TypeScript 类型与 capability resolver。
- Codex/Pi 新建会话都会保存 requested/enforced profile、unsupported 项、adapter capabilities 和 native sandbox 标记。
- 新增 `resolve_execution_profile` 与 `get_session_execution_profile` typed Tauri command/API；Codex 的 model/reasoning profile 会映射到 `thread/start` 与 `turn/start`，不会只停留在 UI 快照。
- Codex 建立会话后会校验 Provider 返回的 approval、sandbox 与显式 model；发生权限或模型降级时会话失败并明确报错，不会继续展示为已启用。reasoning effort 按 `turn/start` 级别发送。
- Codex 的 `thread/start` 已由 resolved profile 驱动；Pi 默认只读，但 `edit + workspace-write` 会注册 Core 写入网关，并持续标记无原生沙箱。
- 历史会话读取 profile 时回退为 `legacy_session_profile_missing`，不会假装拥有新 profile。
- 覆盖默认 profile、Codex 可写请求、Pi 不支持能力、Plan 只读约束、非法值和 SQLite 持久化测试。
- Inspector 执行配置同时展示 requested → enforced 的模式、文件、命令、审批和网络策略。

当前自动化门禁：`cargo test` 52 项通过，`pnpm test` 39 项通过，`pnpm exec tsc --noEmit`、`pnpm build`、`cargo fmt --check` 和 `cargo clippy --lib -- -D warnings` 通过。

4.5B 核心链路已落地：新建会话入口已支持 Ask/Plan/Edit 三种交互模式；Plan 由 Core 强制保持只读。共享工作区边界守卫已覆盖绝对/相对路径、`..` 与 symlink 逃逸；Pi 的 `write` 与 `bash` 命令均通过 JSONL 请求回 Rust Core，按 profile、工作区信任和审批策略检查，输出限制大小并脱敏常见 secret，拒绝/超时不会绕过 Core；命令超时会绑定并终止子进程，避免超时后继续产生副作用。

4.5C 核心链路已落地：Codex/Pi turn 起止事件会采集工作区 baseline/result，按 Git 或受限文件遍历生成 `TurnChangeSet`，并持久化 `file_changes`；每个文件记录 turn 前是否已有 dirty 状态，避免无关用户修改阻塞 Agent 文件恢复。Git/快照中的同 hash 删除+新增会归并为带 `previousPath` 的 `renamed` 变更，避免审阅和恢复丢失源路径；重命名保留文件级恢复，hunk 操作会明确提示限制。Codex/Pi 命令的 command/cwd/exit code 元数据也已进入结构化记录，并对常见测试命令生成 verification 投影；命令输出以内容寻址 artifact 保存，Inspector 已支持本轮变更、Git 全局状态、命令/验证元数据、以 turn baseline 为基准的单文件 unified diff（不再把 HEAD 当作唯一基线），并将文本 diff 拆为可折叠 hunk；Core 还提供按 hunkIndex 重建并校验 patch 的 Git stage/unstage/revert 入口，未知归属、冲突和非 Git 工作区会拒绝破坏性操作，混合归属按文件边界保留可审阅操作。

4.5D 核心链路已落地：turn 开始时将可安全哈希的 baseline 内容持久化到 app data，并写入 `aibo.checkpoint/v1` 元数据（路径、hash、大小、基线 HEAD、基线 dirty 归属与可用存储引用）；`list_turn_checkpoints` typed command/API 与 Inspector 可显示本轮 checkpoint 的可恢复比例。Git 与非 Git 工作区均可恢复可验证文件。当前内容发生后续修改、baseline 不可确认或大文件无法哈希时，Core 在写入前阻止恢复，并覆盖恢复成功、冲突阻止、写入回滚与重启安全元数据测试；每次恢复尝试还会写入 `aibo.restore-operation/v1` 结构化审计记录，可按 session/turn 查询，时间线保留人类可读投影。应用重启时会依据仍处于 running 的 turn 与 checkpoint 重建 `unknown` attribution 的变更集，并明确标记结果可能包含崩溃后的用户修改。

4.5E 核心链路已落地：Core 已注册工作区范围内的文件/目录上下文引用，保存 workspace-relative path、hash、大小、媒体类型、来源和发送策略；Composer 以可删除 chip 展示引用和上下文大小估算，发送前重新校验文件是否缺失/变化，turn 开始时由 Core 将外部 turn ID 解析为内部 turn ID 后绑定附件归属并追加结构化 attachment block，切换会话与重启后仍可恢复；当前 Codex/Pi 未声明图像输入 capability，图片附件会在发送前明确阻止而不会静默丢弃。消息呈现已增加无 HTML 执行能力的轻量 Markdown、代码块和安全链接。命令及审批预览在 timeline、事件和 artifact 中统一脱敏；命令输出已按 `aibo.artifact/v1` 写入 app-data 内容寻址存储，并可在 Inspector 中按 session/turn 查看和展开读取元数据/内容。Pi steer/follow-up 队列已统一投影为会话级状态，显示在输入区上方，可一键清空，切换/新建会话时清理，避免队列信息串线。

4.5F 核心链路已落地：工作区条目提供受控的 Finder/文件管理器、系统终端和已配置编辑器入口，目标只接受固定枚举，不向 WebView 暴露任意 shell；Inspector 已提供工作区级 argv 结构化的 Test/Lint/Build/Custom 工程动作注册、运行、结果保留和 300 秒超时边界，并展示当前 adapter capability 与 unsupported 检查结果。即使未选中会话，当前工作区仍可查看工程动作和本机 Agent 能力检查。能力检查器现在还会扫描工作区指令文件、Skills 目录、Core 工具与 MCP 配置，仅呈现名称和来源，不读取或暴露配置中的凭据。编辑器入口使用 `AIBO_EDITOR` 环境变量，并以参数方式传递工作区路径。新增 `⌘/Ctrl+K` 命令面板和 `⌘/Ctrl+N`、`⌘/Ctrl+I` 快捷键，复用既有业务控制器执行新会话、聚焦输入、刷新、设置、归档和清空 Pi 队列。

启动和运行时恢复核心链路已落地：适配器进程在应用运行期间退出时，Core 会立即将 active turn 标记为 `interrupted`、残留 streaming/queued message 标记为 `failed`，并继续采集可用的 result change set；应用启动时再依据持久化 checkpoint 为仍处于 running 的 turn 重建 `unknown` attribution 的变更集，将未归档但仍处于启动、运行或待审批状态的 stale session 与 running turn 统一标记为 `interrupted`，process run 标记为 `crashed`，避免重启后伪造运行状态；相关 SQLite 回归测试已覆盖。

运行时崩溃边界还覆盖了 provider 在 `turn/start` 响应与内存 turn 绑定之间退出的竞态：Codex/Pi 会从数据库回退查找最新 running turn，并清理其 streaming/queued 消息。命令输出与 diff 的截断均按 UTF-8 字符边界执行，避免多字节文本触发错误或超过审计上限。

当前验收状态：G0–G4 的 Core/fixture/数据库回归门禁已覆盖，其中依赖真实 Provider 的 Codex workspace-write 与 Pi 受控写入仍需在 macOS 认证会话中补做；Pi SDK host 协议探针在 macOS arm64 通过。命令面板和常用快捷键已补齐。系统级通知仍保留在 P1/Phase 6 取舍中，当前使用置顶、自动消失的应用内通知；G5 真实 Codex/Pi 任务仍待在已认证的 Provider 会话中执行，不能用离线 fixture 代替。

### 4.5A：契约、能力解析与存储骨架（3–4 天）

- 冻结 ExecutionProfile、ResolvedCapability、TurnChangeSet、Checkpoint、Attachment 和 Artifact v1。
- 新增 migration、Rust/TypeScript 类型和 adapter capability 扩展。
- 为历史会话建立只读兼容迁移。
- 设置页增加默认 profile；会话显示 profile 快照。

退出条件：Codex/Pi fixture 能解析同一份 requested profile，并明确返回 enforced/unsupported；重启后 profile 快照不漂移。

### 4.5B：安全执行主链路（4–7 天）

- Codex 改为 capability 驱动的 sandbox/approval 配置。
- 为 Pi 建立 Aibo 控制的 read/write/command 工具边界。
- 完成路径范围检查、命令审批、拒绝、中止和日志脱敏。
- 统一 Ask/Plan/Edit 与等待状态。

退出条件：两个 Agent 都能在临时可信工作区完成一次受控编辑和测试；拒绝写入/命令后没有副作用，越界和 symlink 逃逸被阻止。

### 4.5C：变更审阅与 Artifact（4–6 天）

- turn baseline/result 和 `TurnChangeSet`。
- Git status、文件列表、diff/hunk 和本轮/全局范围。
- 命令、测试和大输出 artifact 化。
- Changes/Task UI 与外部文件入口。

退出条件：用户能准确审阅本轮 Agent 修改和验证证据；dirty 工作区旧修改不会被误归因或隐藏。

### 4.5D：Checkpoint 与恢复（3–5 天）

- Agent 变更前后内容/hash 捕获。
- 恢复预览、冲突检测、恢复审计和重启恢复。
- 覆盖新增、修改、删除、二进制和大文件边界。

退出条件：无冲突时可恢复一轮 Agent 修改；存在用户后续编辑时默认拒绝覆盖，且恢复失败不会留下半恢复状态。

### 4.5E：上下文与消息呈现（3–5 天）

- 文件/目录/图片 attachment 与上下文估算。
- 安全 Markdown、代码块、文件、diff、命令和测试卡片。
- 队列、任务计划与明确等待状态。

退出条件：输入上下文可追溯并在重启后恢复；恶意 Markdown 不能执行；不支持的图片/模型/模式不会静默丢弃。

### 4.5F：工程动作与 macOS 总验收（2–4 天）

- Project actions、系统终端/Finder/编辑器入口。
- 工程动作和能力检查器应在未选中会话时仍可从当前工作区使用。
- 通知、能力检查器及必要快捷键。
- 完整自动化回归和真实 Codex/Pi macOS smoke。
- 固化验收 fixture、报告和已知限制。

退出条件：第 10 节全部 P0 门禁通过，并形成可供 Phase 5 使用的稳定 artifact/provenance 输入。

新增估算：**19–31 个工程日**，以 1 名熟悉 TypeScript/Rust 的工程师为基线。实现 Pi 受控工具边界和跨平台 Git 行为后需要二次估算。

## 9. 测试策略

### 9.1 离线自动化门禁

- ExecutionProfile requested/enforced/unsupported contract tests。
- Codex/Pi adapter fixture 回放和 capability negative cases。
- 路径 traversal、symlink 逃逸、工作区外读写和命令拒绝测试。
- Git clean/dirty/untracked/renamed/deleted/binary/large-file fixtures。
- 同文件旧修改、Agent 修改和外部并发修改的 attribution 测试。
- Checkpoint 创建、恢复、冲突、进程中断和半失败回滚测试。
- Attachment 缺失、变更、超限、不支持和重启恢复测试。
- Markdown XSS、危险链接、超长代码和超大工具输出测试。
- migration 重复执行、旧数据库升级和 artifact 丢失降级测试。
- 旧 generation、重复事件和跨 session 串线回归。

常规命令门禁：

```bash
pnpm test
pnpm build
pnpm exec tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
```

### 9.2 macOS 本机集成门禁

使用专门的可丢弃 Git fixture 工作区，至少包含：

- 一个可通过和可失败的测试命令。
- tracked clean 文件、预先 dirty 文件和 untracked 文件。
- 指向工作区外的 symlink。
- 二进制文件与超过 inline 限额的大文件。
- 可安全创建、修改、删除的测试文件。

所有真实 smoke 禁止使用 Aibo 仓库自身作为破坏性测试目标。

### 9.3 真实 Agent 门禁

Codex 和 Pi 分别执行同一组任务：

1. Plan 模式分析任务，确认没有文件或命令副作用。
2. Edit 模式修改指定文件并运行测试。
3. 审批一个允许命令，拒绝另一个命令，确认结果和状态正确。
4. 查看本轮 diff、命令、退出码与测试结论。
5. 恢复本轮修改，确认工作区回到预期状态。
6. 制造恢复冲突，确认 Aibo 阻止覆盖用户后续修改。
7. 在 turn/工具执行中退出应用，重启后检查状态、change set 和 checkpoint。

外部 provider 或网络不可用时，可以先通过离线门禁，但不能把 fixture 通过记为真实 Agent 验收完成。

## 10. Phase 4.5 验收清单

### G0：执行与权限

- [x] 新会话明确显示 interaction mode、approval、filesystem、command、network 与 sandbox 状态。
- [x] requested、enforced 和 unsupported 可区分，adapter 不会静默降级。
- [x] Plan 模式不能写文件或执行有副作用命令。
- [ ] Codex workspace-write/on-request 在 macOS 真实会话中生效。
- [ ] Pi 通过 Aibo 受控工具完成写入和命令，UI 仍明确标注无原生沙箱。
- [x] 拒绝审批、中止 turn、adapter crash 后不会继续执行待审批动作。
- [x] 工作区外路径、`..`、绝对路径越界和 symlink 逃逸均被拒绝。

### G1：变更与审阅

- [x] 每个终止态 turn 都有 baseline/result，采集失败有明确状态。
- [x] Changes 可切换“本轮”和“整个工作区”。
- [x] 文件新增、修改、删除、重命名、二进制和大文件显示正确。
- [x] turn 前已有 dirty/untracked 内容不会被归因给 Agent。
- [x] diff/hunk、命令 argv、cwd、退出码和 verification 可追溯到 session/turn。
- [x] stage/unstage/revert 使用细粒度 Core command，失败不破坏工作区。

### G2：Checkpoint 与恢复

- [x] Agent 修改文件前创建可验证 checkpoint。
- [x] 恢复前可以预览影响范围并取消。
- [x] 无冲突恢复覆盖新增、修改和删除场景。
- [x] 用户后续修改造成 hash 不一致时默认拒绝恢复。
- [x] 恢复中断或失败不会产生不可解释的半恢复状态。
- [x] 应用重启后 checkpoint、artifact 和 change set 仍可读取。
- [x] 恢复尝试可在 Inspector 中按状态查看恢复、冲突和不可用文件统计。

### G3：上下文、输出与任务控制

- [x] 可以附加工作区内文件和目录，并在发送后保留结构化引用。
- [x] 图片、模型和推理强度按 adapter capability 显示。
- [x] 缺失、变化、超限和不支持的附件在发送前给出明确处理结果。
- [x] Markdown、代码、diff、命令和测试结果安全且可操作。
- [x] fenced code 显示语言标识，支持复制，长行在代码块内部滚动。
- [x] Agent 输出无法执行 HTML、脚本、危险协议或 Tauri IPC。
- [x] planning/running/waiting approval/waiting user/completed/failed/interrupted 状态一致。
- [x] Pi steer/follow-up 队列可查看和管理，重启后状态不伪造。
- [x] 工作区能力检查器可列出指令文件、Skills、Core 工具和 MCP server 名称，不暴露配置内容。

### G4：回归与持久化

- [x] Phase 1–4 的会话、审批、Pi tree、归档、恢复和事件隔离测试继续通过。
- [x] Codex/Pi 在同一工作区的并行会话不会串 profile、事件、artifact 或 checkpoint。
- [x] 应用异常退出后，运行中 turn 被标为 interrupted，不被误报 completed。
- [x] 旧数据库可迁移；历史会话默认保持只读兼容。
- [x] 日志、数据库和 artifact 元数据不保存 auth token 或未脱敏 secret。

### G5：真实 macOS 端到端

- [ ] Codex 完成“附加上下文 → 修改 → 测试 → 审阅 → 恢复 → 重启恢复”。
- [ ] Pi 完成同等流程，并验证批准/拒绝与无原生沙箱提示。
- [ ] 两个 Agent 都完成一次测试失败后修复并重新验证的任务。
- [ ] 使用预先 dirty 的 fixture 工作区验收，没有用户修改丢失。
- [ ] 使用工作区外 symlink 验收，没有越界读取或写入。
- [ ] 真实 smoke 的 Agent 版本、模型、profile、HEAD、结果和时间被记录。

## 11. Phase 5 准入条件

只有同时满足以下条件，才把 Phase 4.5 标记为完成并进入 Handoff 实现：

1. G0–G4 自动化与本机门禁全部通过。
2. G5 中 Codex 和 Pi 的真实端到端各至少通过一次；外部服务故障必须明确记录，不能用 fixture 替代。
3. Aibo 能为最后一个已完成 turn 提供稳定的 resolved profile、change set、verification、checkpoint 与 artifact 引用。
4. dirty workspace、混合归属、checkpoint conflict 和缺失 artifact 均有机器可读状态。
5. 没有已知路径越界、静默权限降级、用户修改丢失或跨会话串线问题。
6. Phase 5 的 `SessionSnapshot v1` 能直接引用上述事实，不需要解析自然语言消息来重建工作区状态。

若某项 capability 在特定 Agent 上无法实现，可以标记为 `unsupported`，但不能把 Phase 4.5 标记完成，除非它不影响该 Agent 完成“编辑—验证—审阅—恢复”主链路，并已在 UI、契约和验收报告中明确记录。

## 12. 验收证据模板

当前 macOS 自动化与协议探针记录见 [Phase 4.5 macOS 验收记录](phase-4.5-macos-smoke-report.md)；其中 G5 真实 Provider 任务仍保持 pending。

每次真实 smoke 保存一份脱敏报告：

```markdown
# Phase 4.5 macOS smoke

- 日期：
- Aibo commit：
- macOS / arch：
- Agent / version：
- model：
- fixture HEAD：
- requested profile：
- enforced profile：

## 场景结果

| 场景 | 结果 | session/turn | artifact/checkpoint | 备注 |
| --- | --- | --- | --- | --- |
| Plan 只读 | pass/fail | | | |
| Edit + test | pass/fail | | | |
| 审批允许/拒绝 | pass/fail | | | |
| Changes 审阅 | pass/fail | | | |
| 无冲突恢复 | pass/fail | | | |
| 冲突保护 | pass/fail | | | |
| 崩溃/重启恢复 | pass/fail | | | |
| 越界与 symlink | pass/fail | | | |

## 自动化门禁

- pnpm test：
- pnpm build：
- tsc --noEmit：
- cargo test：

## 已知限制

- 当前 macOS 环境的 Pi SDK host 协议探针通过；受限执行环境禁止 SDK 在已登录的 `~/.pi/agent/auth.json` 旁创建锁文件，导致真实 smoke 最终表现为 `No API key found`。Codex app-server 探针同样因运行环境无法初始化 `~/.codex` 状态目录退出。两者均不能记为 G5 真实通过。
- Pi 没有原生 OS sandbox，界面和 resolved profile 持续标记 `nativeSandbox=false`；写入与命令必须经过 Aibo Core 网关。
- 重命名文件保留源路径并支持整轮安全恢复，但暂不提供 hunk 级 Git 操作。
- 系统级通知暂未接入，当前使用置顶、自动消失的应用内通知；可在 Phase 6 接入平台通知适配器。
- Windows 仍是后续验证门，不能用 macOS 结果替代 Windows 平台验收。
```

报告中不得包含认证信息、完整用户主目录、敏感文件内容或未脱敏的原始 provider payload。

## 13. 完成定义

Phase 4.5 完成意味着：Aibo 已经可以作为一个本地常规 Agent 工作台，让 Codex 和 Pi 在明确的权限边界内接收结构化上下文、修改和验证代码，并让用户审阅、拒绝、恢复和追踪结果。

完成不意味着 Aibo 已经具备完整 IDE、强制 OS 隔离或自动 Git 交付能力。Phase 5 将在这个可靠任务闭环之上实现跨 Agent 的不可变 Handoff，而不是用 Handoff 补偿工作台本身缺失的执行与证据能力。
