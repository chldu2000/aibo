# 后台任务状态

后台任务指 Agent 原生管理的异步命令/终端，不等于子 Agent。宿主按协商能力 `background-tasks.list` 显示任务，不按 Agent 品牌判断。未声明能力的插件（包括当前 Pi）不显示任务入口，也不通过命令文本推断后台进程。

选中可运行会话后立即读取一次，随后每两秒读取，单次请求未完成时不并发追加。主回合结束后继续读取；切换、归档、只读历史会话时停止。查看后台任务不触发模型新回合，不自动向对话发送消息。未选中会话的结果在再次选中时同步。

任务显示在父回合下的独立卡片，包含名称、命令、运行中/已完成/失败/已停止/状态未知、最新摘要、任务 ID、可用的退出码和输出文件路径。命令、摘要与路径作为纯文本呈现。主会话忙闲状态不由后台任务覆盖。

## 合同与持久化

SDK 0.1.9 新增可选读取能力。清单、运行时协商和操作输出遵循 `contracts/session-features.v1.json`。响应包含 `tasks`、`recovery`、`capabilities`。任务稳定 ID 关联真实宿主 `rootTurnId`，快照最多 128 项；字符串和摘要有长度上限。

宿主将变化快照投影为 `background-task.updated` 事件（事件 `turnId: null`）与 `tool_name=background_task` 消息。父回合可以已完成，但必须属于本会话。校验当前 generation，拒绝外来父回合/任务换父；相同状态不重复增长历史。不增加或修改历史迁移。

恢复快照中的运行状态降为未知，等待原生证据。连接查询失败时显示未知，不能用历史 `inProgress` 证明进程存活，也不能因任务消失就认定成功。分支复制历史，但不继承原会话进程的运行状态。

## 适配器

- Claude Code 插件 0.4.5 通过 ACP AIR `asyncTasks` 订阅原生异步任务通知，独立保存快照，主 prompt 结束后仍可消费结果。不把 async task 转成 subagent。
- 内置 Codex 插件 2.0.18 使用原生后台终端目录（若可用）、terminalInteraction 以及父回合结束后仍在运行且有 processId 的 commandExecution 来识别后台命令。旧 CLI 不支持目录时回退到 thread/read 和原生通知，按实际退出结果更新。
- `nohup`、shell `&`、tmux 内未纳入原生管理的进程无法保证可观测。当前 Pi 不声明此能力。

宿主和插件源码需要一起更新；不会改写已安装旧 release 的绑定，也不会补造老会话缺失的任务历史。SDK 0.1.9 当前尚待发布，第三方插件协同构建使用 `AIBO_SDK=local`。

## 验证

针对性测试包含：SDK 状态恢复/乱序、Codex 识别证据和父回合结束后的 Worker 查询、Claude 主回复结束后收到失败通知、宿主投影去重/父回合归属/旧 generation 拒绝，以及两套皮肤的明暗主题、状态变化、键盘详情和窄屏显示。

运行 `pnpm run verify`、`cargo test --manifest-path src-tauri/Cargo.toml --lib session_host --no-fail-fast`、`node probes/background-tasks-browser.mjs`。第三方插件仓库运行 `AIBO_SDK=local pnpm run verify`。这些是模拟原生协议与浏览器组件验证，不代表生产账户真实模型回合或安装后的桌面应用验收。
