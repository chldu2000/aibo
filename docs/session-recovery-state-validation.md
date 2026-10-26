# 会话恢复状态修复验收

日期：2026-10-25。范围：[目标规格](session-recovery-state-spec.md)。记录源码实现与隔离测试，不表示已经替换用户正在运行的 Aibo 或已恢复生产账户的原生线程。

## 实现

- Broker 分别报告 request_id_invalid、binding_mismatch、input_too_large；细节保留 UTF-8 实际大小、上限与受限字段。传输帧超限、恢复版本/文件/写入故障与原生恢复失败单独分类，中英文文案与结构化诊断同步。
- 新 Codex/ACP 恢复入口引用插件私有目录中的不可变修订。旧内联任务可迁移；文件与目录落盘后才发布引用，旧修订保持可读。磁盘配额失败不覆盖最后入口。
- 任务列表采用有界摘要页，输出按需分块读取并核对内容修订，避免恢复入口和列表重复携带输出。Unicode 截断不拆开代理对；运行中与 unknown 任务不参与容量淘汰。
- Codex 2.0.22、Pi 2.0.12 与外部 Claude Code 0.4.9 源码更新；源码 SDK 为尚未发布的 0.1.13。未修改已安装插件、真实会话数据库或原生历史。

## 证据入口

| 边界 | 覆盖 |
| --- | --- |
| `test/recovery-state.test.mjs` | 旧大状态转小引用；缺失/损坏/跨会话/符号链接拒绝；容量耗尽；复制至新目录；写入中和发布前强杀；Unicode 分块；游标/修订与切换会话；实际 Codex 和未知 ACP Worker 重启恢复（模拟原生协议） |
| `capability_broker::tests::request_validation_distinguishes_identity_binding_and_utf8_size` | 同一拒绝路径的错误优先级、字节边界与精确分类 |
| `capability_broker::tests::legacy_recovery_budget_is_confined_to_resume_and_limits_profile` | 旧恢复兼容额度不扩散到普通调用/创建，配置单独受限 |
| `session_host::tests::oversized_legacy_codex_recovery_migrates_before_sending_and_preserves_identity` | 真实 Broker/SQLite/Worker 链路：旧内联恢复超过 64 KiB，继续原生线程，发送一次增量，重新启动，并验证跨 release 私有状态复制 |
| 既有 SessionHost/插件迁移测试 | 固定绑定、升级失败回滚、旧版本撤销、归档/关闭、队列、审批及只读历史 |
| `test/presentation-timeline.test.mjs`、`probes/background-tasks-browser.mjs` | 外部动作 token、纯文本输出、截断说明；Material 3/ak-ui 浅深色、键盘操作、窄屏与旧历史 |

## 检查结果

- `pnpm run verify`：迁移不可变性、SDK、44 项架构检查、类型检查、717 项 Node 测试及生产构建通过。
- `RUST_MIN_STACK=33554432 cargo test --manifest-path src-tauri/Cargo.toml --lib session_host --no-fail-fast`：64 项通过，1 项真实账户/已构建插件探针按其原有条件忽略。
- `RUST_MIN_STACK=33554432 cargo test --manifest-path src-tauri/Cargo.toml --lib --no-fail-fast`：438 项通过，4 项原有条件忽略；1 处插件最低 SDK 版本断言已同步并复跑通过，1 处日志锁测试出现 WouldBlock，单独复跑通过。完整串行复跑为 439 项通过、1 项失败、4 项忽略：失败项为既有诊断日志清理测试 `denied_cleanup_stops_growth_and_preserves_active_run_lease_during_recovery`（旧文件存在性断言），随后单独复跑通过。两项诊断测试呈间歇失败，根因未确认；不将完整 Rust 测试记为全绿。
- 补充跨 release 的大状态迁移测试：通过；确认恢复文件复制、原生线程身份与输出读取。
- 插件仓库 `AIBO_SDK=local pnpm run verify`：60 项测试通过、1 项按原有条件忽略，插件构建及 MCP 冒烟通过。沙箱最初阻止本机监听，允许本机测试端口后通过。
- `node probes/background-tasks-browser.mjs`：两套皮肤、浅深主题与新输出按钮通过。
- `node probes/presentation-full-skins-browser.mjs`：在工具组摘要高度必须为 36px 的既有断言处失败。用 `git archive HEAD` 创建无本次修改的临时副本后，同一探针在同一断言失败，浏览器均无 pageerror；不将其记为通过，也不在本次恢复修复中改动无关工具组样式。
- 本次文档相对链接与两个仓库的 `git diff --check`：通过。

## 验证边界

原生 Worker 测试运行真实进程与真实私有存储，但 Codex/ACP 协议由测试程序模拟；未调用生产模型，也未宣称用户原生线程已实际恢复。部署需重新构建 Aibo 并通过现有插件升级/迁移安装新版；SDK npm 发布和插件远端发布不在本次执行范围。

不可变修订当前保守保留，目录达到 64 MiB 会明确拒绝新状态保存；自动回收依赖未来的宿主引用确认机制。列表只保留当前最多 128 项任务，终态淘汰后的详情可能不可用，已有宿主历史和旧修订不被改写。
