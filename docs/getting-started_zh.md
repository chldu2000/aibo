# 开始使用 Aibo

[English](getting-started.md) | [简体中文](getting-started_zh.md) · [返回首页](../README_zh.md)

本指南从启动桌面应用开始，完成第一次对话，再把已有讨论带进下一项工作。
目前原生验收覆盖 macOS arm64，其他环境见[平台支持矩阵](plugin-platform-support-matrix.md)。

## 启动应用

已有桌面构建可以直接打开。源码运行需要 Node.js 22+、pnpm、Rust 和所在平台的 Tauri 2 构建依赖：

```sh
git clone https://github.com/chldu2000/aibo.git
cd aibo
pnpm install
pnpm tauri dev
```

等待桌面窗口打开。单独运行 `pnpm dev` 只提供浏览器预览，实际执行 Agent 需要桌面后端。
开发/debug 构建与正式构建的数据目录独立；开发环境首次打开为空，不代表正式环境的历史被删除。

已安装的桌面构建缺少 Node 时，打开 **设置 → 运行与诊断**。Aibo 可以查找本机兼容 Node、
使用你选择的可执行文件，或在你点击下载后安装专用运行时。安装插件不会执行 npm。
详见[运行时说明](host-sdk.md)。

## 准备 Agent

| Agent | 准备步骤 | 成功标志 |
| --- | --- | --- |
| Codex | 安装原生 CLI，让 Aibo 能找到 `codex`，完成原生认证 | Codex 会话能打开并完成模型请求 |
| Pi | 配置 Pi 所选模型的提供商凭据 | 所选模型能返回回复 |
| Cursor | 安装 Cursor CLI 并登录，再安装、启用 [Cursor 插件](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/cursor) | 插件依赖检查通过，能新建 Cursor 会话 |
| Claude Code | 按[插件要求](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/claude-code)安装 CLI 并认证，再安装、启用插件 | 插件依赖检查通过，能新建 Claude Code 会话 |

Pi 普通会话使用项目集成的 SDK，不要求另装 Pi CLI。默认配置从 `~/.pi/agent/auth.json` 读取提供商凭据，
可以复用已有 Pi 登录。使用 API key 时，按 [Pi 提供商指南](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/providers.md)
的认证文件格式添加对应条目，保留已有提供商配置。安装依赖后，也可查阅锁定 SDK 自带的
`node_modules/@earendil-works/pi-coding-agent/docs/providers.md`。

外部 Agent 使用原生登录或插件文档指定的配置，
不要假定终端里导出的 API key 会传入插件进程。模型出现在选择器里也不代表账号有权限或额度调用。

插件包获取与兼容要求见[安装指南](https://github.com/chldu2000/aibo-plugins/blob/main/docs/installation.md)。
当前源码与已发布的 Aibo 构建可能提供不同版本的 SDK。

## 发出第一条消息

1. 点击 **添加工作区**，选择项目目录；确认侧栏出现该工作区。
2. 在工作区中创建会话，选择一个可用 Agent。
3. 如果集成提供模型和模式选择，按需设置；先处理依赖或认证错误。
4. 发送：“请解释这个项目的目录结构，建议我从哪里开始阅读。”
5. 查看流式回复和工具活动，在需要时回答提问或处理审批。

要求修改代码前，检查工作区信任与会话执行设置。审批取决于所选策略和原生 Agent，并非每个工具操作都弹出确认。
完成修改后，在 Git 面板选择对应仓库并检查 diff。

## 引用已有对话继续工作

1. 保留第一次讨论，在同一工作区新建另一个会话。
2. 在消息输入框中输入 `@`，选中刚才的会话；同一个选择器也会展示文件。
3. 检查附带的会话引用，发送：“根据引用的讨论，提出一个小范围的实现计划。”
4. 在新会话继续工作，原会话仍可从历史中查看。

默认引用最近 12 条用户/助手消息。可以在 **工作台设置 → 工作区 → 会话引用** 中修改为其他条数或全部消息。
引用仍有大小限制，超限时需要缩小范围。

引用保存所选对话正文，默认不含工具输出正文。协商了宿主历史工具的 Agent 可以按需查询额外的持久化历史，
其他集成只收到摘录。引用不转移权限、原生会话状态，也不会自动把任务交给另一个 Agent。

## 找回工作与切换外观

按 `⌘ K` / `Ctrl K` 或双击 Shift 打开全局搜索，查找会话、消息与文件；可以按工作区缩小范围。
索引范围与限制见[搜索说明](global-search.md)。

在工作台外观设置中选择 Material 3 或 ak-ui。安装外部呈现包时，点击 **安装皮肤插件**，
选择构建产物中包含 `presentation.json` 的目录，再选中该呈现。能力插件使用独立安装入口。

## 常见问题

### Aibo 包含模型访问额度吗？

使用各 Agent 和模型提供商所需的账号、订阅或 API 凭据由你准备。
模型被列出不代表 Aibo 能授予对应账号调用权限。

### 所有内容都在离线运行吗？

工作区记录与 Aibo 保存的会话历史在本地。Agent 仍可能将提示词、代码和工具结果发送到远端服务，
网络需求与数据处理取决于你选择的集成和提供商。

### 能导入或迁移任意原生 Agent 对话吗？

不要假定 CLI 或桌面产品里的所有历史都会自动导入。恢复能力取决于对应集成与原生会话支持。
Aibo 的会话引用在 Aibo 会话间共享已保存消息，不是原生会话迁移。

### 为什么找不到 Agent，或者模型不能使用？

依次检查运行时诊断、CLI 路径和登录、插件启用状态、平台与宿主 SDK 兼容性。
模型错误应结合提供商返回的信息和账号权限排查。安装成功与真实模型请求成功是不同阶段。

### 为什么安装新插件后，旧会话没有更新？

会话保留原提供者版本绑定，直到受支持的宿主迁移成功。测试新版本时先创建新会话，
旧会话按对应插件的升级说明处理。

### 为什么有些会话没有某个按钮？

Aibo 按当前集成、模型与会话状态显示能力。图片、分支、目标、推理参数与恢复并非全部 Agent 都支持，
请查阅对应插件说明。

### 工作区可信是否意味着沙箱隔离？

不是。Aibo 宿主授权与原生 Agent 权限执行分别生效。Cursor 和 Claude Code 管理原生文件、命令与网络权限，
Aibo 转发它们实际提出的审批。具体边界见[会话控制](session-controls.md)。

仍有问题时，请在 [issue](https://github.com/chldu2000/aibo/issues) 中提供 Aibo 构建、系统与架构、
Agent/插件版本、复现步骤和脱敏错误信息。
