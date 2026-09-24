# 文档索引

## 入门与开发

- [English README](../README.md)、[中文 README](../README_zh.md)：功能、架构图、运行与目录导航。
- [领域词汇](../CONTEXT.md)：插件、贡献、会话身份、能力与呈现概念的统一定义。
- [插件开发指引](plugin-development_zh.md)、[English guide](plugin-development.md)：能力包、会话提供者与呈现扩展。
- [会话能力声明与协商](session-capability-negotiation.md)：可选功能合同、执行授权和插件迁移。
- [原生引擎探针](native-engine-probes.md)：环境要求、运行命令与结果位置。

## 当前架构与支持范围

- [会话能力架构与迁移验收](capability-session-migration.md)：宿主、能力插件和呈现插件的职责、旧数据策略及验证限制。
- [UI 架构与扩展边界](ui-architecture.md)：分层、状态所有权、内部 UI Kit、外部 Presentation 与验证入口。
- [Aibo ak-ui 现行规范](design/ak-ui-current-spec.md)：默认工作台的视觉、密度、交互与响应式要求。
- [工作区信任偏好](workspace-preferences.md)、[子 Agent 任务与过程历史](subagent-history.md)：专项行为与持久化合同。
- [插件平台支持矩阵](plugin-platform-support-matrix.md)：协议、SDK、平台和发布范围。
- [协议合同](../contracts/README.md)、[能力 Runtime SDK](../packages/capability-runtime/README.md)。

## 呈现插件与当前交付

- [Presentation 0.3.0 交付](presentation-release-0.3.0.md)：版本、安装、本地 ZIP 与离线 SDK。
- [Presentation 包合同](presentation-package.md)：manifest、Worker、视觉树、动作及状态恢复。
- [退出审计](presentation-plugin-exit-audit.md)：P0–P4 完成结论和浏览器、原生验收边界。
- [重构实施记录](presentation-plugin-refactor.md)：按阶段保留的过程记录；早期未完成项以最终退出审计为准。

## 仍适用的设计决定

- [0002-capability-and-semantic-contract-governance](adr/0002-capability-and-semantic-contract-governance.md)
- [0003-semantic-action-responsibilities](adr/0003-semantic-action-responsibilities.md)
- [0004-workspace-capability-runtime-isolation](adr/0004-workspace-capability-runtime-isolation.md)
- [0005-plugin-protocol-stability-and-compatibility](adr/0005-plugin-protocol-stability-and-compatibility.md)
- [0006-presentation-state-and-result-ownership](adr/0006-presentation-state-and-result-ownership.md)
- [0007-presentation-core-and-fallback](adr/0007-presentation-core-and-fallback.md)
- [0008-unified-presentation-plugins](adr/0008-unified-presentation-plugins.md)
- [0009-presentation-package-isolation](adr/0009-presentation-package-isolation.md)

## 历史归档

[归档索引](archive/README.md)收录早期设计、旧 Agent Runtime v1 指南、阶段报告和历史
验收基线。归档内容保留当时的状态、命令和结论，不作为当前架构或操作指南；旧文件名
和提交标识用于追溯。仍适用的 ADR 留在 `docs/adr/`。
