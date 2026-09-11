# DSH 架构作为多 Agent 工作台的评估

> 状态：评估记录（只读分析，未改动任何实现）；**不冻结任何决策**，待评审后决定是否升级为 ADR
> 日期：2026-09-11
> 分支：`dsh-architecture-assessment`（基线 `main` @ `ef82f6a`）
> 评估对象：`@deepseek-ai/dsh` 0.1.5-rc.1 及其 `@deepseek-ai/dsh-*` 子包（随附 0.1.5-rc.2）本地 npm 检出
> 前置阅读：[ADR-0001 进程外 Agent 插件](adr/0001-process-isolated-agent-plugins.md)、[Phase 4.7 Agent 插件化](phase-4.7-agent-plugins.md)、[Phase 4.6 工作台控制面](phase-4.6-agent-workbench-controls.md)
> 后续动作：见第 7 节待决事项；任一待决项落定后，按 AGENTS.md 要求同步契约、架构测试与 `docs/ui-architecture.md`

## 1. 问题与范围

「DSH 的架构能否成为多 Agent 工作台」必须先拆词，否则会得到互相矛盾的答案。本仓库语境下有两个不同的问题：

| | A. 一个产品内跑多个 Agent | B. 多 Agent 工作台 |
| --- | --- | --- |
| 单位 | 会话内的 Agent 树 | 对等的、可独立升级与独立崩溃的 Agent 会话 |
| 关系 | 父子委派，父拥有子 | 兄弟/对等，宿主拥有全部 |
| 契约归属 | Agent 产品自己定义并实现 | 宿主定义，Agent 插件实现 |
| 人的位置 | 与主会话对话 | 控制面：观察、批准、中断、分发 |

DSH 现状属于 A 且完成度很高；B 所需的概念正是本仓库在 [CONTEXT.md](../CONTEXT.md) 中已命名的 **Plugin Release、Aibo Session、Native Session Binding、Runtime Generation、Capability**。

同时需要修正一个前提：`README.md` 自称 "Aibo is a local multi-agent workbench"，但 [Phase 4.5](phase-4.5-agent-workbench-completion.md) §1/§13 把工作台定义为**单 Agent 在单工作区内**可靠完成任务的闭环，§4.3 与 [Phase 4.6](phase-4.6-agent-workbench-controls.md) §2.2 均明确排除多 Agent 编排。因此本评估真正回答的是：

> DSH 的架构能否支撑 Aibo 从「可靠单 Agent 工作台」扩展到「并行多 Agent 监督」，以及应以哪一层角色接入。

平台备注：Aibo 的 macOS arm64 首发验收（4.5 G5）与 Windows 验收均未完成，本评估不改变该事实，也不构成任何平台能力证据。

## 2. 结论

1. **作宿主控制面**：不足，且不是补插件能补的——它的契约层所有权、插件隔离模型与并发监督 UI 都不在宿主侧。
2. **作被托管的运行时/后端**：可以，且相当合适（一个进程、一条 stdio 连接、多会话各自独立、可列举与恢复）。这是对「能不能」最直接的实证路径。
3. **作架构蓝本**：价值最大。它已把工作台需要的大部分机制实现过一遍，但采用它意味着 Aibo 必须自己拥有契约层。
4. **不建议 fork 它当宿主**：需要推翻其地基假设（in-process provider、session-as-agent、产品级 plugin patch），等于在 TypeScript 中重造一遍 ADR-0001，并长期承担上游演进成本。
5. **一个必须先裁定的冲突**：审批与沙箱策略的权威归属。Aibo ADR 规定 Core 为权威，但当前最小插件宿主不授予任何权限代理，因此该冲突会阻塞路线 1 的落地。

## 3. DSH 侧可复用的机制（证据）

### 3.1 组合模型与 seam

- `dsh` 是唯一 Node 启动器；profile 是**有序插件 bundle patch 栈**（`dsh-base`、`dsh-web-app`、`dsh-headless`、`dsh-sdk`/`sdk-minimal`、`dsh-acp-app` 等），可用 `dsh plugin --profile <name>` 以 pnpm 安装**仓库外**插件，`patchReload` 有 `live` 与 `startup` 两档。
- 整个 harness 运行时即一棵 Cordis 插件树（`@deepseek-ai/dsh-*` 约 250 个包），包间 peer 依赖即服务契约；`dsh-typert-protocol` / `dsh-typert-registry` 提供 Remote 调用描述。

### 3.2 多 Agent 委派原语（`dsh-subagent`）

- `ctx.subagents` 是**具名 provider 注册表**：同一组合中 in-process spawn/fork 与 ACP、SDK、Codex、Claude Code 后端**并排共存**，调用方按名选择。
- 两种子形态：一次性 run（**发布即转移所有权**）与**可持续对话的子 Agent**（durable session + `sendMessage()` 对相邻 Agent 的 Queue/Steer + `interrupt()`）。
- 发现能力：列出直接子级与完整后代树（mode/activity/lineage），**不加载、不唤醒**子 Agent（读 live session store + projection cache）。
- `dsh-client-ui-subagent` 已提供父会话头部的后代目录、活动/耗时/token 与独立 Stop。

### 3.3 进程边界与多会话（路线 1 的技术基础）

- `dsh --profile acp` 是 ACP stdio 服务。其文档明确 **"One connection can run several sessions at once, each independent"**。
- 方法面：`initialize`、`session/new`、`session/list`、`session/resume`、`session/close`、prompt、cancel；`session/new` 的绝对 `cwd` 即持久化工作区身份，`session/list` 支持按 `cwd` 过滤。
- 进程外子 Agent 的 cwd 由 `resolveChildCwd` **按委派父会话的 workspace 解析**，并在两个来源都缺失时**明确失败**（拒绝回退到 harness 启动目录）。注释原文点明前提：*one server process serves many sessions, each with its own cwd*。
- `NO_START_CAPABILITIES`：进程外后端不兑现 `agentOptions` / `outputSchema` / `maxDepth` / `toolFilter` / `persona`，需要这些能力的请求**在 `start` 之前就被拒绝**（never accepted-then-ignored）。这是一个值得沿用的失败语义。

### 3.4 会话、策略与后台执行

- `dsh-session-*`：事件溯源会话日志、版本化格式迁移（v0→v1→v2→v3）、projection 与 projection cache、`dsh-session-query`（精确读、关系追踪、过滤；排序全文检索需 SQLite 后端）。
- `dsh-user-approval`：channel-neutral、一次性决策、**agent-scoped answerer**、缺席即 fail-closed、每次请求与结果写入请求会话的审计日志。
- `dsh-sandbox-policy`：**每会话**可选模式（默认 `read-only`）+ 每次调用统一 workspace 根；`bash/pwsh/fs-sandbox` 为执行方。
- `dsh-jobs`：后台任务注册表（共享 id、owner 隔离、轮询、取消、完成监听）；`dsh-client-ui-jobs` 是只读人工投影。
- `dsh-workflow` + `dsh-workflow-worker-thread`：每个 workflow run 一个 worker thread（**明确声明不是安全边界**）；`dsh-code-runtime` 是模型编写程序的执行 seam（后端语言与隔离描述符不等于安全承诺）。

## 4. 障碍（按严重度）

1. **契约层所有权在 Agent 侧。** DSH 是「一个产品自己定义 Agent 契约并实现它」；工作台需要反向结构。这不是缺陷，是定位差异——Aibo 存在的意义正在于此。
2. **插件不是进程隔离的 release。** 插件加载是 Cordis in-process；`dsh-host-plugin-inventory` 的 `pluginInventory/list` 明确是只读快照，*no history, provenance, or change subscription*；**没有 plugin release / integrity digest 概念**。Aibo 的 `plugin_installations.package_digest`、活跃会话 pin 到不可变 release、`generationId` 迟滞事件隔离在 DSH 侧没有对应物。一个插件或一个子 Agent 可拖垮整个 harness。
3. **工作台控制面缺位。** 多 Agent 视图是「父会话头部 → 后代目录」，本质是**会话内谱系浏览**，不是跨会话看板；并发多会话无统一 UI；**任务分发/调度/Handoff 不存在**（DSH 自身也没有）。这与本仓库把多 Agent 编排排除在 P4.6/P4.7 范围外是同一结论：缺的不是运行时能力，而是宿主控制面。
4. **跨进程能力天然受限、配置需重启。** 见 3.3 的 `NO_START_CAPABILITIES`，以及 shipped ACP profile 使用 `patchReload: startup`（一次 stdio 连接内不会观察到桥的替换）。另有明确风险条目：用户插件可污染 stdout，而 stdout 是协议通道。

## 5. 三条接入路线

| 路线 | 做法 | 收益 | 成本与风险 | 建议 |
| --- | --- | --- | --- | --- |
| 1. DSH 作为 Aibo 的一个 Agent 插件 | `dsh --profile acp` + Plugin Runtime Protocol 适配层 | 立即得到工作台中的一个可安装 Agent；不需改 DSH；直接实证映射可行性 | ACP 不支持面必须显式上报；审批/权限须先裁定归属；shell 型扩展操作无映射 | **先做，作为映射验证** |
| 2. 以 DSH 为蓝本，契约层留在 Aibo | 复用设计（会话日志迁移、projection/query 分离、具名 provider 注册表、Remote seam、客户端组件系统），改造 provider 契约为「运行时代理」 | 与 ADR-0001 同构，不背上游 | 需自行实现宿主侧四件套 | **推荐主线** |
| 3. fork DSH 当宿主 | 改 in-process provider 为进程/代际隔离、session 增补 (agent, release, generation)、产品级 patch 升级为宿主级 release 注册表 | 复用现成机制 | 等于在 TS 中重造 ADR-0001；长期跟随 `0.1.5-rc.*` | **不推荐** |

路线 2 的参照清单（DSH 机制 → Aibo 对应物）：

| DSH 机制 | Aibo 对应物 | 可借鉴之处 |
| --- | --- | --- |
| `session-format-v0..v3` 迁移链 | `AgentEvent v1`/`v2`、migration 0001–0022 | 契约版本只增不改，旧事件兼容读取 |
| `session-projection` / `session-query` | History Projection | 读投影不唤醒 Agent；live 优先于持久副本 |
| `ctx.subagents` 具名 provider 注册表 | Plugin Registry + Supervisor | 注册是 effect-scoped：移除 provider 不撤销已接受 run |
| provider 能力校验 + 启动前拒绝 | manifest 声明 + 握手能力 + 执行前再校验 | **never accepted-then-ignored** |
| `user-approval` agent-scoped answerer | `approval.requested/resolved` + Core 裁定 | 一次性决策、缺席 fail-closed、写审计日志 |
| `sandbox-policy` 每会话模式 | requestedPermissions + Core 代理执行 | 声明≠授权，区分代理执行/OS 隔离/原生保证 |
| `dsh-jobs` owner 隔离 | 后台任务与取消语义 | owner 隔离 + 完成监听 |

## 6. 路线 1 的 ACP ↔ Agent Runtime Protocol 映射

方向：Aibo Core（宿主，权威）→ DSH 插件进程（被监管）。

### 6.1 逐项映射

| ACP surface | Aibo 契约 | 映射方式 | 归属/裁定 |
| --- | --- | --- | --- |
| `initialize` | `aibo.initialize` | DSH 的 initialize 结果**不能**直接作为权威能力源；作为运行时约束上报 | 能力权威在 manifest + 握手，DSH 结果只降级不升权 |
| `session/new`（绝对 `cwd`） | `session.create` | 1:1；`cwd` 必须来自 Core 校验过的工作区根 | Core 保留 workspace trust 权威 |
| `session/list` | 历史/恢复入口 | 用于重建 Native Session Binding；分页与 `cwd` 过滤可直接复用 | 宿主侧过滤与授权 |
| `session/resume` | `session.resume` | 1:1；**不重放历史**，历史由 Core 投影提供 | 需要 `nativeSessionId` |
| `session/close` | `session.close` | 1:1；其内部已完成取消排空、后代释放、持久化 flush | — |
| prompt | `turn.send` | 1:1；流式语义更新 → `agent/event` | Core 分配 `eventId`/`sequence`/`generationId` |
| cancel | `turn.cancel` | 1:1；`reason` 增加 `user`/`shutdown` 映射 | 现有 `user\|shutdown\|timeout\|superseded` 足够 |
| 会话配置（`model`、`reasoning_effort`） | `model` 能力 + `command` | 建议经版本化能力或 `operation.invoke`，不用 Core 分派 | 高价值，优先做 |
| 语义更新 / 工具调用与结果 | 24 类事件的子集 | 见 6.3 | Core 归一化 |
| 审批请求 | `approval.requested/resolved` | **冲突点**：ACP 未把审批暴露为独立方法面 | 归属待裁定（见 7.1） |
| 用户输入 / elicitation | `user_input.requested/resolved` | ACP `elicitation` 明确不支持 → 上报 `unsupported` | 不静默降级为普通事件 |
| MCP 声明 | 扩展能力 | ACP 客户端为 trusted controller，stdio MCP 条目授权其绝对命令与环境 | Core 决定是否代答 |
| 后台任务 | 事件 + 独立取消 | DSH 有 `jobs`，但无 ACP 方法面 | 宿主侧补充 |
| 图像 prompt | `stream.text` 之外 | 仅当 attachment store 与精确路由支持时可用 | 需显式能力声明 |

### 6.2 必须显式上报 `unsupported` 的 ACP 面

DSH 文档已声明不支持的条目：`session/load`、会话删除、fork、额外目录、SSE 或 ACP-transport MCP、modes、commands、plans、terminals、client 文件系统操作、elicitation。

要求：这些能力在 Aibo 侧必须回 `capability_unsupported`，并保持 `permission_denied`、`protocol_incompatible`、`manifest_mismatch`、`not_initialized`、`invalid_recovery_data`、`dependency_missing` 等既有错误 kind 语义不变；**不得**静默降级为「假装成功」。

### 6.3 需要宿主侧补充的部分

- 把 DSH 的语义更新与工具调用映射到 `agent/event` 的 24 类事件子集；DSH 的 `queue`、`compaction`、`usage`、`session.info_changed` 分别对应 `queue.updated`、`compaction.*`、`usage.updated`、`session.info_changed`。
- DSH 的「计划/终端/Skills/Goal」类 surface 在 ACP 上不暴露；若需要，只能走 `ext.dsh.*` 版本化扩展操作，并声明 input/output schema。
- `shell` 型扩展操作（Codex/Pi 现有内置适配器提供的能力）**在 DSH 上没有 ACP 映射**：ACP 的 terminals 明确不支持，因此不要试图经此路径补齐 shell 执行。
- 认证：`initialize` 即刻成功、服务端不要求认证，实际模型凭据来自 DSH profile 的 credentials seam；Aibo 若要保留凭据委托，只能走 `credentials.delegate` 代理，不得读取 DSH 存储。

## 7. 待决事项

1. **审批与沙箱策略的权威归属（阻塞路线 1）。**
   建议：Aibo Core 裁定，DSH 侧只做执行与上报——即让 DSH 产生 `approval.requested` 事件，由 Core 决定后回填 `approval.resolved`，而不是让 DSH 的 answerer 自答。
   依赖：该裁定要求 P4.7C 的权限代理先落地。当前最小宿主不授予任何权限代理（workspace/command/network/credential 全部 `denied`），并拒绝带必需 `dependencies` 的包，因此 `operation.invoke` 目前没有可用授权路径。
2. **`nativeSessionId` 与 `recovery` 的绑定形态。**
   `plugin-session-binding.v1` 已含 `nativeSessionId` 与 `recovery{schema,version,data}`。需明确：DSH 的 ACP session id 写入 `nativeSessionId`；`cwd`/工作区身份、DSH profile 名与版本、以及 resume 所需的最小上下文写入版本化 `recovery`；**不得**把 DSH session id 当 Aibo `sessionId`。
3. **能力协商的所有权。**
   manifest 的 `agents[].capabilities` 与 DSH `initialize` 的运行时能力可能不一致。原则：manifest 是承诺、握手是实际、会话状态决定可执行；三者取交集，冲突时**报错而非放宽**（对齐 DSH 的 never accepted-then-ignored）。
4. **是否需要 `ext.dsh.*` 命名空间。** 若需要暴露 DSH 独有 surface，先定义 schema 与取消/超时语义，不开放无约束方法转发。
5. **上游版本策略。** DSH 处于 `0.1.5-rc.*` 且包间版本不完全一致（`dsh` 0.1.5-rc.1，随附子包 0.1.5-rc.2）。接入前需固定精确版本并纳入 Plugin Release 的 package digest。

## 8. 证据来源与置信度

DSH 侧：本地 npm 检出的包 README 与 `.d.ts`/`lib` 文件，以及 `dsh` 顶层 README 与 `package.json`；版本以本机安装为准（`dsh` 0.1.5-rc.1）。引用为文档与类型声明级证据，**未运行动态验证**。

Aibo 侧：`CONTEXT.md`、`docs/architecture-freeze.md`、`docs/adr/0001`、`docs/phase-4.5/4.6/4.7*.md`、`contracts/*.schema.json`、`src-tauri/src/plugin_*.rs`、`src/App.svelte` 的只读代码走查。以下条目置信度较低，实施前需复核：

- `plugin_host.rs` 中「v1 最小宿主全部 `denied`」与「拒绝带必需依赖的包」为代码走查结论，未逐行复核。
- `operation.invoke` 当前无可用授权路径属**推断**，文档未直接说明。
- `App.svelte` 中全局 `busy` 与会话级 `threadBusy` 是否允许并发创建会话未逐条确认。
- [Phase 4.6](phase-4.6-agent-workbench-controls.md) §5.1 的 `AgentWorkbenchCapabilitiesV1` 类型名在源码中未 grep 到（实际为 adapter capability 字符串 + `WorkspaceCapabilityInventory`）；§4.6D 的「15 秒最近活动计时」未在源码定位。以上两项属文档与实现漂移，需单独修正，不在本评估范围内。

## 9. 下一步

1. 评审并裁定第 7 节的 5 项待决事项，尤其是 7.1（阻塞路线 1）。
2. 若采纳路线 1：产出 ACP 适配层的协议映射样例与回放证据，按 [Phase 4.7](phase-4.7-agent-plugins.md) §6 的门禁第 1、3 条验收，并补齐契约与架构测试。
3. 若采纳路线 2：把第 5 节参照清单转为设计输入，逐项决定「复用设计 / 重新实现 / 不采用」。
4. 无论采纳哪条路线：`AgentEvent v1` 不回写，DSH 相关新增事件走 `v2`，投影层同时接受两者（对齐 ADR-0001 的既有约束）。
