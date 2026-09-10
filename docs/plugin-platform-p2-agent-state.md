# P2：统一 Agent 路径与 UI 状态

> 2026-09-11，实施中。P1 已在 `7a5f3f9` 验收；本文不表示 P2 退出条件已经通过。

## 第一批：修复能力身份误判

此前仅声明 `queue.manage` 或 `session.tree` 的外部 Agent 会被归为 Pi；声明 `permissions.nativeSandbox` 则会被归为 Codex。本批移除前端命令和模型 API 选择中的推断，能力只决定可用操作，不再决定前端 Provider 身份。内置 Agent 的名称别名暂用于兼容展示。Rust 执行配置的同类推断尚未移除，原因见下文。

新增注入式 `agent-facade.ts`：先检查能力，再按 session 的插件绑定调用统一 capability API。插件失败不会退回旧 Provider；无绑定的外部 Agent 不会误走 Pi。宿主仍负责校验实际绑定、协商能力与 operation schema，前端检查不替代宿主验证。

- 队列发送、清空、会话树读取和导航通过 facade；关闭会话使用已有统一 `closeAgentSession`。
- 已绑定插件的命令/技能读取按 `command.list` / `skill.list` 调用，不落入默认 Codex API；外部插件不再获得 Codex 内建命令。
- `compatibility/legacy-tree.ts` 集中旧的无绑定 Pi 树接口，只接受准确的旧身份。退出条件：旧无绑定 Pi 历史的树读取/导航完成迁移或明确退役；不能仅因新会话均为插件而删除。
- 清空队列捕获原始 session，异步结果不能覆盖另一个已选会话。

新增回归覆盖外部 Agent 同时声明 queue/tree/sandbox、绑定传递、未声明能力拒绝、插件失联不降级，以及通过生产树控制器导航。原有树测试使用明确的查询启动信号，继续验证切换会话后旧查询不能覆盖当前时间线。

## 尚未完成的 P2 工作

1. 逐项迁移创建、模型设置、审批、目标、线程恢复等剩余专用装配，集中显式兼容模块并扩展架构约束。当前 facade 的架构检查只覆盖新通用入口、能力身份判断和关闭操作，不能代表全部路由已收敛。
2. 统一插件列表、选择、草稿和时间线状态所有者，冻结窗口隔离、存储键、保存时机及保留期限，并验证重启恢复与失效目标。
3. 实现可序列化 PresentationSnapshot、受限 channel、presentation generation、订阅清理、切换和默认 renderer 失败恢复。
4. 复跑完整 P0 等价矩阵及真实 Codex/Pi 链路。首批自动测试不代表完成真实 Provider 或整窗 renderer 切换验收。

## Rust 配置迁移发现

试移除 Rust `execution_profile_agent` 的能力推断后，完整测试为 100/101，通过条件缺失发生在 Echo 等价测试等待 `waiting_approval`：该样例给 Echo 保存 Pi 的受控写入配置，而读取配置又按 Provider 重新解析。取消能力推断会把它收紧为通用插件只读配置，写入不再进入原审批流程。这不是可直接忽略的旧测试波动。

本批已撤回这项 Rust 修改，保留写入/审批回归约束。后续应把宿主受控执行配置与 Provider 名称解耦，明确配置授予及恢复，再同步移除 Rust 推断；不能通过给 queue/tree 赋予写权限或删除 Echo 审批断言来完成迁移。P2 整体路由退出条件因此仍未达成。

## 首批验证结果

- `pnpm run verify`：21 项架构检查、115 项 Node 测试、类型检查与构建全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：保留原 Rust 配置后 101/101 通过；最终变更不包含 Rust 代码修改。
- 初次前端构建与 Rust 编译并行时，样式插件扫描编译器临时目录遇到 ENOENT；后续无并发编译的完整验证通过。
- 本批未执行真实 Codex/Pi 请求或 renderer 切换验收，相关阶段项保持未完成。
