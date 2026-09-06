# Phase 4.6：Agent 工作台控制与交互补全

> 状态：实施中（4.6A–4.6C 已接入，4.6D 状态/预算/草稿首批能力已接入）；实施顺序已冻结
> 平台：macOS arm64 首发基线；Windows 在 macOS 验收后验证
> 前置：[Phase 4.5 常规 Agent 工作台能力补全](phase-4.5-agent-workbench-completion.md) 的 G0–G4 自动化门禁，以及可用的 Codex/Pi macOS 认证会话
> 后续：Phase 5 `@` 与 Handoff v1

## 1. 阶段定位

Phase 4.5 已经建立了执行 profile、受控写入、变更审阅、checkpoint、上下文附件和工程动作等基础能力。当前影响日常使用效率的缺口集中在输入区：用户可以选模型，却不能方便地调节推理强度；`/` 命令只能按名称查找，不能按来源组织；Codex 的 Skills、原生 Plan 和 Goal 尚未成为可发现、可操作的工作台能力；Agent 长时间运行时，状态、草稿和上下文预算仍不够可靠。

Phase 4.6 不增加新的 Agent，不改变 Phase 4.5 的权限边界，也不提前实现 Handoff。它把已有 adapter 能力整理成统一的工作台控制面：

```text
选择模型与推理强度
  -> 通过分类命令发现 Agent / Skills / Extension
  -> 使用 Plan、Goal 或 Agent 提问控制任务
  -> 持续看到真实运行状态、上下文和草稿
  -> 在下一条 turn 中得到可验证的配置结果
```

## 2. 目标与非目标

### 2.1 目标

1. 为 Codex/Pi 提供会话级模型与推理强度选择，展示 adapter 实际支持和生效的值。
2. 将 `/` 命令统一为可分类、可搜索、可键盘操作的命令面板，分类固定为“全部、Agent、Skills、Extension”。
3. 发现并接入 Codex 原生 Skills、Plan 和 Goal；Pi 能力不足时明确显示 `unsupported`，不模拟成功。
4. 统一 Agent 工作状态、等待用户输入、等待审批、工具调用和长时间无事件的提示。
5. 保存会话草稿与附件引用，降低切换会话、重启或发送失败造成的输入丢失。
6. 让上下文预算、压缩状态和消息发送结果可解释，为 Phase 5 的结构化 mention 预留接口。

### 2.2 非目标

- 不把 Aibo 变成代码编辑器、终端或完整 IDE。
- 不实现新的 Agent adapter、远程 Agent 或多 Agent 编排。
- 不把任意 `/` 文本直接当作本地 shell、文件系统或 Git 操作执行。
- 不将 Skills 配置文件、MCP 配置或认证信息的内容展示给 WebView。
- 不在本阶段生成或消费 Handoff；`@` 的稳定引用仍由 Phase 5 负责。
- 不持久化或展示模型未向用户公开的隐藏推理内容。

## 3. 当前缺口与设计结论

| 缺口 | 现状 | P4.6 结论 |
| --- | --- | --- |
| 推理强度 | Codex turn 可传 `effort`，Pi 有 thinking API，但入口分散 | 模型菜单同时承载模型和推理强度；配置属于当前会话的下一条 turn 默认值 |
| 命令发现 | 仅按名称前缀过滤，动态命令来源混在一起 | 建立统一命令注册表和四类筛选，保留来源、能力和执行方式 |
| Codex Skills | `model/list` 已接入，Skills 未进入命令候选 | 按当前工作区调用 `skills/list`，只展示元数据和启用状态 |
| Plan | Aibo 有只读交互模式，但不等于 Codex 原生协作模式 | 通过 adapter capability 映射原生 Plan；Aibo 的权限约束仍是最终边界 |
| Goal | 没有持久目标入口 | 对 Codex 暴露 `thread/goal/set/get/clear` 的会话级控制 |
| 运行反馈 | 有部分运行提示，但工具间隔或无流式输出时容易变成空白 | 状态由事件和超时推导，必须显示最近活动与等待原因 |
| 输入可靠性 | 草稿主要是组件状态 | 按会话保存草稿、附件和发送失败后的可恢复状态 |

Codex App Server 的 `model/list` 返回模型支持的推理等级，`skills/list` 用工作区目录发现 Skills，`collaborationMode/list` 提供协作模式，`thread/goal/set/get/clear` 管理持久目标。实现应优先调用这些协议，而不是解析 CLI 输出或复制 TUI 行为。[Codex App Server](https://learn.chatgpt.com/docs/app-server)

## 4. 范围与优先级

### P0：必须完成

- 4.6A 模型与推理强度。
- 4.6B 分类命令面板和统一命令注册表。
- 4.6C Codex Skills、Plan、Goal 的 capability 驱动接入。
- 所有配置成功/失败、unsupported 和 provider 拒绝都能在当前会话中解释。

### P1：与 P0 同批完成或紧随其后

- 4.6D Agent 状态、用户提问、草稿、上下文预算和压缩入口。
- macOS 真实 Codex/Pi 回归和重启恢复验证。

P1 不得改变 P0 已冻结的协议和持久化契约。若时间需要收缩，可以先交付状态、草稿和预算的只读投影，但不能删除发送失败恢复和等待状态。

## 5. 统一能力与数据契约

### 5.1 Adapter capability

每个 adapter 必须报告细粒度 capability，前端只根据 capability 显示入口：

```ts
type AgentWorkbenchCapabilitiesV1 = {
  modelCatalog: boolean;
  reasoningEfforts: boolean;
  skills: boolean;
  nativePlan: boolean;
  goals: boolean;
  userInputRequests: boolean;
  contextUsage: boolean;
  draftResume: boolean;
};
```

能力值表示“可以调用并得到可验证结果”，不能仅表示某个 UI 控件存在。能力缺失统一显示为 `unsupported`，并记录 adapter、版本和检查时间。

### 5.2 模型与推理强度

扩展现有模型目录：

```ts
type SessionReasoningOptionV1 = {
  id: string;
  label: string;
  description?: string;
};

type SessionModelOptionV1 = {
  reference: string;
  label: string;
  provider?: string;
  id: string;
  description?: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  reasoningEfforts: SessionReasoningOptionV1[];
};

type SessionModelSelectionV1 = {
  model: string;
  reasoningEffort?: string;
  source: "session-default" | "turn-override";
  resolvedAt: string;
};
```

约束：

- 模型列表打开时自动加载当前会话的实际模型，不显示“默认模型”占位文字。
- 推理强度只显示当前模型支持的选项；模型切换后若当前等级不兼容，回退到 provider 返回的默认等级并提示用户。
- 修改模型或推理强度只影响当前会话及后续 turn，不刷新工作区和会话列表。
- 发送中的 turn 不允许修改其快照；修改在下一条 turn 生效，并在时间线记录一次配置变更。
- provider 拒绝配置时保留旧值，显示错误原因，不更新本地“已生效”状态。
- Codex 将选择映射到 `turn/start` 的 `model` 和 `effort`；Pi 通过 SDK host 的 model/thinking 接口映射。
- 当前生效值、请求值和不支持项必须分别显示，不能把 requested 当成 enforced。

### 5.3 命令注册表

命令候选使用统一结构：

```ts
type AgentCommandCategory = "agent" | "skill" | "extension";
type AgentCommandExecution = "aibo" | "adapter" | "prompt";

type AgentCommandV1 = {
  id: string;
  name: string;
  aliases?: string[];
  description: string;
  category: AgentCommandCategory;
  source: "builtin" | "workspace" | "user" | "extension";
  execution: AgentCommandExecution;
  agent: "codex" | "pi" | "both";
  enabled: boolean;
  argumentHint?: string;
  capability?: string;
};
```

分类语义固定为：

- **全部**：当前 Agent 可用的所有候选。
- **Agent**：Aibo 内置工作台动作和 Agent 原生控制命令，例如 `/model`、`/thinking`、`/plan`、`/goal`、`/compact`。
- **Skills**：当前工作区、用户目录和 adapter 发现的 Skill 命令；只展示名称、短描述、来源和 enabled 状态。
- **Extension**：Pi 扩展、Codex 插件或未来注册的外部命令。

筛选规则：先按分类筛选，再按当前 token 做不区分大小写的名称、别名和描述匹配；候选为空时显示当前分类和刷新入口。分类选择在打开面板期间保持，切换会话时回到“全部”。键盘支持 `Tab`/`Shift+Tab` 切换分类、上下键选择、Enter 执行、Esc 关闭；鼠标点击和键盘执行必须走同一命令分发器。

执行规则：

- `aibo` 命令调用既有业务控制器，不把命令文本发给 Agent。
- `adapter` 命令调用 typed adapter API，并把结果投影到时间线或通知。
- `prompt` 命令只在 adapter 明确支持时插入规范化 prompt；不得把任意命令名拼接进 shell。
- 同名命令按 `source` 和 `agent` 去重；若仍有冲突，在候选中显示来源。
- 动态命令加载失败不清空内置命令，错误只显示在面板的刷新状态中。

### 5.4 Skills

Codex 会话按当前工作区调用 `skills/list`，支持缓存和显式刷新；Pi 继续使用 SDK host 已有的命令/Skill 枚举。Skill 元数据最低包含名称、短描述、来源、路径是否可见和 enabled 状态，禁止返回 `SKILL.md` 全文、脚本内容、MCP URL 中的凭据或环境变量值。

选择 Skill 后，adapter 决定使用结构化 skill invocation 还是规范化 prompt。Aibo 必须保存“用户选择了哪个 Skill”这一可审计元数据，并在不支持该 Skill 时阻止发送或明确降级为普通文本。

### 5.5 Plan 与 Goal

Plan 是交互模式和 Agent 原生协作模式的组合：

- Aibo 的 `plan` profile 始终强制只读，这是安全底线。
- Codex 支持时，调用 `collaborationMode/list` 发现可用模式，并在 `turn/start` 传递选中的 mode。
- Pi 没有对应原生能力时，保留 Aibo 只读 Plan 语义，UI 标记“由 Aibo Core 约束”，不伪造 Pi 原生 Plan。
- Plan 产生的计划文本仍是可见消息或结构化 plan item，不把隐藏推理当作计划。

Goal 是会话级持久任务：

```ts
type AgentGoalV1 = {
  sessionId: string;
  objective: string;
  status: "active" | "paused" | "completed" | "cleared" | "unknown";
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  updatedAt: string;
};
```

Codex 使用 `thread/goal/set/get/clear`，目标变更写入时间线并在会话标题区显示简短状态。Goal 不能绕过权限、审批、workspace trust 或 turn 状态；清除目标不删除历史消息和 artifacts。Pi 的 Goal 入口只有在 host 提供等价 capability 时才显示。

## 6. 分批实施计划

### 4.6A：模型与推理强度（2–3 天）

- 扩展模型目录和 execution profile 的 reasoning 字段。
- 完成 Codex/Pi 当前值读取、候选值映射和下一 turn 生效语义。
- 将模型弹框改为“模型 + 推理强度”双层选择，并展示 requested/enforced。
- 覆盖切换模型、切换强度、provider 拒绝、会话切换和重启恢复。

退出条件：用户无需输入 `/thinking` 即可查看和修改当前会话推理强度；选择结果不会串到其他会话。

### 4.6B：分类命令面板（2–4 天）

- 建立统一注册表、来源分类、能力过滤和去重规则。
- 实现“全部 / Agent / Skills / Extension”分类栏、搜索、键盘导航和空状态。
- 将 Aibo 内置命令和现有 Pi 动态命令迁移到注册表。
- 为 Codex/Pi 各自添加命令执行适配，不改变已有命令的业务语义。

退出条件：同一输入在鼠标和键盘路径上结果一致；切换会话、动态加载失败和不支持 capability 都有稳定行为。

### 4.6C：Skills、Plan、Goal（3–5 天）

- 接入 Codex `skills/list`、`collaborationMode/list` 和 Goal API。
- 将工作区 Skills、用户 Skills 和 Extension 元数据投影到命令面板。
- 将 Plan/Goal 状态接入时间线、会话标题和恢复流程。
- 设计 Pi 的 unsupported 显示和 capability 负向测试。

退出条件：至少一个真实 Codex Skill、Plan 和 Goal 完成发现、执行、重启恢复；不支持的 Pi 入口不会产生假成功。

### 4.6D：状态、提问、草稿与上下文（4–6 天）

当前实现进度：

- 已接入统一的运行状态文案：准备响应、生成回复、执行工具、等待审批、重试、压缩上下文和压缩后等待；压缩状态通过事件活动投影展示，不改变现有数据库状态约束。
- 已接入最近活动计时：连续 15 秒没有新的 Agent 事件时，在当前活动文案后显示已等待时长；计时只反映前一条真实事件，不发送或伪造心跳。
- 已接入会话级草稿恢复、发送失败标记和本地上限清理；附件仍复用 Phase 4.5 的会话附件存储。
- 已接入上下文用量只读投影；provider 只报告累计输入用量时明确标注“估算”，Pi 空闲时提供压缩入口。
- Codex `item/tool/requestUserInput` 已接入真实双向应答：支持最多 3 个问题、选项/补充文本；“取消”通过停止当前 turn 实现，并依靠 `serverRequest/resolved` 清理请求；Pi 没有等价 capability 时不显示该入口。
- SQLite `composer_drafts` 已接入桌面端，并限制保留最近编辑的 200 个会话；localStorage 继续作为 Web 预览和数据库异常时的 fallback。

- 统一 `working / using-tool / waiting-approval / waiting-user / compacting / completed / failed / interrupted` 状态。
- 新增用户输入请求卡片，支持选项、补充文本、取消和超时；回答绑定原 turn。
- 按会话保存草稿、附件引用、光标无关的发送状态和失败重试标记。
- 展示精确 usage 或“估算”标记，提供压缩入口和压缩结果。
- 长时间无事件时显示最近活动时间、等待原因和重试/停止入口。

退出条件：切换会话和重启不丢草稿；Agent 等待用户时输入区不会误报为空闲；发送失败可以恢复编辑并重试。

### 4.6E：macOS 总验收（2–3 天）

- 使用可丢弃 fixture 工作区分别验证 Codex/Pi。
- 记录 Agent 版本、模型、推理强度、profile、Skill、Goal、turn 和恢复结果。
- 复跑自动化门禁与真实 provider smoke；Windows 只做后续兼容性验证。

本轮 macOS 验证记录（2026-09-06）：

- Codex transport：通过 `initialize`、`thread/list`。
- Codex smoke：通过真实 turn、usage 事件和 `thread/resume`；审批 smoke 也收到并解析了请求/完成事件。
- Codex fork/archive/unarchive：fork、archive 通过；unarchive 后的 `thread/list` 未及时返回子线程，保留为 provider 兼容性待复测项，不视为 Aibo UI 已通过。
- Pi SDK host：协议初始化、命令发现和 session tree 检查通过；真实 turn 因当前选中 provider 没有 API key 被 host 明确拒绝，待完成 `/login` 或配置对应凭据后复测。

## 7. 持久化与事件要求

新增或扩展的数据必须带 schema/version、workspace/session/turn 归属、时间戳和清理策略：

- `session_model_selection`：当前会话的 requested/enforced model 与 reasoning effort。
- `agent_goals`：Goal 当前状态和 provider binding；历史变更保留在 timeline event。
- `composer_drafts`：会话草稿、附件引用、更新时间和失败发送状态。
- `agent_command_catalog_cache`：按 adapter、workspace、catalog version 缓存元数据；缓存失效不影响内置命令。

事件至少包括 `model.changed`、`reasoning.changed`、`command.executed`、`skill.selected`、`goal.updated`、`user_input.requested`、`draft.restored`。事件 payload 只保存结构化元数据，不保存 token、完整 Skills 配置、未脱敏命令输出或隐藏推理。

## 8. 测试与验收矩阵

### 8.1 离线自动化

- Codex model catalog 含多个推理等级、默认等级和不兼容等级。
- Pi thinking catalog 的读取、修改、拒绝和恢复。
- 命令分类、别名匹配、来源去重、键盘导航和动态加载失败。
- Codex Skills 正常、空结果、缓存和错误响应。
- Plan/Goal API 正常、unsupported、重复事件和旧 generation。
- Goal、草稿、附件和模型选择的 SQLite migration 与重启恢复。
- waiting-user、waiting-approval、长时间无事件和 adapter crash 的状态投影。
- 发送失败后的草稿保留与重复发送防护。

### 8.2 macOS 真实门禁

Codex 与 Pi 各执行一次：

1. 切换模型和推理强度，发送消息并确认下一条 turn 使用实际值。
2. 从四个命令分类中发现并执行一个内置命令和一个 Skill。
3. Codex 设置 Plan 和 Goal，重启应用后确认状态恢复；Pi 对 unsupported 能力显示明确结果。
4. 运行一个包含工具调用、长等待和审批的任务，确认状态文案连续且不提前变成空闲。
5. 在发送失败、切换会话和重启后恢复草稿、附件和重试入口。

### 8.3 验收门禁

- [ ] 模型、推理强度和 profile 的 requested/enforced/unsupported 可区分。
- [ ] `/` 面板提供四类筛选、搜索、键盘操作和来源信息。
- [ ] Codex Skills、Plan、Goal 至少有一条真实 provider 证据。
- [ ] Pi 不支持能力不会显示为可执行成功。
- [ ] Agent 工具调用、等待审批、等待用户和长时间无事件状态连续可见。
- [ ] 草稿、附件和 Goal 在重启后可恢复，且不跨会话串线。
- [ ] 旧 Phase 1–4.5 自动化门禁全部通过。
- [ ] macOS 真实验收报告脱敏保存，不包含认证信息或完整用户目录。

## 9. 风险与处理

| 风险 | 处理 |
| --- | --- |
| Codex/Pi 版本对命令、Skills 或 Goal 支持不同 | 启动时探测 capability；版本与 unsupported 原因写入诊断，不用静态假设覆盖真实结果 |
| 推理等级名称和语义变化 | 保存 provider 原始 ID 与显示名称；不把 low/medium/high 跨 provider 强行等同 |
| 动态 Skills 目录包含敏感内容 | 只读取协议规定的元数据；展示前做路径和字段白名单校验 |
| Goal 持续运行与应用重启竞态 | 以 adapter 返回的状态为权威；启动恢复时标记未知，不凭 UI 状态自动续跑 |
| 长时间无事件被误判为失败 | 使用最近活动时间和可配置阈值提示，只有 adapter 明确终止才进入 failed |
| 草稿与附件占用增长 | 限制单会话大小，过期草稿可清理，附件继续复用 Phase 4.5 artifact/attachment 保留策略 |

## 10. 完成定义与 Phase 5 准入

Phase 4.6 完成意味着：Aibo 能让用户在同一个工作台内发现并控制模型、推理强度、Agent 命令、Skills、Plan 和 Goal，并在任务运行期间持续知道 Agent 正在做什么、等待什么以及如何恢复。

进入 Phase 5 前必须满足：

1. 4.6A–4.6C 的 P0 验收全部通过，且至少 Codex 的 Skills、Plan、Goal 有真实 macOS 证据。
2. 模型选择和命令执行不绕过 Phase 4.5 的 profile、trust、审批、artifact 和审计边界。
3. 结构化命令、Skill、Goal 和状态事件可被未来 `SessionSnapshot v1` 直接引用，不需要从自然语言重建。
4. Codex/Pi 会话切换、应用重启、adapter 重启和 provider 错误不会造成配置、草稿或状态串线。
5. 4.6D 的 P1 功能至少完成草稿恢复、等待状态和发送失败恢复；上下文预算和压缩可在能力不足时明确显示估算/unsupported。

Phase 5 只在上述条件满足后开始实现跨 Agent Handoff；P4.6 不通过增加自然语言提示来掩盖未解决的状态、能力或配置问题。
