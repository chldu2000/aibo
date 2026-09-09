# Phase 4.7C：Pi 插件同类问题审计

> 审计范围：`5a53d5c475db38c488f75818c387bc144a34da62` 至 `bd92fdf538f427be7be4b09a75d69fc0916e7115`（含首尾提交）
> 审计对象：内置 Codex 插件修复、通用 Plugin Host 修复，以及内置 Pi 插件的同类风险
> 状态：审计完成；Pi 子进程竞态待修复，多消息投影待补充协议验证

## 1. 结论

这段提交包含 16 个与插件直接或间接相关的修复。发布协调、执行 profile、自动命名、取消、事件持久化和归档等通用宿主修复已经覆盖 Pi 插件；Codex rollout 恢复、原生 fork 和审批兼容属于 Provider 专用修复，不应机械移植。

Pi 插件仍有两个需要跟进的同类问题：

1. **已确认的子进程代际竞态**：Pi 关闭旧 Provider 进程后立即恢复时，旧进程迟到的 `exit` 回调可能清空新进程的 pending 请求。
2. **潜在的多消息投影丢失**：Pi 把一个 Aibo turn 内的所有文本聚合为一条无 item ID 的 assistant message；如果 Provider 在同一 turn 产生多条 assistant message，前序消息及其相对顺序无法可靠持久化。

当前 Pi fixture 只覆盖单进程、单 assistant message 的顺序成功路径，因此测试通过不能排除上述问题。

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
| `b2fda8b` | 打通 Codex approval/user-input，并兼容旧 release 漏报 capability | Pi 当前以 `--no-approve` 启动，不适用 |
| `87a7974` | 将 Provider 工具事件持久化为时间线卡片 | Host 已支持；Pi 当前以 `--no-tools` 启动，不产生此类事件 |
| `f9e0f47` | 增加 reasoning 事件并保持时间线位置 | Host 已支持；Pi 插件当前不发送 reasoning 事件 |
| `42445b1` | runtime teardown 与取消操作竞态时保持幂等 | 通用修复，Pi 已覆盖 |
| `9c01320` | 以 provider item ID 区分交错的多条 assistant message | Codex 已实现；Pi 尚无对应身份映射 |
| `339dfd8` | 修正 reasoning 时间线写入 | 通用 Host 修复；Pi 当前不发送该事件 |
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

## 5. 能力缺口的处理边界

Pi 插件当前显式使用 `--no-tools --no-approve`，也没有发送 reasoning 事件。这些现象在现阶段可视为有意缩小能力面，而不是本审计直接认定的缺陷；但在宣告插件版 Pi 与旧 SDK adapter 能力等价之前，必须完成以下工作：

- 对照 manifest、运行时握手和真实实现，确保不声明尚未落实的能力；
- 恢复工具或审批前，先完成 Core 代理执行、权限 enforcement 和无原生 sandbox 的明确提示；
- 为新增事件补充 Agent Runtime schema、Host 投影、UI 展示和真实 Provider 验收；
- 不得因为 Host 已支持 tool/reasoning/approval 事件，就将 Pi 标记为已经支持这些能力。

## 6. 完成条件

1. P0 子进程代际测试可稳定复现旧实现失败，并在修复后通过。
2. P1 先取得真实 Pi 多消息事件证据；若协议可产生多消息，则完成独立 item 投影及顺序测试；若不能产生，记录版本与协议依据并保留负向 fixture。
3. `node --test test/pi-builtin-plugin.test.mjs`、Plugin Host Rust 测试和 `pnpm run verify` 全部通过。
4. 真实 Provider smoke 与 fixture 测试分开记录，不把 fixture 成功写成真实 Pi 验收通过。
5. 修改只触及 Pi 插件和通用宿主的必要边界，不为 Pi 引入 Codex rollout、fork 或 approval 的 Provider 专用假设。
