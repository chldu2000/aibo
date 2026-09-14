# Phase 4.7C：Pi 插件同类问题审计

> 审计范围：`5a53d5c475db38c488f75818c387bc144a34da62` 至 `bd92fdf538f427be7be4b09a75d69fc0916e7115`（含首尾提交）
> 审计对象：内置 Codex 插件修复、通用 Plugin Host 修复，以及内置 Pi 插件的同类风险
> 状态：审计完成；插件版 Pi 必须补齐旧 SDK adapter 能力后才可视为迁移完成

## 1. 结论

这段提交包含 16 个与插件直接或间接相关的修复。发布协调、执行 profile、自动命名、取消、事件持久化和归档等通用宿主修复已经覆盖 Pi 插件；Codex rollout 恢复和原生 fork 属于 Provider 专用修复，不应机械移植。审批虽然不能照搬 Codex 协议，但旧 Pi SDK adapter 已实现 Aibo Core 代理的写入、命令与审批闭环，因此它是 Pi 插件迁移必须恢复的能力。

Pi 插件迁移有三组必须完成的问题：

1. **已确认的子进程代际竞态**：Pi 关闭旧 Provider 进程后立即恢复时，旧进程迟到的 `exit` 回调可能清空新进程的 pending 请求。
2. **潜在的多消息投影丢失**：Pi 把一个 Aibo turn 内的所有文本聚合为一条无 item ID 的 assistant message；如果 Provider 在同一 turn 产生多条 assistant message，前序消息及其相对顺序无法可靠持久化。
3. **已确认的能力回退**：插件版改用 Pi CLI RPC，并以 `--no-tools --no-extensions --no-context-files --no-approve` 启动；这丢失了旧 SDK adapter 的受控工具、审批、完整生命周期事件、扩展/Skill 发现和 session snapshot 等能力。

P4.7C 的目标不是维持一个可对话的最小 Pi 插件，而是让插件版 Pi 与旧 SDK adapter 在用户可观察能力、安全边界和恢复语义上等价。当前 Pi fixture 只覆盖单进程、单 assistant message 的顺序成功路径，因此测试通过既不能排除上述问题，也不能作为能力等价的证据。

## 2. 修复区间回顾

| 提交 | 修复主题 | 对 Pi 的影响 |
| --- | --- | --- |
| `5a53d5c` | 协调 bundled release 展示与固定版本恢复；恢复插件会话的语义执行 profile；实时广播插件事件 | 通用修复，Pi 已覆盖 |
| `028be88` | profile 切换时忽略旧 runtime 返回的过期错误 | 通用 UI 路径，Pi 已覆盖 |
| `a3d864b` | 无 rollout 的 Codex thread 改为新建；旧 child 不得清理新 child 请求 | rollout 仅适用于 Codex；child 身份保护尚未移植到 Pi |
| `0900b8a` | 旧 Codex release 的空会话允许以 create 代替 resume | Codex 专用兼容逻辑 |
| `e8bea59` | 活跃 turn 中不刷新模型目录 | 通用插件会话路径，Pi 已覆盖 |
| `f9d3e0c` | 插件化 Codex 会话支持原生 fork | Codex 专用；Pi 使用 session tree 导航 |
| `62b048d`、`0122a84` | Aibo turn 与 Codex provider turn 的 fork 边界映射 | Codex 专用 |
| `32d06c3` | 插件会话依据首条 prompt 自动命名 | 通用修复，Pi 已覆盖 |
| `b2fda8b` | 打通 Codex approval/user-input，并兼容旧 release 漏报 capability | Provider 协议不同，但 Pi 必须恢复旧 adapter 的 Core 工具审批闭环 |
| `87a7974` | 将 Provider 工具事件持久化为时间线卡片 | Host 已支持；Pi 禁用工具属于待补齐的能力回退 |
| `f9e0f47` | 增加 reasoning 事件并保持时间线位置 | Pi 不得暴露隐藏 thinking；可展示 summary 是否存在需按 SDK 协议验证 |
| `42445b1` | runtime teardown 与取消操作竞态时保持幂等 | 通用修复，Pi 已覆盖 |
| `9c01320` | 以 provider item ID 区分交错的多条 assistant message | Codex 已实现；Pi 尚无对应身份映射 |
| `339dfd8` | 修正 reasoning 时间线写入 | 通用 Host 修复；Pi 仅在 SDK 提供可展示 summary 时使用 |
| `bd92fdf` | 插件会话统一归档、取消归档和懒恢复 | 通用修复，Pi 已覆盖 |

## 3. P0：Pi 子进程代际竞态

### 3.1 触发路径

Pi 插件使用模块级 `child` 和 `pending`。`startPi()` 覆盖 `child` 后，任意已启动 Pi 进程的 `exit` 回调都会拒绝并清空共享的 `pending`。`stopPi()` 调用 `kill()` 后不会等待旧进程退出，因此以下时序成立：

1. profile 切换、归档/恢复或显式 close 关闭旧 Pi child；
2. 新 session resume 启动新 child，并发送 `get_state` 或配置请求；
3. 旧 child 的 `exit` 回调迟到；
4. 旧回调拒绝或删除属于新 child 的请求；
5. 创建/恢复表现为 `Pi exited`、请求超时或错误进入不可恢复状态。

Codex 插件已在相同生命周期边界记录 `startedChild`，并让 `exit` 回调先验证它仍是当前 child。Pi 缺少这一代际检查，因此应视为已确认的结构性缺陷，而不是仅凭发生概率决定是否处理。

### 3.2 修改方向

- `startPi()` 启动后保存局部 `startedChild`，`exit` 回调仅在 `child === startedChild` 时清理当前状态。
- 将 pending 请求绑定到具体 Provider 进程或 generation。最低修复可以沿用 Codex 的 child 身份检查；更稳健的后续方案是让每个 child 持有独立 pending map，避免模块级共享状态跨代污染。
- `stopPi()` 只清理由被关闭 child 创建的请求，且不得拒绝替代 child 的请求。
- Provider 意外退出且当前仍有 turn 时，应确保插件进程或 Host 最终把 turn/session 投影为 `interrupted`/`failed`，不能永久停留在 running。
- `turn.send` 的 Provider 请求失败时回滚 `session.turn`，避免后续请求持续返回 `busy`。

### 3.3 验收测试

- fixture 支持延迟 child 退出：关闭第一个 child、立即启动第二个 child，再触发第一个 child 的 `exit`；第二个 child 的 `get_state` 必须正常完成。
- close→resume、profile change→resume、archive→unarchive→send 三条路径分别覆盖该时序。
- 当前 child 意外退出时，pending 请求收到确定错误，运行中的 turn 不残留为 running；重复取消仍保持幂等。
- 测试应使用事件或进程握手控制顺序，不依赖不稳定的固定 sleep。

## 4. P1：Pi 多消息身份与时间线顺序

### 4.1 风险

Pi 插件当前对每个 `message_update` 发送 `itemId: null`，每次 `message_end` 覆盖同一个 `finalText`，并在 `agent_settled` 时只发送一次 `message.completed`。Host 会把缺失 item ID 的消息统一写到 `<turn>:assistant:assistant`。

当一个 Provider turn 产生多条 assistant message 时，可能出现：

- 多条消息的 delta 被合并到同一时间线记录；
- 后一次 `message_end` 覆盖前一次完成文本；
- `agent_end.messages` 只保留最后一条可见 assistant message；
- assistant、reasoning 和未来工具事件之间的相对顺序无法还原。

当前 `--no-tools` 降低了常规 prompt 中的触发概率，但 queue、steer、follow-up、retry 或未来恢复工具能力都可能扩大事件形态。因此应先用真实 Pi RPC 事件确认可用的稳定消息身份，再决定映射方案。

### 4.2 修改方向

- 优先使用 Pi RPC 事件或 session entry 中的稳定 message/entry ID，作为 Agent Event payload 和 correlation 的 `itemId`。
- 为每个 item 分别维护 streamed text、completed 状态和去重集合；在 `message_end` 时完成对应消息，而不是在 `agent_settled` 时汇总为一条。
- `agent_settled` 只负责补齐未收到 `message_end` 的降级消息和发送 turn terminal event，不重复完成已持久化消息。
- 若当前 Pi RPC 确实不暴露稳定 ID，应由插件为每次 `message_start` 分配 turn 内稳定序号，并在 start/update/end 全程复用；恢复读取时仍以原生 session entry ID 为准。
- 保持 reasoning 内容的现有隐私边界：只有 Provider 明确提供可展示 summary 且契约允许时才投影，不得把隐藏 thinking 当作普通消息落库。

### 4.3 验收测试

- fixture 在一个 turn 中生成两条 assistant message，并在两者之间插入其他事件；数据库时间线必须保留两条独立消息及原始顺序。
- completed 事件缺失、重复或晚到时不应重复文本，也不能覆盖另一 item。
- abort/retry/steer/follow-up 场景验证 item 身份稳定，terminal event 后不再接受属于旧 turn 的消息。
- 增加脱敏真实 Pi RPC 流作为 fixture；离线生成的理想化事件不能替代真实协议形态验证。

## 5. P0：补齐旧 SDK adapter 能力

### 5.1 等价基线

能力等价以迁移前的 `pi-sdk-host.mjs`、`PiManager` 和对应 UI/API 的实际行为为基线，而不是以当前 Pi 插件 manifest 为基线。实现语言和内部 RPC 可以变化，但以下用户可观察能力、安全约束与持久化结果必须保留。

| 能力域 | 旧 SDK adapter | 当前插件版 | 迁移要求 |
| --- | --- | --- | --- |
| 会话生命周期 | create/open、空会话恢复、abort、reload、archive/unarchive | 基础 create/resume/cancel/close、通用归档 | 保留原生 session ID/file、空会话恢复和崩溃后重开语义 |
| 文本与消息 | message start/update/end、稳定的 turn 内 message ID | 聚合为一条无 item ID 消息 | 按 item 独立流式、完成、去重并保持顺序 |
| 模型与推理强度 | SDK `ModelRuntime`、模型矩阵、thinking level 映射与持久化 | CLI RPC list/set 和 recovery | 输出结构、默认值、可选强度、恢复结果与旧 UI 等价 |
| 队列 | steer、follow-up、clear 及 `queue.updated` 实时投影 | 操作可调用，但不转发 queue 生命周期事件 | 恢复队列状态投影、重启边界和 UI 一致性 |
| 压缩与重试 | compact；compaction/retry/summarization retry 生命周期卡片 | 只有 compact 调用结果 | 转发并持久化完整生命周期，状态机不能提前回到 idle |
| 会话树与快照 | tree、navigate、active branch、snapshot | tree/get/navigate；无 snapshot capability | 补齐 `session.snapshot`，保持导航模式、branch 和安全序列化 |
| 命令、Skill 与扩展 | 内置命令、extension command、Skill 列表；extension/session 事件 | 禁用 extensions、prompt templates、context files；仅列 CLI commands | 恢复旧 adapter 可发现集合及 extension/session metadata 投影 |
| 只读工具 | `read/grep/find/ls` | `--no-tools` | 恢复只读工具并产生 tool start/update/end 时间线 |
| 写入与命令 | 按 execution profile 暴露 Core 代理的 `write`/`bash` | 完全禁用 | 恢复 Core gateway；插件/Provider 不得绕过 Core 直接执行 |
| 审批 | on-request 时生成 Pi tool approval，accept/cancel 后继续 Provider 请求 | `--no-approve`，无 `approval.respond` | 恢复 Pi 专用工具审批关联、等待状态、取消及崩溃清理 |
| 事件与审计 | usage、tool、queue、compaction、retry、extension、session info | 基本文本和 terminal event | 扩展 Agent Event/Host 投影到旧 adapter 的可观察范围 |
| 变更与附件 | turn baseline/checkpoint、change set、受控附件绑定 | 通用 Host 已有部分基础设施 | 验证与旧 adapter 等价，不得丢 checkpoint、change review 或附件归属 |
| 安全表达 | workspace trust；`nativeSandbox=false`；写入/命令由 Core enforcement | 仅申请 workspace.read | 恢复执行 profile enforcement，并持续明确 Pi 无原生 OS sandbox |

reasoning 等价不意味着暴露模型隐藏 thinking。旧 adapter 没有把不可展示的 thinking 当普通文本持久化；插件版只应投影 SDK 明确标记为可展示的 summary。没有可展示 summary 时，保持不声明/不发送 reasoning 事件是正确行为。

### 5.2 实现方向

- **以 SDK adapter 为迁移源，而不是继续扩张受限 CLI RPC。** 优先让内置 Pi 插件直接承载 SDK host 逻辑，或把现有 `pi-sdk-host.mjs` 作为插件内部 Provider bridge；最终插件包必须固定 SDK 版本并独立于旧 `PiManager` 运行。
- 将旧 Rust `PiManager` 中属于 Provider normalization 的事件、模型、树、队列和审批逻辑迁入 Pi 插件；数据库、workspace trust、execution profile enforcement、Core 工具执行、checkpoint/change set 和 generation 隔离继续由 Plugin Host/Core 权威管理。
- 为 Core 代理工具定义受约束的插件协议桥。Provider 只能提出结构化 `write_file`/`run_command` 请求；Core 校验根目录、profile、审批策略、命令限制和超时后执行并返回结果。不能把工作区绝对能力或任意宿主 IPC 暴露给插件。
- 扩展 Pi manifest 与运行时握手，使 `approval.respond`、session snapshot、事件族和受控工具能力只有在实现及 enforcement 完成后才同时声明。声明、握手和实际可调用操作必须一致。
- 扩展 Agent Runtime/Host 所允许的 queue、compaction、retry、usage、extension 和 session metadata 事件；每类事件都必须有 capability gate、schema、状态投影、持久化与前端刷新路径。
- 完成迁移后删除生产路径对旧 `PiManager` 的分派；旧 adapter 仅可保留为 fixture/对照实现，避免两套实现长期漂移。

### 5.3 实施顺序

1. 先修复子进程代际、Provider 崩溃和 `turn.send` 回滚，建立可靠生命周期底座。
2. 把插件入口切到锁版 Pi SDK，并恢复 create/open、模型、推理强度、queue、compact、tree 和 snapshot。
3. 恢复稳定 message ID、tool/usage/queue/compaction/retry/extension 等完整事件流。
4. 接通 Core 代理只读/写入/命令工具及 Pi 专用 approval flow，验证 profile 不会静默放宽。
5. 接通 Skill/extension command 发现、checkpoint/change set、附件与 UI 状态，移除旧 Manager 生产分派。
6. 执行离线差分 harness 和真实 Provider smoke，确认旧、新实现对同一场景产生等价的归一化结果。

## 6. 完成条件

1. P0 子进程代际测试可稳定复现旧实现失败，并在修复后通过。
2. 多消息测试保留独立 item 与原始顺序；真实 Pi SDK 流证明 fixture 与当前锁版 SDK 一致。
3. 上述能力矩阵每一项都有自动化证据；暂不支持的能力不得以“插件最小闭环已工作”为由豁免。
4. 同一 execution profile、prompt、工具调用、队列、压缩和树导航场景，经旧 SDK adapter 与插件版 Pi 的差分 harness 后，归一化事件、最终 session/turn 状态和持久化时间线等价；允许的差异必须显式列入 fixture。
5. read-only、workspace-write、command disabled/approved 及 on-request approval 均验证实际 enforcement；界面持续显示 `nativeSandbox=false`。
6. restart、provider crash、abort、archive/unarchive、空会话恢复及旧 generation 晚到事件不丢历史、不串请求、不残留 running/waiting 状态。
7. session snapshot/tree、模型与推理恢复、Skill/command 发现、工具卡片、usage、queue、compaction、retry、extension、checkpoint/change set 和附件归属均通过回归。
8. 旧 `PiManager` 不再承载生产会话；插件缺失或不兼容时历史仍可读，并返回可操作错误。
9. `node --test test/pi-builtin-plugin.test.mjs`、Plugin Host Rust 测试和 `pnpm run verify` 全部通过。
10. 真实 Provider smoke 与 fixture 测试分开记录，不把 fixture 成功写成真实 Pi 验收通过。
