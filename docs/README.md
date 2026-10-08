# 文档索引

先按你要做的事情选择入口。用户操作指南与开发合同分开维护；带日期的验收记录只描述当时的检查结果。

## 使用 Aibo

- [中文入门](getting-started_zh.md) / [English getting started](getting-started.md)：启动应用、准备 Agent、首次会话和常见问题。
- [引用已有对话](getting-started_zh.md#引用已有对话继续工作)：在新会话中继续已有讨论。
- [搜索](global-search.md)、[Git 仓库](git-repositories.md)：查找历史、消息和文件，查看多个仓库的变更。
- [安装外部插件](https://github.com/chldu2000/aibo-plugins/blob/main/docs/installation.md)：安装能力包、呈现包及排查兼容问题。
- [平台支持](plugin-platform-support-matrix.md)：已验证环境与其他平台限制。

## 扩展 Aibo

- [插件开发指引](plugin-development_zh.md) / [English guide](plugin-development.md)：从样例到安装包。
- [外部插件与模板](https://github.com/chldu2000/aibo-plugins)：Cursor、Claude Code、ACP 模板与能力/呈现示例。
- [ACP 适配器](../packages/acp-adapter/README.md)、[呈现包合同](presentation-package.md)：接入 Agent 或定制界面。

## 理解与维护 Aibo

- [开发指南](development.md)：应用架构、目录、构建和验证。
- [参与贡献](../CONTRIBUTING.md)：反馈问题与提交改动。

### 核心合同与开发参考

- [English README](../README.md)、[中文 README](../README_zh.md)：产品介绍、Agent 接入与使用入口。
- [领域词汇](../CONTEXT.md)：插件、贡献、会话身份、能力与呈现概念的统一定义。
- [插件开发指引](plugin-development_zh.md)、[English guide](plugin-development.md)：能力包、会话提供者与呈现扩展。
- [模型配置与上下文用量](model-configuration.md)：模型、推理、Fast、窗口选择及呈现动作边界。
- [会话能力声明与协商](session-capability-negotiation.md)：可选功能合同、执行授权和插件迁移。
- [宿主 SDK](host-sdk.md)：宿主提供的运行模块、`hostSdk` 版本范围与 Node 运行时解析。
- [ACP 适配器](../packages/acp-adapter/README.md)：通用 ACP 客户端、清单驱动 Worker 与配置映射。
- [Agent 插件设置](agent-plugin-settings.md)：插件声明的设置字段、作用域与持久化。
- [宿主与插件边界及回归门禁](plugin-boundaries-and-regression.md)：职责边界、插件替换与回归矩阵。
- [原生引擎探针](native-engine-probes.md)：环境要求、运行命令与结果位置。
- [数据库迁移规则](database-migrations.md)：迁移冻结、自动检查、旧库升级测试与异常修复。

## 当前架构与支持范围

- [会话能力架构与迁移验收](capability-session-migration.md)：宿主、能力插件和呈现插件的职责、旧数据策略及验证限制。
- [UI 架构与扩展边界](ui-architecture.md)：分层、状态所有权、内部 UI Kit、外部 Presentation 与验证入口。
- [Aibo ak-ui 现行规范](design/ak-ui-current-spec.md)：可选 ak-ui 外观的视觉、密度、交互与响应式要求。
- [内置 Material 3](design/material3-current-spec.md)：默认内置外观、配色与明暗选择、主题兼容及交互保留规则。
- [全局搜索](global-search.md)：统一检索、索引范围、结果定位与快捷键。
- [会话控制](session-controls.md)：模式、权限控制与执行策略。
- [消息队列](message-queue.md)、[目标生命周期](goal-lifecycle.md)、[Git 仓库](git-repositories.md)：会话与工作区专项行为。
- [会话历史读取工具](session-history-tool-design.md)、[会话上下文与交接](session-context-and-handoff-plan.md)：引用会话与 `aibo_read_session`。
- [工作区信任偏好](workspace-preferences.md)、[子 Agent 任务与过程历史](subagent-history.md)：专项行为与持久化合同。
- [插件平台支持矩阵](plugin-platform-support-matrix.md)：协议、SDK、平台和发布范围。
- [协议合同](../contracts/README.md)、[能力 Runtime SDK](../packages/capability-runtime/README.md)。

## 呈现插件与当前交付

- [Material Design 3 交互设计稿](design/material3-redesign.html)：保留现有三栏布局的组件外观探索，可直接在浏览器打开。支持浅深主题、会话与审批、Git 和五类设置的模拟交互；未连接原生宿主，不替代现行 UI 规范。

- [Presentation 包合同](presentation-package.md)：manifest、Worker、视觉树、动作及状态恢复；当前皮肤包 0.4.1（宿主 API 1.1.0）、共享工作台 0.2.2。
- [Presentation 0.3.0 交付](presentation-release-0.3.0.md)：首次交付基线（历史记录）：安装、本地 ZIP 与离线 SDK。
- [退出审计](presentation-plugin-exit-audit.md)：P0–P4 完成结论和浏览器、原生验收边界。
- [重构实施记录](presentation-plugin-refactor.md)：按阶段保留的过程记录；早期未完成项以最终退出审计为准。

## 迁移提案

以下计划按各自标注的阶段推进；未实施部分不改变现行规则。

- [内置外观并入 Presentation 合同](presentation-unification-migration.md)：内置 kit 成为预装可信 release（P0–P2 已实施，P3 未实施），复合控件统一为纯数据合同。
- [合同版本收敛](contract-version-consolidation.md)：每个合同族只保留当前版本与兼容读取版本，版本转换在边界完成。
- [SDK 公开发布与按仓库安装插件](sdk-and-plugin-distribution.md)：D1 已实施，已登记的 npm SDK 发布基线为 `@aibolabs/*` 0.1.8；当前源码 SDK 版本见[宿主快照](../packages/plugin-host/sdk.json)，发布记录见[版本登记](../packages/plugin-host/sdk-releases.json)；按 Git 仓库的 Release 索引下载、校验并安装插件（D2–D4）未实施。
- [ACP 作为 Agent 接入主干](acp-first-agent-integration.md)：A1–A7 已实施（通用适配层、清单驱动 Worker、Claude Code 接入、宿主工具接线、多选项审批与回合内模式转换、清空上下文、表单提问）；剩余缺口见计划正文。

## 验收记录

带日期的专项验收，保留当时的基线、命令与结论；现行规则以上方文档为准。

- [会话启动验收](session-startup-validation.md)、[模型参数作用域验收](model-parameter-scope-validation.md)、[按需 Node 运行时验收](node-runtime-validation.md)。

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
