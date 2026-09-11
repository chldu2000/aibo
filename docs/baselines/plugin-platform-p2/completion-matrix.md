# P2 退出矩阵

> 2026-09-11。P2 完成；P3 尚未开始。路径相对仓库根目录。

## 能力等价

| P0 能力 | Echo | Codex 插件 | Pi 插件 |
| --- | --- | --- | --- |
| 创建/绑定/profile | 真实 fixture 进程 + Rust Host | 真实 Tauri 通用创建；保存插件 binding 和请求 profile | 同左 |
| 流式/终态 | Unicode、消息、取消终态；原生 App 整窗切换期间持续流式 | 真实模型标记响应进入 Core timeline | 同左 |
| 取消 | Host 重复取消及唯一终态 | 真实长 turn 取消并等待终态 | 同左 |
| 审批 | 真实 Core read/write/bash；错误 session、重复响应拒绝；不声明插件原生 approval 能力 | 真实原生命令审批，经统一 IPC 接受 | 真实 Core 文件写入审批，经统一 IPC 接受 |
| 用户输入 | 不声明 | fake app-server 协议与统一前端控制器回归；本次不声称真实模型主动提问 | 不声明 |
| 模型/推理 | 真实 Host 设置/无效值拒绝、权限不变、runtime 重启恢复 | 真实设置模型与 low，应用重启保持；两套皮肤另以确定性传输验证 high→medium→保留→重挂载 | 真实设置模型与 low，应用重启保持 |
| 树/队列 | 未实现的 queue 声明已移除；非 Pi queue/tree 由独立 facade fixture 验证 | 未声明，旧线程读取/fork 保留显式兼容 | 真实树读取/当前叶导航、steer/followUp/clear |
| 归档/取消归档 | 真实 Host 关闭/恢复及卸载后历史保留 | 应用重启后归档、取消归档、恢复，历史长度一致 | 同左 |
| 重启/旧历史 | runtime 进程停止后按固定 binding 恢复；原生 App 历史/草稿重启恢复 | 两次实际 App 进程，原 binding/config/history 保留；旧原生路径、空线程兼容保留测试 | 两次实际 App 进程及恢复；旧 Pi history-only/事件投影样本保持 |

主入口默认创建由 `agent-session-controller` 注入通用 API，旧 createCodex/createPi API 名称仅委托。Node 控制器回归验证默认配置、超时恢复和迟到创建不抢选择；Rust/架构检查验证 profile 传递与 binding 优先；原生探针调用实际通用 IPC 并挂载生产 App。未将单独的 Provider CLI smoke 当成默认 UI 创建等价证据。

## 状态与呈现

| 场景 | 证据 |
| --- | --- |
| 主/插件列表、选择、草稿、时间线统一；发送只清除原会话草稿 | `test/presentation-state.test.mjs`、`test/message-draft-ownership.test.mjs` |
| 标准→专注→标准真实重新挂载；流式继续、Agent 不重启、历史/草稿/焦点保留 | `probes/p2-native.mjs`，真实 Echo 子进程与生产 App |
| 挂载失败恢复标准呈现；宿主连续收流；旧 generation/session 回调拒绝 | `probes/workbench-lifecycle.mjs`，真实 WorkbenchPresentation + 确定性宿主流；`test/presentation-lifecycle.test.mjs` 覆盖超时/清理/迟到挂载 |
| Git 提交说明与插件字段在整窗重挂载后保留 | 原生 App 验证 Git 提交说明；浏览器故障注入验证插件字段，A/B/A 会话隔离；`test/workbench-drafts.test.mjs` 验证存储往返 |
| 实际应用进程退出后恢复草稿、Git 提交说明、选择、历史及 Provider 配置 | 原生 P2 探针第二阶段，与第一阶段使用同一隔离应用标识 |
| 主/第二窗口导航互不覆盖 | 原生 P2 探针创建 secondary WebView，使用不同 session/草稿，检查主窗口状态 |
| Git 两皮肤×两布局、A/B/A、卸载恢复分页/详情、失效目标回到集合 | `probes/semantic-ui-browser.mjs`；`probes/semantic-desktop.mjs` 补真实 Tauri/Git 四组合 |
| 模型矩阵不再被旧 profile 覆盖；保留强度语义准确 | `test/model-configuration.test.mjs`、`probes/model-configuration-browser.mjs` |

## 可复跑检查与结果

- `pnpm run verify`：23 项架构检查、129 项 Node 测试、Svelte/TypeScript 检查及生产构建通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：102 项通过；保留既有 dead-code 等编译警告。
- [真实桌面/Provider 结果](./workbench-native-results.json)：隔离临时 Git 工作区、Echo 安装包、独立应用数据目录；两阶段均 `ok: true`。原生审批由脚本通过 IPC 提交，不声称人工点击审批按钮。
- [取消终态结果](./cancellation-results.json)：第二次 App 退出后只读查询隔离 SQLite，Codex/Pi 最后一个 turn 均为 `interrupted`，确认不是正常完成被误计为取消。
- [整窗故障注入结果](./workbench-lifecycle-results.json)：全部断言通过。连续流为确定性宿主测试数据；真实 Agent 不重启另由原生 Echo 探针验证。
- [Git 浏览器结果](./browser-results.json)、[原生 Git 结果](./native-results.json)、[模型矩阵结果](./model-matrix-results.json)。

执行 Rust 与前端构建/浏览器探针时按顺序运行，避免 Vite 插件扫描 Rust 临时 target 文件的竞态。原生脚本收集成功报告后主动终止 Tauri dev 进程，子进程日志中的 ELIFECYCLE 不是验收结果；外层探针退出码及 JSON 断言是判定依据。证据仅保存测试标记、临时 session ID 和模型标识，不复制用户认证文件。

移除 Echo 虚假的原生 approval 声明时，Rust 回归曾失败在等待 Core 审批：宿主自己生成的事件也被插件能力门禁拒绝。现已通过内部事件来源区分 Core/插件投影，来源不可由 wire JSON 指定；真实无原生 approval 能力的 Echo 宿主审批回归与插件能力门禁断言共同验证。此可确定复现的问题与 P0 B05 的原始偶发失败分别记录。

## 保留边界

P0 B01/B02 由本阶段修复；B04 的未实现 queue/原生 approval 声明已移除，Core 审批无需冒充插件 operation。P0 B05 未稳定复现且根因未定，原始验收例外保留，不因本次绿色运行宣布已修复。

P2 的整窗 adapter 是可信本地 Svelte 组合，公共快照/动作仍为 JSON。外部能力包/声明式贡献安装、通用 Broker 属于 P3；完整 Presentation Plugin、所有核心视图、view confirmation 非 `never` 和完整辅助技术验收属于 P4。未声称物理键盘或人工屏幕阅读器验收，也未新增同一 Core 草稿的多窗口编辑冲突协议。
