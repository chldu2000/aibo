# Aibo 插件开发指引

[English](plugin-development.md) | [简体中文](plugin-development_zh.md) | [项目 README](../README_zh.md)

## 选择扩展方式

| 目标 | 扩展方式 | 起点 |
| --- | --- | --- |
| 增加操作、外部服务或领域数据 | 能力提供者 | [独立样例](../examples/capability-plugin/) |
| 在工作台展示插件数据与动作 | 能力提供者 + 语义视图 | 同一份样例，无需编写前端代码 |
| 接入编程 Agent | 使用 Runtime 2.1 的会话能力提供者 | [内置提供者](../src-tauri/capability-plugins/) |
| 改变布局、渲染或皮肤 | 可安装的隔离呈现包 | [呈现包合同](presentation-package.md) |

新能力插件使用 Manifest v2。旧 Agent Runtime v1 和归档中的旧开发指南已不适用于执行接入。
能力声明描述插件能做什么，本身不授予工作区权限。准确的协议和平台组合见[支持矩阵](plugin-platform-support-matrix.md)。

## 构建并安装可运行样例

先在 Aibo 仓库根目录执行 `pnpm install`，确保 Node.js 22+ 和 `tar` 可用，然后运行：

```sh
node --input-type=module -e 'import { buildExternalPlugin } from "./probes/build-external-plugin.mjs"; const result = await buildExternalPlugin(); console.log(JSON.stringify({ developmentRoot: result.root, installPath: result.packagePath }, null, 2));'
```

构建器会打包本地 SDK，将样例复制到仓库外的临时目录，离线安装 SDK tarball，编译
worker，并把运行依赖一起打包。输出的 `installPath` 是解包后的安装目录，包含
`plugin.json`、`dist/worker.js` 和必需的 `node_modules`。这一步不启动 Aibo，也不调用模型。
输出的开发目录会保留供检查；需要长期开发时，请复制到固定位置。

在桌面应用的「插件」入口中填入 `installPath`，安装并启用。样例会贡献名为
**External SDK greeting** 的 command 语义视图，从命令入口打开后可看到
`EXTERNAL_SDK_OK` 和刷新动作。直接调用能力时，需先由宿主选择并绑定提供者。

如需自动验证 macOS 桌面安装、调用和生命周期，可运行：

```sh
node probes/external-plugin-native.mjs
```

此探针自行构建插件，使用隔离应用标识和临时工作区，需要可用的 Tauri 开发环境。
直接用 `node` 启动 worker 不等于完整验证：worker 会在 stdin 上等待宿主协议握手。

## 编写能力包

[样例清单](../examples/capability-plugin/plugin.json)与[worker](../examples/capability-plugin/worker.ts)
是一套相互匹配的实现。复制后按以下步骤修改：

1. 使用自己的 `pluginId`、贡献 ID、操作 ID 和能力命名空间。清单版本必须与 worker 的 `pluginVersion` 一致。
2. 声明 `host`、`platforms` 和准确的运行协议版本。样例使用 Runtime 2.0 与 Semantic View 1.0，不能从 SDK 包版本推导线协议版本。
3. 为每个操作声明作用域、输入输出 JSON schema、effect、permissions、超时和幂等性。不需要工作区的操作使用 `application`；需要工作区或会话身份时使用 `workspace`、`session`。
4. 只实现允许列表中的操作，返回符合 schema 的数据。日志写入 stderr，stdout 只承载协议消息。
5. 响应 `tools.signal` 的取消信号。依赖其他提供者时使用 `tools.call`，作用域、调用身份和授权由 Broker 补齐。取消、拒绝或结果未知后，不自动重试写入。

语义视图引用清单中声明的提供者操作。样例查询实际收到的是
`{ actionId: "refresh", itemId: null, offset: 0 }`，不是空对象。输出包含 `state`、
`view` 和 `actions`，快照身份与 revision 由宿主补齐。视图只表达内容和意图，不包含
HTML、CSS、皮肤 ID 或可执行界面代码。

写操作必须声明 write effect 和需要的权限，由宿主管理审批、工作区准入与持久化结果。
用户为会话选择的执行配置直接授权该会话的顶层轮次，不再弹出第二次宽泛权限确认；
它不是任意插件写入或嵌套依赖写入的通行证。
宿主持久化语义化的 `approvalReviewer`（`user`、`auto-review` 或 `none`）；原生
Adapter 负责将它转换为提供者特有的审核路由与权限授权。
可结合契约阅读[能力写入夹具](../fixtures/plugins/capability-write/)和[语义写入夹具](../fixtures/plugins/semantic-write/)。

## 打包自己的改动

[`probes/build-external-plugin.mjs`](../probes/build-external-plugin.mjs)展示了完整打包流程。
长期维护的插件项目可在自己的开发目录中重复以下步骤：

1. 使用 TypeScript 构建 `packages/plugin-protocol`，再用 `npm pack --ignore-scripts` 分别打包它和 `packages/capability-runtime`。
2. 在插件项目中安装这两个本地 tarball。SDK 尚未发布公共注册表，不要直接依赖公网包名安装。
3. 使用 `tsc -p tsconfig.json` 编译 `worker.ts`。最终 `package.json` 的运行依赖使用版本号，不携带开发机器上的 tarball 路径。
4. 在插件项目运行 `npm pack --ignore-scripts`。样例的 `bundledDependencies` 包含两个 SDK；检查产物中有清单、编译后的入口和运行依赖，没有工作区符号链接或宿主源码导入。
5. 将产物解包到目录，再从 Aibo 安装该目录。发布改动时，同时递增清单和 worker 的插件版本。

插件 release 不可变，会话固定绑定提供者安装。安装新版本不会静默迁移正在使用的会话
或恢复数据。升级前应验证停用/启用、依赖缺失、版本不兼容和会话恢复行为。

## 接入会话型 Agent

新建会话轮盘自动发现已启用且依赖就绪的 session scope `aibo.session.open` 提供者。请在该 `capabilityProvider` contribution 上声明 `displayName` 和可选的 `icon`：

```json
"icon": { "path": "M12 2L22 12L12 22L2 12Z" }
```

图标是 24 × 24 坐标系中的单色 SVG path 数据，可包含多个子路径，最长 8192 字符。宿主验证数据，皮肤负责颜色和状态效果；不支持完整 SVG、图片 URL、脚本或样式。未提供图标时显示通用菱形。插件安装后还需启用并满足运行依赖，入口才会出现在轮盘中；禁用或卸载后入口消失。一个插件可以声明多个会话提供者，各自拥有名称和图标。

从当前 [Codex worker](../src-tauri/capability-plugins/codex/worker.mjs)、
[Pi worker](../src-tauri/capability-plugins/pi/worker.mjs)及其共用的
[session provider](../src-tauri/capability-plugins/session-provider.mjs)入手。
共用文件是仓库内实现参考，不是已发布的 SDK API。

- 显式使用 Runtime 2.1 处理轮次事件流和执行中控制；helper 默认仍是 2.0。
- 实现共享的[会话能力契约](../contracts/session-capabilities.v1.json)、[会话事件](../contracts/session-event.v1.schema.json)和[恢复绑定](../contracts/session-binding.v2.schema.json)。
- 原生引擎 ID 留在原生绑定中。会话和轮次身份、首条消息命名、权限决定、事件校验和持久化历史由宿主管理。
- 控制操作必须进入允许列表。事件只能在 invocation 有效期内发送；处理取消，并拒绝已不属于活动调用的控制。
- 不能通过增加清单字段自行声明权限执行后端。尚未与宿主协商执行保障的外部提供者只能获得受限配置；原生沙箱支持需要宿主集成与验证。

## 扩展呈现

使用独立 `presentation.json` 包定制主题、控件、核心语义视图或整个工作台。
从[包合同](presentation-package.md)、[打包工具](../packages/presentation-tools/)及
[shadcn](../packages/presentation-shadcn/)、[Material 3](../packages/presentation-material3/)
独立样例开始；安装与离线 SDK 见 [0.3.0 交付说明](presentation-release-0.3.0.md)。

可执行包在可终止 Worker 中返回受限视觉树，可信 iframe 桥绘制并转发宿主验证的
动作。包不能直接访问 DOM、网络、存储或 Tauri IPC。未提供的范围继承宿主默认实现，
管理、审批与恢复仍归宿主。能力包 Manifest v2 的 presentation 元数据不授予此执行
资格；能力插件声明自身数据和操作入口时仍使用语义贡献。

随宿主集成呈现时，参考
[`default-presentation.ts`](../src/lib/workbench/plugins/default-presentation.ts)、
[工作台适配入口](../src/lib/workbench/presentation-adapters.ts)和
[`@aibo/web-presentation`](../packages/web-presentation/)。保留核心 collection、detail、
settings、inspector 语义，明确接受的快照版本，并为可选 renderer 保留核心降级方式。
卸载本地视图不能丢失宿主拥有的执行状态。

皮肤扩展使用 `UiKitAdapter` 和 [UI Kit 注册表](../src/lib/ui-kit/registry.ts)。应用组件只能
通过 `$lib/ui-kit` 导入视觉组件；业务控制器不依赖 Svelte 或具体 API 实现。布局与图标
位置归呈现层，授权、动作含义和业务结果归宿主。详细约束见 [UI 架构](ui-architecture.md)。

## 分享前验证

```sh
pnpm run verify
cargo test --manifest-path src-tauri/Cargo.toml
pnpm run probe:session:capabilities
```

`verify` 包含协议打包与架构检查。会话工作流测试使用模拟引擎，不能代替真实模型兼容性
验证。相关原生探针需单独运行，见[探针说明](native-engine-probes.md)。插件包、测试夹具
和问题报告中不要包含凭据或未脱敏的提供者日志。

## Agent 设置面板

会话能力提供者可通过 `aibo.agent-settings/v1` 声明可编辑的分层设置。
参见[协议、接入方式与内置示例](agent-plugin-settings.md)。

## 宿主持久队列与可选 steering

标准 Runtime 2.1 会话提供者声明 open/turn/cancel/close 后，由宿主提供持久等待队列，无需原生队列实现。运行中追加输入单独协商：宿主公开的 `queue.steer` 要求提供者协商 `queue.manage` 且清单同名操作明确包含 steer。宿主添加的能力不回写提供者协商数据。投递不确定时仍禁止自动重发。完整合同和兼容规则见 [消息队列](message-queue.md)。
