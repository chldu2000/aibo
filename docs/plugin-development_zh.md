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
| 呈现 | `presentation.json` 的 hostApi（1.0.0 或 1.1.0，决定宿主发送哪些控件）/coreSemantics 和快照声明，见包合同 |

开发版本的宿主版本号本身不能证明包含哪些源码改动。
验证时记录精确宿主提交/构建、插件 release、SDK 和原生 CLI 版本；历史说明中的提交不是已发布的最低宿主版本。

## 构建并安装样例

在 Aibo 仓库根目录先执行 `pnpm install`；需要 Node.js 22+、npm 和 `tar`。然后运行：

```sh
node --input-type=module -e 'import { buildExternalPlugin } from "./probes/build-external-plugin.mjs"; const result = await buildExternalPlugin(); console.log(JSON.stringify({ developmentRoot: result.root, installPath: result.packagePath }, null, 2));'
```

仓库内构建器从源码打包本地 SDK tarball（用于验证未发布的改动），在临时开发副本中离线安装为开发依赖，编译 worker，输出解包安装目录。
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
5. 从 npm 安装 SDK 为开发依赖，例如 `npm install -D @aibolabs/plugin-protocol@0.1.8 @aibolabs/capability-runtime@0.1.8`，
   再编译 Worker。这些包的版本等于宿主 SDK 版本，`hostSdk.min` 应不低于所用版本。
6. 声明 `hostSdk`，打包已编译入口和清单；使用 bundler 时将公开 SDK 入口设为 external。
   第三方运行库须编入业务 bundle 或显式包含在安装产物中；只写 dependencies 不会提供库文件，
   Aibo 不执行 `npm install`。详见[SDK 打包规则](host-sdk.md)。
7. 安装前检查解包产物的依赖完整性、开发机路径与符号链接。
   [`build-external-plugin.mjs`](../probes/build-external-plugin.mjs)演示无第三方运行依赖样例的完整流程。

Release 不可变。包内容改变时递增 release 版本；既有会话固定 installation/contribution，
同一 pluginId 的安装是单版本替换：先预览引用并确认，全部会话恢复成功才切换，失败整体保留原版本。
相同包重复安装无操作；同版本不同内容明确按替换处理。降级仅支持显式清除插件数据重装，业务历史保留，
旧会话永久转为只读历史。
卸载会清除该 release 的文件和私有数据；有引用时需先处理。详见[卸载与迁移规则](plugin-boundaries-and-regression.md#插件卸载与会话迁移)。

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

### 接入 ACP Agent

支持 [Agent Client Protocol](https://agentclientprotocol.com) 的 Agent 不需要编写代码。从
`aibo-plugins/plugins/acp-template` 起步：`plugin.json` 声明会话操作与可执行依赖，`acp.json` 描述启动命令和模式映射，
`worker.mjs` 只调用宿主 SDK 0.1.3 起提供的 `serveAcpAgent`。`acp.json` 也可以用
`launch: { kind: "node", entry }`（SDK 0.1.6 起）代替外部 `command`，用 Worker 的 Node 运行包内携带的 ACP Agent，
此时无需声明可执行依赖。能力按 Agent 的 `initialize` 响应收窄：
仅 `loadSession` 时声明恢复，仅支持图片提示时声明图片输入，仅返回配置项时声明模型与参数选择。
`parameterScope: "current-model"`（SDK 0.1.7 起）让宿主先确认模型，再提供该模型的推理选项。
`acp.json` 无效时 Worker 在握手前退出，宿主在启动阶段报告错误。
`approval.respond` 声明 `{ requestId, optionId }` 输入形态时（SDK 0.1.4 起），审批卡显示 Agent 提供的单次允许 / 拒绝选项，
回应所选 option ID；声明 `decision` 形态时仍为二选一。`acp.json` 的 `approvalOptions` 可以为选项提供中文标签，
并把选项映射到会话控件，例如批准计划后切到 Manual。切换由宿主提交，见[会话控件](session-controls.md)的"回合内切换"。`elicitation: true`（SDK 0.1.5 起，需要 `user-input.respond` 操作）
把 Agent 的表单请求作为宿主问题呈现，例如 Claude Code 的 AskUserQuestion。
需要厂商扩展方法时，向 `serveAcpAgent` 传入 `extension`，参考 Cursor 插件；字段与钩子见
[`@aibolabs/acp-adapter`](../packages/acp-adapter/README.md)。

## 扩展呈现

外部皮肤使用独立 `presentation.json` 包和[呈现打包工具](../packages/presentation-tools/)。
从[包合同](presentation-package.md)、[shadcn](../packages/presentation-shadcn/)或
[Material 3](../packages/presentation-material3/)样例开始。Worker 返回受限视觉树，可信桥绘制并转发宿主动作 token。
包不能直接访问 DOM、网络、存储或 Tauri IPC；未提供的 surface 继承宿主默认实现，管理和恢复仍由宿主持有。

### 渲染会话审批

提供 `workbench` surface 的包拥有会话区域，因此必须渲染待处理的 Agent 审批。
宿主不再把审批显示在窗口顶部或管理面板上。

- `data.conversation.approvalRequests` 只包含当前会话的待处理审批：`requestId`、`kind`、可选的 `command` 与 `cwd`、
  `availableDecisions` 和 `options`。显示 `kind`、`command`、`cwd`，让用户知道自己在批准什么；
  卡片放在输入框附近，与 Agent 提问（`userInputRequests`）一致。
- 每个当前可选结果对应一个 `resolveApproval` 动作，参数为 `[requestId, 'option' | 'decision', value, turnId]`。
  带 `options` 的请求只按选项作答（`value` 为选项 ID；`label` 可能为 null，此时按 `kind` 显示允许/拒绝）；
  没有选项时，`value` 为 `availableDecisions` 中的 `accept` 或 `cancel`。拒绝类排在前面，允许类作为主操作。
- 按钮只绑定宿主下发的动作 token。会话忙、归档中或未绑定插件时不提供动作，此时禁用或省略按钮。
  请求结束后 token 失效；宿主会重新核对每次选择。
- [`@aibolabs/presentation-workbench`](../packages/presentation-workbench/) 的 `renderConversation` 已渲染审批，
  基于它构建的包无需额外处理。

包没有渲染审批或 Worker 故障时，用户只能按 Ctrl/⌘+Shift+Backspace 回到默认呈现后作答。
详见[包合同](presentation-package.md#工作台会话与-composer)。

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

## 宿主工具接入

新增 Agent 的历史查询能力通过 `aibo.host-tools/v1` 目录和 SDK 0.1.1 的通用工具通道接入，
无需修改宿主按品牌路由。插件只实现 MCP 参数映射或动态工具注册；读取授权、分页和版本一致性
由宿主管理。基于 `@aibolabs/acp-adapter/worker`（SDK 0.1.3 起）的 ACP 插件自动获得这条接线：宿主在会话上下文中
下发工具目录时，Worker 启动 MCP bridge 并交给 Agent。
完整步骤及原生/打包测试见[会话历史工具](session-history-tool-design.md)。

## 登录与授权入口

Manifest v2 可选的顶层 `authentication` 声明由宿主固定的插件管理页消费；没有声明时不显示登录入口。
此功能需要包含 `plugin_authentication_action` 的宿主构建，旧宿主的严格 manifest 校验会拒绝该字段。
它是用户主动调用的应用级管理动作，不是会话能力，不通过提示词触发，也不改变会话绑定或执行授权。

```json
{
  "authentication": {
    "kind": "cli-terminal",
    "executable": "example-agent",
    "loginArgs": ["auth", "login"],
    "statusArgs": ["auth", "status"]
  }
}
```

`executable` 必须引用 `executableDependencies` 中 `kind: executable`、`required: true` 的依赖，
不接受路径。参数按独立 argv 声明，不能依赖 shell 展开；最多 16 项，每项最多 256 字符，不含控制字符。
`statusArgs` 的退出码合同为 0 已登录、1 未登录，其他退出码或超时为检查失败。
只接受符合这一合同的 CLI；宿主不解析输出，也不把检查结果当作远端 OAuth 或模型调用成功的证据。

用户在插件管理页启用插件后点击「登录 / 授权」。原生宿主在变更锁内重新读取安装与启用状态、
验证清单及 CLI 依赖版本，再执行声明的动作。当前登录终端实现支持 macOS：生成权限为 0700 的
临时 `.command` 文件，通过系统 Terminal 打开，文件在开始执行时删除。若用户始终未打开该终端，
临时文件保留到系统临时目录清理；其中只包含命令和受限系统身份环境，不包含 OAuth token。
终端打开成功仅表示 `loginOpened`；用户完成官方交互式登录后点击「检查登录状态」。
登录与检查都使用用户主目录和与插件相同的身份环境、可执行搜索路径，不继承 API key 等额外变量。
宿主状态检查限时 15 秒，丢弃 stdout/stderr，不保存账户或凭据。其他平台打开登录明确返回不支持。

凭据仍由官方 CLI 保存。调用认证动作会结束该插件升级的撤销窗口；登录流程交由外部终端管理，
关闭 aibo 或管理面板不表示取消登录。授权后用户返回原会话手动重试；不自动发送消息、重建会话或更换 release。
管理页的检查结果是按安装身份隔离的内存快照，不是持续监控的认证状态。

验证入口：`test/plugin-authentication.test.mjs`、Rust `plugin_authentication` 测试及
`probes/plugin-authentication-browser.mjs`（Material 3 / ak-ui 浅深主题、失败重试、禁用与缺失能力）。
浏览器替身不证明系统 Terminal 或实际 OAuth 授权成功。
