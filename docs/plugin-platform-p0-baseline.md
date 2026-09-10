# P0：插件平台边界与回归基线

> 日期：2026-09-10 · 基线提交：`ce518a2` · 分支：`docs/plugin-platform-decisions`。
> 状态：P0 已按用户确认完成，保留真实 Provider/桌面未执行和 B05 根因未定两项验收例外。本批不改运行代码，P1 尚未实施。

## 1. 结论与证据等级

已有 Registry/Runtime/Host 足以作为演进基础，但默认 Codex 与 Pi 创建路径尚未统一，能力家族推断仍会误判第三方插件，独立插件面板与主工作台仍有重复状态。不能把内置插件存在、manifest 声明或离线测试通过等同于整个产品已经等价。

以下区分：**源码支持**表示存在实现；**离线通过**表示本次自动测试覆盖了具体场景；**缺陷**表示已观察到与目标不符；**未验证**不推断成功或失败；**不适用**仅用于能力本来未提供的情况。真实模型运行和桌面交互另列，不拿历史 capture 冒充本次运行。

机器可读的[证据索引](./baselines/plugin-platform-p0.json)记录源文件 SHA-256、基线提交，以及从既有 Echo fixture 原样提取的 binding/view。后续迁移应对照此基线，不自动刷新哈希来消除差异。

## 2. 实际调用链

入口见 [api.ts](../src/lib/api.ts)、[lib.rs](../src-tauri/src/lib.rs)，默认装配见 [App.svelte](../src/App.svelte)。

| 行为 | 当前调用者与链路 | 迁移判断 |
| --- | --- | --- |
| 默认新建 Codex | `agent-session-controller.createCodex` / `message-controller` 无会话发送 → `createCodexSession` → `create_codex_session` → `CodexManager::create_session` → 原生 app-server | 仍是 `codex.rs` 内管理器；新建行 agent 为 `codex`，未走插件安装绑定 |
| 默认新建 Pi | `agent-session-controller.createPi` → `createPiSession` → `create_pi_session` → 查询启用的 `dev.aibo.pi` → `PluginHost::create_with_profile` | 已走内置插件，但 IPC 含 Provider ID、profile 与安装选择逻辑 |
| 显式插件创建 | App 插件面板 → `createAgentSession` → `create_agent_session` → `PluginHost::create` | 有安装 ID 时显式绑定；没有时按 agent contribution 查询最近启用的安装，再回退旧 ID 分支。不是未来 Broker 的歧义拒绝策略 |
| 发送与取消 | 主 `message-controller` → `sendAgentPrompt` / `cancelAgentTurn`；插件面板也使用统一 API → IPC 根据旧 agent ID 分流或调用 Host → `turn.send` / `turn.cancel` | 前端主发送已统一，后端仍含兼容分流，不应重复重写已统一部分 |
| 队列 | `message-controller` → `invokeAgentCapability('queue.manage')`；App 仍保留 `clearPiQueue` 等专属操作 | Host 要求 session，能力恰好映射一个 operation；并非通用作用域 Broker |
| 树/快照 | `pi-tree-controller` 对 plugin binding 调 `session.tree`，旧路径调 `navigatePiSessionTree`；`session-context-controller` 与 App 仍维护 Pi/Codex 专属上下文 | 消费类型、刷新和呈现家族未统一 |
| 模型/推理设置 | App → `sessionModelBackend` → 插件 `model.select/model.reasoning`、Pi `setPiModel/setPiThinkingLevel` 或 profile 更新 | Pi 专属 API 还负责执行设置持久化；替换时必须保留此语义，不能只换调用名称 |
| 审批 | `approval-controller` 选择 Pi/Codex API；Codex plugin binding → Host `approval.respond`，旧 Codex → manager；Pi → Host `resolve_pi_approval` → 受控工具处理 | Provider 原生审批与宿主工具批准并非同一路径；不能把二者简单重命名成一次 operation |
| 恢复 | `resumeAgentSession` → plugin binding 调 Host；Host 从不可变安装和 binding 启动 runtime，协商并恢复；旧 Pi 明确 history-only | Host 有空 Codex thread 重建、旧 Codex 能力补全、Pi recovery/profile 装配，须明确归入兼容层 |
| 关闭 | 主 `session-lifecycle-controller` 仍按家族选 `closePiSession/closeCodexSession`；插件面板有 `closeAgentSession` | 未完成统一生命周期调用，外部插件走主工作台的等价性不能由统一发送测试推定 |
| 归档/取消归档 | 主生命周期 → `archiveSession/unarchiveSession`；IPC 先判断 plugin binding → Host，否则旧 Provider 逻辑 | Host 保留本地历史；Codex thread 原生归档专属入口仍并存 |
| View action | 插件面板 → `invokePluginViewAction(sessionId, viewId, actionId, input)` → Host 校验当前存储 view、generation、manifest、schema → operation | 非 `never` confirmation 明确未实现；当前 API 不携带调用者所见 revision，不能宣称已完成旧页面 revision 校验 |

Host `invoke_capability` 当前会先恢复 session，验证 generation、协商能力、输入输出 schema；running 状态仅为 queue/snapshot 放行。P3 应将作用域、权限、副作用与并发规则抽为合同，不能沿用这些硬编码作为通用 Broker。

### 兼容路径及退出条件

| 现存兼容落点 | 允许退出所需证据 |
| --- | --- |
| `lib.rs` 默认 Codex 创建与 `codex.rs` manager | 默认创建/发送/取消/审批/模型/归档/重启恢复经插件路径等价；旧 session/binding 的读取与恢复政策明确 |
| `lib.rs` 旧 ID 分支、Pi 专属 IPC | 统一 facade 保留 profile、模型持久化和错误语义；旧 Pi history-only 行为不被误报为可执行 |
| `plugin_host.rs` Codex 空 thread 重建与旧能力补全 | 指定旧 release 的回归通过，明确版本范围；有历史的会话不得通过新建线程伪装成恢复 |
| Host Pi recovery/profile、工具代理及 Pi 扩展事件映射 | 抽出通用授权/执行机制与 Provider 兼容翻译；受控 read/write/bash、审批和历史投影保持等价 |
| `agent-kind.ts`、App 与 controller 的家族分支 | 非 Pi 的 queue/tree、非 Codex 的 nativeSandbox 样例不误路由；行为按明确契约与绑定选择 |

这些是迁移工作项，不新增架构测试豁免；旧 Pi 管理器中的 dead code 警告也不代表已获准删除历史读取代码。

## 3. 等价矩阵

| 能力 | Echo fixture | Codex 插件 | Pi 插件 | 本次真实模型/桌面 |
| --- | --- | --- | --- | --- |
| 创建 | 离线进程测试通过 | fake app-server 创建通过；默认 UI 仍用旧 manager | fake RPC/SDK 创建通过 | Codex/Pi 未验证；Echo 是真实本地 fixture 进程，不是模型服务 |
| 流式 | Unicode 和 turn 完成通过 | 文本、工具、推理及顺序通过 | 生命周期、消息 identity 及事件等价通过 | 未验证 |
| 取消 | 进程测试覆盖重复取消与唯一终态 | manifest/处理路径存在；本次 Codex 专属进程测试未断言取消 | fake SDK abort 后新 turn 通过 | 未验证 |
| 审批 | 声明 `approval.respond`；Host 工具审批在 Rust 综合测试后续段覆盖，首次运行未到达，复跑通过 | fake 原生 approval 与 user-input 响应通过 | fake SDK 工具通过 Core 网关，实际桌面批准闭环未验证 | 未验证；View confirmation 非 never 是已知缺口 |
| 模型/推理 | 未声明 model 能力，不适用 | fake set、recovery 数据与 catalog 通过 | fake set、恢复与 profile 持久化路径有测试 | 未验证 |
| 树/队列 | queue 被声明，但 manifest 无对应 operation；tree 未声明 | 插件未声明 tree/queue；旧 Codex fork 是另一项功能 | 离线 parity 覆盖树/模型状态与 queue steer/followUp/clear | 未验证 |
| 归档 | Host 实现，未找到本批专门覆盖其完整恢复闭环的自动断言 | Host/旧 thread 两条路径存在，不能据此宣称等价 | Host 路径存在 | 未验证 |
| 重启恢复 | Node 跨进程 binding 恢复通过；Rust 综合测试首次失败，复跑通过 | fake 空 thread 重建及配置保留通过；一般有历史恢复未在该测试完整覆盖 | fake SDK session file 在新进程恢复通过；旧 Pi history-only | 未验证 |

自动证据：[Echo 进程](../test/echo-plugin-process.test.mjs)、[Codex 插件](../test/codex-builtin-plugin.test.mjs)、[Pi 插件](../test/pi-builtin-plugin.test.mjs)、[Pi parity](../test/pi-plugin-parity.test.mjs)、[parity 场景](../probes/pi-plugin-diff.mjs)、[事件投影](../test/adapter-contract.test.mjs)、[Rust Host 测试](../src-tauri/src/plugin_host.rs)。Pi production-path 测试也不能代替联网模型运行。

真实验收待办：在临时工作区分别验证默认 Codex 和显式 Codex 插件、默认 Pi 的创建/流式/取消/审批/模型设置/归档/应用重启；Pi 额外验证树和队列。记录 Provider 版本、脱敏结果、实际调用路径和桌面操作证据。现有 `pnpm run probe:pi:plugin:smoke` 是真实 Pi 插件发送与恢复入口，`probe:codex:smoke` 等为原生 Provider probes，不能单独证明默认 UI 已走插件路径。本次未运行联网模型请求或桌面操作，也未将历史录制升级为本次成功证据。

## 4. 已确认缺口与基线异常

| ID | 证据与影响 | 处理阶段 |
| --- | --- | --- |
| B01 | 直接导入 `agent-kind.ts` 执行：Echo manifest capabilities 得到 `kind=pi, modelBackend=pi`；第三方仅带 `session.tree` 同样如此。`permissions.nativeSandbox` 又会将第三方识别为 Codex | P2；真实输入已具备，不需要假设未来插件才触发。不能把 Echo queue 声明当成 Pi 身份证据 |
| B02 | 默认 Codex 创建实际调用 `CodexManager::create_session`，Pi 已用 Host | P2 facade 等价迁移前必须区分两条基线 |
| B03 | 非 never View confirmation 返回 `capability_unsupported`；旧 view action API 无 caller revision | P1 新动作合同补明确 freshness 边界，P4 完成宿主确认；不放宽旧 v1 |
| B04 | Echo 声明 queue/approval，但只注册 commands/refresh operations；Host `invoke_capability('queue.manage')` 无可匹配 operation | P2/P3 能力等价和协商测试；manifest 声明不足以证明可调用 |
| B05 | Rust 首次完整运行 95/96 通过；`installs_external_package_streams_cancels_and_restores_persisted_session` 在 `plugin_host.rs:1659` 期望 idle、实际 interrupted。独立复跑 1/1 通过，第二次完整运行 96/96 通过 | 迁移前非稳定失败，根因未定；不能宣称修复，也不能据一次绿色复跑关闭 |

B01 可复现命令（不修改代码）：

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { sessionAgentKind, sessionModelBackend } from './src/lib/app/agent-kind.ts';
const agent = JSON.parse(readFileSync('fixtures/plugins/echo-agent/plugin.json', 'utf8')).agents[0];
const session = { agent: agent.agentId, capabilities: agent.capabilities, pluginInstallationId: 'fixture' };
console.log(sessionAgentKind(session), sessionModelBackend(session)); // 当前输出 pi pi
JS
```

B05 独立复跑命令：

```sh
cargo test --manifest-path src-tauri/Cargo.toml plugin_host::tests::installs_external_package_streams_cancels_and_restores_persisted_session -- --exact
```

B05 初次前端/Rust 套件并行运行，后续独立测试及 Rust 全量串行于前端运行；这只是运行条件差异，不是并发导致失败的证明。未获得稳定复现，不归因于 sandbox、数据库锁、fixture 或产品恢复逻辑中的任何一项。后续需捕获 Host notification/projection 与进程退出信号以定位，不能靠删除断言或增加任意 sleep 关闭。

## 5. 样本与兼容资产

| 资产 | 当前样本/生成来源 | 迁移时必须保留 |
| --- | --- | --- |
| Session binding v1 | Echo lifecycle 的 `session.resume.params.binding`，本批已提取到 JSON 索引；Node 与 Rust 测试动态构造绑定 | session/plugin installation/native ID、release、协议版本、版本化 recovery 与恢复身份关系 |
| AgentEvent v1/v2 | 两份 schema；`fixtures/codex/*.redacted.jsonl`、`fixtures/pi/*.redacted.jsonl`；`adapter-contract.test.mjs` 将输入投影为规范事件；Host `project` 构造 v2 source | 原生录制不是规范事件文件，不能直接当 v2 样本；保留转换测试与旧事件读取路径 |
| PluginView v1 | Echo lifecycle 的 `view/render` document，已提取到索引；实际 Echo 进程也产生 view | revision、binding、action、资源和旧节点树解释；不重解释为 collection |
| Codex recovery | `test/codex-builtin-plugin.test.mjs` 与插件 `recovery()` | `dev.aibo.codex.recovery` v1 的 threadId/model/reasoningEffort；空 thread 恢复特例 |
| Pi recovery | `test/pi-builtin-plugin.test.mjs` 与插件 `recovery()` | `dev.aibo.pi.recovery` v1 的 nativeSessionId/sessionFile/model/thinkingLevel；profile 优先级 |
| 旧 Pi 历史 | `fixtures/pi/session.redacted.jsonl`、序列化测试及 IPC history-only 明确分支 | 可读不等于可继续执行，不伪造恢复成功 |

本批复用并固定已有脱敏/合成资产，不复制用户 SQLite、认证配置或真实 session 文件。Codex/Pi recovery 的样本值由已有测试生成；完整桌面数据库迁移回归样本仍需后续验收补齐。

## 6. 页面职责与状态所有者

| 当前落点 | 业务语义/状态 | 布局、视觉与交互边界 | 目标 |
| --- | --- | --- | --- |
| App 根状态 | workspaces、workspaceSessionMap、selectedWorkspaceId/selectedSessionId、timeline、审批、模型、工具状态 | Svelte 组合根注入 API/controllers，仍有 Provider 分支 | 业务状态由 controller/host ports 管理，App 负责装配 |
| 主 Composer | App `composerDrafts`、hydration generation、写入队列；`composer-draft-storage.ts` 与 SQLite draft API | Composer 经 kit，焦点/控件具体行为在渲染层 | 保留已实现的 session 草稿恢复和防覆盖，提取可序列化状态 |
| 插件面板 | App `pluginSessions/pluginSelection/pluginDrafts/pluginTimeline/pluginViews`；插件选择按 workspace，草稿内存按 session | `PluginWorkspacePanel` 与 `PluginManagerPanel` 通过 kit 呈现 | P2 合并重复选择/草稿/时间线，不能删除管理与恢复入口 |
| 工作区 Git | App `workspaceChanges`、文件 path/staged、diff、loading/error、请求 generation | `WorkspaceGitPanel` 与 `WorkspaceFileDiffPreview`；App 决定侧栏/中央区域 | P1 提取只读投影和两种布局，保留已有过期响应防护 |
| 导航/树 | `selection-storage.ts` 仅持久 workspace/session 对；Pi tree 和 Codex snapshot 在 App | navigation/context/tree controllers 通过 getters/setters 操作根状态 | P2 扩展 contribution 语义导航，不能误认为已保存全部详情/返回位置 |
| Shell 布局 | App 分栏宽度、splitter、tab、overlay 开关及滚动/显示数量 | app CSS 仅布局；视觉组件来自 kit | 未来 workbench 也纳入同一检查，布局所有权正式改变需配套契约/ADR |
| 视觉与控件 | `ui-kit/contract.ts`、registry、shadcn/material3 实现 | Svelte Component 与回调是内部接口；PluginView props 也含 onAction 回调 | 不能作为公共能力 ABI；DOM 焦点与动画不跨 renderer 保存 |

## 7. SDK/Presentation Model 边界清单

P0 固定禁止项，P1 才实现检查，不把现有 app 检查冒充完整 SDK 验证：

- 公共 wire/model 仅版本化 JSON、稳定 ID、有限语义消息；禁止函数/回调、框架 Component/ReactNode/VNode、DOM/HTMLElement/Storage、CSSProperties、组件实例和不可序列化对象。
- 能力 SDK 禁止导入 Svelte、具体 UI 库、`ui-kit`、Tauri/具体 API 实现；纯投影通过窄端口注入数据。端口实现与本地 renderer 可以有函数，但不得重导出进公共 wire/model。
- 禁止 px/class/CSS token/DOM 属性、任意脚本/表达式和布局节点树进入新语义文档。v1 历史控件树保留在独立兼容路径。
- 检查直接 import、type-only import、barrel re-export 与传递依赖；用允许 JSON 的 schema 和正反 fixture 验证数据，不能只搜索几个框架关键字。
- 当前 `selection-storage.ts`、`composer-draft-storage.ts` 使用 `Pick<Storage,...>`，当前 kit 使用 Component/onAction：这些不是本批新增违规，但不能直接搬进公共 SDK。需改窄存储端口或留在本地适配层。
- 新 `workbench/` 必须扩展现有架构测试覆盖；Core/optional 改动按正式 ADR 同步 contract/tests/ui-architecture，不放宽现行规则。

## 8. v1 并存与首个切片

沿用已确认 ADR：v1 manifest/runtime/view 原样验证，经未来 compatibility adapter 映射内部贡献；新语义协议独立版本化，P1 为实验版本，P3 发布前冻结。独立协商失败要诊断，不能通过放宽 v1 schema 接受新字段，也不改旧 session binding。

P1 限定 **Git 工作区变更 collection → 查看 diff detail**，复用 `getWorkspaceChanges(workspaceId)` 与 `getWorkspaceFileDiff(workspaceId,path,staged)`。Host 从 workspace ID 解析路径；diff 已做目标范围检查并设 `WORKSPACE_DIFF_MAX_BYTES=200_000`，返回 `available/truncated/reason`。这是当前实现参数，不自动成为新协议上限。changes 有 captureStatus/error，但当前 API 没有分页参数，也没有新动作 revision/presentation generation。

P1 需冻结：语义 ID 与 staged/unstaged 选择表达、重命名/删除/冲突/非 Git 状态、分页/部分内容、资源限额、读取错误映射、action 消息与 freshness 粒度、keyboard/focus/重试规则。API 的一般受控访问不等于新 Broker 权限合同已完成。

验收为两种布局 × 两套皮肤及第二最小 renderer 共用 fixture/action；P1 不迁进程、不接 Git 写入、不实现市场或第三方可执行 UI。Git 执行迁包属于 P3。

## 9. 本次验证记录与退出门

环境：Node `v24.18.0`、pnpm `10.32.1`、rustc `1.97.1`；本机有 Codex 可执行文件，不据此推断认证、模型连通或桌面可用。

| 验证 | 本次结果 | 证据边界 |
| --- | --- | --- |
| `pnpm run verify` | 架构 18/18、类型检查、Node 100/100、Vite build 通过 | 不覆盖真实模型/桌面和 Rust 全量 |
| `cargo test --manifest-path src-tauri/Cargo.toml` 首次 | 95 passed / 1 failed，B05 | 不隐藏首次失败 |
| B05 单独复跑 | 1 passed / 0 failed | 不足以证明稳定或已修复 |
| Rust 第二次全量 | 96 passed / 0 failed | 仍保留 B05；另有既存 dead-code 等警告，lib 22、lib test 14（10 duplicates） |
| B01 源码执行 | Echo → pi/pi；外部 tree → pi/pi；外部 nativeSandbox → codex/plugin | 可确定复现身份推断缺陷；未执行桌面误路由后续动作 |

P0 已完成的可审查产物：调用链、兼容退出条件、等价矩阵、状态职责、固定样本索引、SDK 禁止项、v1 并存和 P1 范围。2026-09-10 用户明确要求将 P0 剩余验收标记完成，故按用户确认收尾，真实 Provider/桌面证据缺失及 B05 根因未定不再阻塞 P0。两项作为验收例外保留，原始结果不变；不代表真实测试已执行或 B05 已修复，后续相关阶段仍须补齐真实回归与失败诊断。
