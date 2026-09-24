# 历史文档归档

早期文档于 2026-09-12 归档，后续历史基线持续补充。这里的设计、状态和验收结果只描述各自的当时版本，不能代替
[当前文档](../README.md)。历史链接若指向已删除的源文件或旧脚本，应结合文中提交号
或 Git 历史查看；不会为归档文档恢复旧执行实现。

## 旧设计与讨论

- [Aibo 多 Agent 工作台：调研、架构建议与实施计划](aibo-research-and-delivery-plan.md)
- [Aibo 架构评审冻结：macOS 首发与 Phase 1 准备](architecture-freeze.md)
- [第一轮](discuss-with-gpt.md)
- [Agent Plugin 开发指南（Runtime v1）](plugin-development.md)
- [Aibo 向插件宿主、能力插件与 UI 插件演进](plugin-platform-evolution.md)
- [插件平台语义交互与状态规则](plugin-platform-interaction-decisions.md)
- [历史 README 快照](readme-history.md)

## 早期开发阶段

- [Phase 0 技术探针结论](phase-0-findings.md)
- [Phase 1：Codex 真实会话垂直链路](phase-1-codex-vertical-slice.md)
- [Phase 2：Codex Adapter 能力扩展](phase-2-codex-capability-expansion.md)
- [Phase 3：Pi SDK Adapter](phase-3-pi-adapter.md)
- [Phase 4：统一会话体验](phase-4-unified-session-experience.md)
- [Phase 4.5：常规 Agent 工作台能力补全](phase-4.5-agent-workbench-completion.md)
- [Phase 4.5 macOS 验收记录](phase-4.5-macos-smoke-report.md)
- [Phase 4.6：Agent 工作台控制与交互补全](phase-4.6-agent-workbench-controls.md)
- [Phase 4.7：Agent 支持插件化](phase-4.7-agent-plugins.md)
- [Phase 4.7A：Agent 插件契约与迁移设计](phase-4.7a-plugin-contracts.md)
- [Phase 4.7B：宿主接线与异常场景检查](phase-4.7b-host-wiring-check.md)
- [Phase 4.7C：Pi 插件同类问题审计](phase-4.7c-pi-plugin-fix-audit.md)

## 插件平台演进与验收

- [P5 核心数据库与历史迁移退出核对](plugin-platform-database-exit-audit.md)
- [Aibo 插件宿主演进最终退出审计](plugin-platform-final-audit.md)
- [插件平台演进实施 Checklist](plugin-platform-implementation-checklist.md)
- [P0：插件平台边界与回归基线](plugin-platform-p0-baseline.md)
- [P1：Git 只读语义切片实施记录](plugin-platform-p1-semantic-slice.md)
- [P2：统一 Agent 路径与 UI 状态](plugin-platform-p2-agent-state.md)
- [P3 第二批：Broker 与无 Agent 只读运行链](plugin-platform-p3-broker.md)
- [P3 第四批：只读插件调用链](plugin-platform-p3-call-chain.md)
- [P3 收尾：贡献合同、兼容与 release 生命周期](plugin-platform-p3-completion.md)
- [P3 第三批：声明依赖解析与 release 固定](plugin-platform-p3-dependencies.md)
- [P3 第五批：Git 只读能力包与语义贡献安装](plugin-platform-p3-git.md)
- [P3 第六批：实例身份、turn 关联与能力事件](plugin-platform-p3-lifecycle.md)
- [P3 第一批：Manifest v2 与统一贡献目录](plugin-platform-p3-manifest.md)
- [P4 第三十八批：无障碍树与原生恢复入口](plugin-platform-p4-accessibility.md)
- [P4 通用 Capability 写入：直接调用](plugin-platform-p4-capability-writes.md)
- [P4 退出条件核对](plugin-platform-p4-exit-audit.md)
- [P4 第三十九批：旧能力调用快照](plugin-platform-p4-legacy-capability-history.md)
- [P4 第一批：呈现描述与降级协商](plugin-platform-p4-presentation.md)
- [P4 第三十六批：统一 reduced-motion 策略](plugin-platform-p4-reduced-motion.md)
- [P4 第三十二批：安装语义视图写动作](plugin-platform-p4-semantic-writes.md)
- [P4 第三十四批：专业文本阅读与核心回退](plugin-platform-p4-specialized-presentation.md)
- [P4 第四十批：明确快照版本支持](plugin-platform-p4-version-contract.md)
- [P4 第三十七批：重排后的可用焦点恢复](plugin-platform-p4-workbench-focus.md)
- [P4 第三十五批：实际工作台重排与宽度调整](plugin-platform-p4-workbench-reorder.md)
- [P4 第三十三批：默认工作台命名槽位](plugin-platform-p4-workbench-slots.md)
- [P4 插件间写调用](plugin-platform-p4-write-chain.md)
- [P5：公共协议与 SDK](plugin-platform-p5-sdk.md)
- [Release 回滚与数据恢复验收](plugin-platform-release-recovery.md)

## 会话迁移历史

- [会话能力迁移实施记录（历史）](capability-session-migration-history.md)

## 旧设计决定

- [ADR-0001：旧 Agent 插件进程与视图协议](adr/0001-process-isolated-agent-plugins.md)。当前会话能力职责见[迁移说明](../capability-session-migration.md)。

## 专项实现基线

- [内置模型上下文规格](model-context-window-baseline.md)：Codex 2.0.9 / Pi 2.0.5 的来源、实现与验证限制；当前合同见[模型配置](../model-configuration.md)。

## 历史验收附件

[baselines/](baselines/) 保存 P0–P5 的 JSON、截图和退出矩阵。它们随对应阶段文档归档，
原始证据内容未改写；其中的原始路径、时间和提交哈希仍代表当时环境。
