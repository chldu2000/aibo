# Aibo

**你的编程 Agent，同一个工作台。**

[English](README.md) | [简体中文](README_zh.md)

Aibo 是一个本地桌面编程工作台，将 Codex、Pi，以及通过插件接入的 Claude Code、Cursor
带进同一个工作区。集中管理对话、查看工具执行与审批，并引用已有会话，让下一段工作带着背景开始。

[开始使用](docs/getting-started_zh.md) · [浏览插件](https://github.com/chldu2000/aibo-plugins) · [文档导航](docs/README.md)

## 从讨论到实现，在一个工作区里继续

- **一个项目，多种 Agent。** 为调查、实现和评审创建独立会话，在同一处查找它们的历史。
- **让下一次对话接上背景。** 在输入框中用 `@` 引用同一工作区的其他会话，把已有讨论带给新的会话或 Agent。
- **看清工作如何进行。** 阅读流式回复、查看工具活动，处理 Agent 提供的审批和提问。
- **找回已经做过的工作。** 用 `⌘ K` / `Ctrl K` 搜索会话、消息和文件，在 Git 面板查看工作区内多个仓库的变更。
- **按自己的习惯组织界面。** 选择内置 Material 3 或 ak-ui，安装呈现包，或用插件扩展 Agent 和工具能力。

### 试一个完整工作流

1. 打开项目，请一个 Agent 解释准备修改的模块。
2. 在同一工作区新建会话，选择相同或另一个 Agent。
3. 输入 `@`，选中刚才的讨论，请它结合上下文制定修改计划。
4. 继续实现，查看工具活动与审批，再到 Git 面板检查 diff。

会话引用附带选中的已保存消息，不迁移原生会话，也不会自动委派任务。具体步骤见
[会话引用教程](docs/getting-started_zh.md#引用已有对话继续工作)。

## 选择你的 Agent

| Agent | 接入方式 | 首次使用前准备 |
| --- | --- | --- |
| Codex | 内置 | 安装 `codex` 并完成原生认证 |
| Pi | 内置 SDK | 配置模型提供商凭据 |
| Cursor | [插件](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/cursor) | 安装 Cursor CLI 并登录 |
| Claude Code | [插件](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/claude-code) | 安装兼容版本的 Claude Code CLI 并登录 |
| 其他 ACP Agent | [适配模板](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/acp-template) | 配置兼容 Agent Client Protocol 的实现 |

功能随 Agent 和模型而异。分支、目标、图片、模型参数与恢复能力以对应集成的实际支持为准。
使用前请查阅[接入要求](docs/getting-started_zh.md#准备-agent)和具体插件说明。

## 开始使用

下面提供可复现的源码运行方式，需要 Node.js 22+、pnpm、Rust，以及所在平台的 Tauri 2 构建依赖。

```sh
git clone https://github.com/chldu2000/aibo.git
cd aibo
pnpm install
pnpm tauri dev
```

启动后添加工作区、选择 Agent，发送第一条消息。[入门指南](docs/getting-started_zh.md)
介绍接入准备、运行时诊断和常见启动问题。已有 Aibo 桌面构建的用户可直接从[准备 Agent](docs/getting-started_zh.md#准备-agent)开始。

目前原生验收证据覆盖 **Apple Silicon Mac**。其他平台的实现与验证范围见
[平台支持矩阵](docs/plugin-platform-support-matrix.md)。开发构建与正式构建使用独立的应用数据目录。

## 扩展工作台

[aibo-plugins](https://github.com/chldu2000/aibo-plugins) 提供 Cursor、Claude Code 集成、
ACP Agent 模板，以及能力和呈现示例。构建好的能力包与呈现包分别通过设置中的对应入口安装。

Aibo 默认使用 **Material 3**，也内置 **ak-ui**。还可以构建并安装
[shadcn](packages/presentation-shadcn/README.md) 或
[Material 3](packages/presentation-material3/README.md) 呈现包，尝试不同的工作台布局和外观。

想开发扩展？从[插件开发指引](docs/plugin-development_zh.md)、
[ACP 适配器](packages/acp-adapter/README.md)或[呈现包合同](docs/presentation-package.md)开始。

## 本地工作区，连接你的 Agent

Aibo 在本地保存工作区记录与会话历史。Agent 和模型提供商仍可能将提示词、代码与工具结果发送到各自服务；
本地保存不代表离线推理。使用各集成所需的账号、订阅或 API 凭据由你准备。

Aibo 管理会话状态与宿主授权，原生 Agent 保留自己的执行规则。工作区信任不等于操作系统沙箱。
详见[常见问题](docs/getting-started_zh.md#常见问题)和[会话控制](docs/session-controls.md)。

## 文档与参与贡献

- [入门指南](docs/getting-started_zh.md)：首次会话、对话引用和问题排查。
- [文档导航](docs/README.md)：使用指南、扩展开发和技术参考。
- [开发指南](docs/development.md)：架构、目录、构建与验证。
- [参与贡献](CONTRIBUTING.md)：反馈问题、提出建议或提交改动。

Aibo 采用 [MIT 许可证](LICENSE)。第三方依赖与标识遵循各自的许可证和权利归属。
