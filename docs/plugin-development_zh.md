# Aibo 插件开发指引

[English](plugin-development.md) | [简体中文](plugin-development_zh.md) | [项目 README](../README_zh.md)

本文介绍公共扩展路径并索引对应合同，中英文版本保持相同范围。
提供者专用实现历史和测试结果放在独立记录中。

## 选择扩展方式

| 目标 | 扩展方式 | 起点 |
| --- | --- | --- |
| 增加操作、服务或领域数据 | 能力提供者 | [独立样例](../examples/capability-plugin/) |
| 展示业务数据和动作 | 能力提供者 + 语义贡献 | 同一份样例，无需前端代码 |
| 接入编程 Agent | Runtime 2.1 会话能力提供者 | [会话能力协商](session-capability-negotiation.md) |
| 定制主题、控件或工作台呈现 | 可安装的 Presentation 包 | [呈现包合同](presentation-package.md) |

能力包使用 Manifest v2。旧 Agent Runtime v1 及归档指南不再是可执行接入路径。
能力描述支持范围，不代表执行授权。术语见[领域词汇](../CONTEXT.md)。

## 核对兼容要求

| 维度 | 核对内容 |
| --- | --- |
| 宿主与 OS | 清单 `host` 范围、`platforms` 和[支持矩阵](plugin-platform-support-matrix.md)；能安装不等于真实运行已验收 |
| 能力 Runtime | 精确支持版本：greeting 样例为 2.0，会话流与 control 显式使用 2.1 |
| 语义视图 | 支持的 contract 与快照格式，独立于包版本 |
| 宿主 SDK | 声明 `hostSdk` 时需宿主实现该功能并满足范围；当前样例要求 SDK `>=0.1.0 <0.2.0` |
| 会话功能与权限 | 清单、握手、open 结果与宿主 schema 一致；原生权限归属另需[会话控件合同](session-controls.md) |
| 呈现 | `presentation.json` 的 hostApi/coreSemantics 和快照声明，见包合同 |

开发版本的宿主版本号本身不能证明包含哪些源码改动。
验证时记录精确宿主提交/构建、插件 release、SDK 和原生 CLI 版本；历史说明中的提交不是已发布的最低宿主版本。

## 构建并安装样例

在 Aibo 仓库根目录先执行 `pnpm install`；需要 Node.js 22+、npm 和 `tar`。然后运行：

```sh
node --input-type=module -e 'import { buildExternalPlugin } from "./probes/build-external-plugin.mjs"; const result = await buildExternalPlugin(); console.log(JSON.stringify({ developmentRoot: result.root, installPath: result.packagePath }, null, 2));'
```

构建器打包本地 SDK tarball，在临时开发副本中离线安装为开发依赖，编译 worker，输出解包安装目录。
greeting 包包含 `plugin.json` 和 `dist/worker.js`，没有 Aibo SDK 副本或 `node_modules`；该样例没有第三方运行依赖。
公开 SDK 由宿主通过 [hostSdk](host-sdk.md) 提供。构建不启动 Aibo 或调用模型。
长期开发前将临时开发目录复制到固定位置。

通过桌面的能力插件管理入口安装并启用 `installPath`，从命令入口打开 **External SDK greeting**，
检查 `EXTERNAL_SDK_OK` 和刷新动作。直接调用能力前须由宿主选择绑定。
macOS 原生安装验收可从 Aibo 根目录运行 `node probes/external-plugin-native.mjs`；需要 Tauri 环境，
探针自行构建包，并使用隔离应用数据和临时工作区。

## 编写与打包能力插件

从相互匹配的[清单](../examples/capability-plugin/plugin.json)和 [worker](../examples/capability-plugin/worker.ts)开始。

1. 设置插件、贡献、能力和操作 ID。capabilityProvider 的操作 ID 使用插件命名空间，例如
   `dev.example.greeting.read`，且必须与运行时握手完全一致。npm 包、清单和 Worker 的 release 版本保持一致。
2. 声明 scope、effect、permissions、输入输出 schema、超时和幂等性。实现操作允许列表，返回符合 schema 的数据；
   日志写 stderr，stdout 只承载协议。
3. 响应 `tools.signal`；通过 `tools.call` 调用声明依赖，作用域与授权由 Broker 补齐。
   取消、拒绝或结果未知后，不自动重试写入。
4. 语义贡献返回内容与动作含义，不携带 HTML/CSS 或可执行 UI。样例收到
   `{ actionId: "refresh", itemId: null, offset: 0 }`，返回 `state`、`view`、`actions`，
   快照身份和 revision 由宿主补齐。受控写入参考[能力写入](../fixtures/plugins/capability-write/)与
   [语义写入](../fixtures/plugins/semantic-write/)夹具。
5. 构建并本地打包 `packages/plugin-protocol` 与 `packages/capability-runtime`，将 tarball 安装为开发依赖，
   再编译 Worker。SDK 当前未通过公共包注册表分发。
6. 声明 `hostSdk`，打包已编译入口和清单；使用 bundler 时将公开 SDK 入口设为 external。
   第三方运行库须编入业务 bundle 或显式包含在安装产物中；只写 dependencies 不会提供库文件，
   Aibo 不执行 `npm install`。详见[SDK 打包规则](host-sdk.md)。
7. 安装前检查解包产物的依赖完整性、开发机路径与符号链接。
   [`build-external-plugin.mjs`](../probes/build-external-plugin.mjs)演示无第三方运行依赖样例的完整流程。

Release 不可变。包内容改变时递增 release 版本；既有会话固定 installation/contribution，
安装更新不迁移既有会话或恢复数据。

## 接入会话提供者

会话发现使用已启用、可运行、声明 `aibo.session.open` 的 session scope capabilityProvider。
在 contribution 上提供 `displayName`，可选 `icon: { path: "M12 2L22 12L12 22L2 12Z" }`。
图标为 24 × 24 坐标系内的单色 path，最多 8192 字符，不接受完整 SVG、URL、脚本或样式。
宿主验证数据，皮肤提供配色和回退；每个 contribution 有自己的身份与依赖就绪状态。

显式使用 Runtime 2.1，并实现[会话合同](../contracts/session-capabilities.v1.json)、
[事件 schema](../contracts/session-event.v1.schema.json)和[绑定 schema](../contracts/session-binding.v2.schema.json)。
原生 ID 和 recovery 属于提供者，宿主会话/轮次身份、授权与持久历史属于 Aibo。
Control 必须在操作允许列表中；处理取消，并只在有效 invocation 内发送事件。
[内置 Worker](../src-tauri/capability-plugins/)可作实现参考，其私有共享 helper 不属于公共 SDK。

可选功能的精确 schema、握手、open 声明、响应封套和能力缺失行为见[协商规则](session-capability-negotiation.md)。
功能支持、当前可用性和授权分别判断。菜单消费宿主校验后的 `executionProfile.sessionControls`，选择只提交 control ID。
[会话控件](session-controls.md)定义原生授权、CoreProxy 和 `agent-managed` 权限归属；
不能从品牌或功能标签推导。仅打开编辑模式不授予写轮次权限。

## 扩展呈现

外部皮肤使用独立 `presentation.json` 包和[呈现打包工具](../packages/presentation-tools/)。
从[包合同](presentation-package.md)、[shadcn](../packages/presentation-shadcn/)或
[Material 3](../packages/presentation-material3/)样例开始。Worker 返回受限视觉树，可信桥绘制并转发宿主动作 token。
包不能直接访问 DOM、网络、存储或 Tauri IPC；未提供的 surface 继承宿主默认实现，管理、审批和恢复仍由宿主持有。

`UiKitAdapter`、kit 注册表与 [web-presentation 类型](../packages/web-presentation/)用于可信宿主开发，
不属于外部包安装机制。修改这些边界遵循 [UI 架构](ui-architecture.md)。新增内部组件不会自动扩展公共 controls surface。

## 专项合同

| 改动 | 参考 |
| --- | --- |
| 设置、继承及调用快照 | [Agent 设置](agent-plugin-settings.md) |
| 模型、推理、Fast、上下文窗口与用量 | [模型配置](model-configuration.md) |
| 目标生命周期和恢复准入 | [目标](goal-lifecycle.md) |
| 持久等待队列及独立协商的 steering | [消息队列](message-queue.md) |
| 子 Agent 进度与过程历史 | [子 Agent 历史](subagent-history.md) |
| 外部快照、控件与动作目录 | [呈现包](presentation-package.md) |

## 分享前验证

在插件自身仓库运行测试与打包检查，再验证产物 Worker 的握手和真实响应 schema。
会话插件另验原生创建、权限行为、取消及跨进程恢复。使用隔离数据，记录命令、版本、支持配置和未覆盖项；
不要发布凭据或原始提供者日志。

修改 Aibo 时从 Aibo 根目录运行 `pnpm run verify`，并按[回归矩阵](plugin-boundaries-and-regression.md#regression-gate)
选择 Rust、浏览器和原生检查。`pnpm run probe:session:capabilities` 使用模拟引擎验证会话工作流；
原生探针见[探针说明](native-engine-probes.md)。构建、模拟引擎、原生安装和真实桌面交互属于不同证据层级。
