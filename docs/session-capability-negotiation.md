# 会话插件的能力声明与协商

适用于通用能力分发改动 `7865fad`。内置与外置 Agent 使用同一套功能合同；插件名称、品牌和来源不构成功能或权限依据。

## 三层声明必须一致

会话功能的有效集合是：`session.open` 返回的 capabilities、固定 release 的 manifest 操作、实际 Runtime initialize 握手操作与宿主支持合同的交集。未知功能或不匹配的声明不会成为宿主功能。每次调用仍由 Broker 检查绑定、运行时代际与权限。

1. 使用 Manifest v2，显式声明 Runtime min/max 均为 `2.1`；Runtime helper 也显式选择 2.1。
2. 基础生命周期操作遵守 [session-capabilities.v1.json](../contracts/session-capabilities.v1.json)。可选功能遵守 [session-features.v1.json](../contracts/session-features.v1.json) 中的一个完整变体。
3. 可选功能位于 session contribution，能力 ID 为 `<pluginId>.<feature>`，版本 `1.0.0`，`effect: "read"`，`permissions: ["workspace.read"]`。inputSchema/outputSchema 按 JSON 值精确匹配，不能自行增加 required、anyOf 或改变输出约束。更严格的业务条件在处理器内验证。
4. initialize 的 operations 返回清单中的 `{ capability, version, operationId }` 三元组；其中 capability 是带命名空间的 ID，operationId 是操作的 id。
5. `aibo.session.open` 返回 nativeSessionId、recovery 和实际支持的 capabilities；这里使用 `model.select` 等不带插件前缀的功能名。仅声明字符串或仅增加清单操作都不够。
6. 功能响应遵守对应输出合同，通常包含最新 recovery 和 capabilities；另有 thread、fork、goal、current 等必填数据时也必须返回。不要把一次功能响应的 capabilities 当作重新协商全部能力的机制。

下面是在构建脚本中提取 `model.select` 的 reference 变体并生成单个操作的示例。从 Aibo 仓库根目录运行；输出应合入自己的 session contribution，并实现对应处理器。这不是完整插件清单。

```js
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync('contracts/session-features.v1.json', 'utf8'));
const shape = registry.capabilities['model.select'].find(
  variant => variant.inputSchema.properties.reference,
);
if (!shape) throw new Error('Host does not support reference model selection');
const operation = {
  id: 'select-model',
  capability: { id: 'org.example.agent.model.select', version: '1.0.0' },
  effect: 'read',
  permissions: ['workspace.read'],
  timeoutMs: 30000,
  ...structuredClone(shape),
};
console.log(JSON.stringify(operation, null, 2));
```

构建时固定目标宿主合同版本，发布包携带清单和运行依赖；运行时不能依赖开发机上的宿主源码路径。reference 与 provider/modelId 是不同变体，选择与原生实现一致的一种。例如 `action: "set"` 缺少 reference 时，处理器应拒绝调用，而不是修改共享 schema 来表达该条件。

## 功能语义与呈现

| 功能 | 插件与宿主的约定 |
| --- | --- |
| `command.list` | 返回命令目录；命令的可选 insertionText 指定完整插入文本，缺省为 `/${name} `。agent 字段只是兼容元数据，不参与品牌筛选。宿主快捷命令合并后同名优先，普通 slash 文本仍通过 turn 发送 |
| `session.tree` | 提供会话树查询和导航；不自动获得时间线功能 |
| `session.timeline` | 独立返回 branch 数组，各项有稳定 id；宿主在回合前冻结分支快照并叠加持久化的当前回合记录 |
| `session.snapshot` | 返回远端线程摘要 thread，不等同于 opaque recovery 或时间线快照 |
| `session.fork` | 实现原生分支，返回 fork 中的新 nativeSessionId 与 recovery |
| `aibo.session.catalog` | 标准 workspace scope 目录操作，返回 threads；遵守基础会话合同，不使用插件前缀的可选功能合同 |
| `goal.pause` / `goal.resume` | 依赖有效 goal.manage；pause 要求支持 pause 动作，resume 还需标准 aibo.session.goal.resume 操作 |
| 宿主等待队列 | 有效标准 open/turn/cancel/close 支持宿主持久队列；原生 steering 另需协商 queue.manage 且操作支持 steer。宿主派生能力不回写插件声明 |

能力决定是否支持功能，运行中、归档、忙碌等会话状态决定此刻是否可执行。呈现插件消费宿主动作与状态；导航使用 canSyncSnapshot，权限选择使用 execution profile 的 accessModes，不按 Codex/Pi/Cursor 名称补造按钮或模式。没有当前执行配置时不能凭品牌推断配置。详见 [UI 架构](ui-architecture.md)和[消息队列](message-queue.md)。

## 功能声明不授予执行权限

可选功能的 read effect 不是任意文件写入授权。权限执行后端由宿主决定：

- 宿主可信授权绑定到具体 installation 与 contribution；插件不能通过 ID、品牌或自增清单字段领取原生执行后端。
- 未获可信原生授权时，完整声明并真正实现标准 `aibo.session.tool.respond` 与 `aibo.session.turn.write` 的提供者可进入 CoreProxy 路径，由宿主工具网关落实执行边界。不能添加空实现来获取模式。
- 未协商执行后端的提供者只有 read-only 配置。CoreProxy 可提供 read-only、plan、workspace-write；可信原生后端的模式由宿主配置决定。具体动作仍受权限、工作区信任和审批约束。

Cursor 0.1.11 已对齐六项可选功能：command.list、model.select、model.reasoning、model.context-window、approval.respond、user-input.respond。其 ACP 原生工具执行尚未接入上述宿主网关，宿主仍只提供 Ask/read-only；原生引擎存在 Plan/Edit 不表示宿主已授权这些模式。

## 迁移与验收

1. 核对目标宿主包含 `7865fad` 对应合同，逐项对照清单、握手和 open 返回值；移除未实现的声明，补齐响应 envelope。
2. 为命令插入、树、时间线、快照、分支分别声明实际能力；功能间不靠品牌隐式关联。
3. 增加插件版本并重新构建、安装，新建会话验证。既有会话固定旧 release，不因安装更新自动换绑。
4. 验证实际打包 Worker 的初始化握手、open 能力与操作响应 schema，覆盖参数缺失和原生不支持情况，再进行真实引擎与桌面验收。
5. 宿主修改运行 `pnpm run verify`；涉及 Rust 协商或执行边界时运行对应 Rust 测试。模拟引擎验证不等于真实引擎、权限隔离或桌面端到端验收。

| 现象 | 优先检查 |
| --- | --- |
| 已安装但功能未出现 | open 是否声明功能；manifest schema 是否精确匹配；握手 ID、版本和 operationId 是否一致 |
| 功能出现但响应失败 | 是否返回 recovery/capabilities 及专用字段；是否使用正确输入变体；原生引擎是否真正实现 |
| 无写入或 Plan 模式 | 查看宿主执行后端及 accessModes，功能标签不能授予权限 |
| 更新后旧会话仍用旧行为 | 检查固定 release，使用新会话验证新安装 |
| 支持功能但按钮暂不可用 | 检查会话忙碌、运行、归档状态与动作准入 |

实现依据：[协商器](../src-tauri/src/session_contract.rs)、[执行配置](../src-tauri/src/execution_profile.rs)。
