# 插件平台版本与平台支持矩阵

本表对应宿主 0.1.0 与 P5 的三个本地 SDK 包 0.1.0。包版本、线协议版本与业务能力版本分别管理，不能互相推导。当前发行方式为单仓库构建、本地 tarball；尚未发布公共包注册表。

## 当前可用组合

| 层 | 当前支持 | 判定依据与限制 |
| --- | --- | --- |
| 宿主 | 0.1.0 | Cargo 与 Tauri 版本一致；v2 清单的 `host.min <= host < host.maxExclusive`，以 Cargo 版本判定 |
| Manifest | v1、v2 | v1 经过兼容适配；v2 分别声明执行依赖、能力和语义贡献，不走旧 Agent runtime |
| 旧 Agent runtime / view | 1.0 / 1.0 | v1 包安装时要求两个协议范围的 min/max 均为 1.0 |
| Capability runtime | 2.0 | 当前 v2 提供者要求 min/max 均为 2.0；实际初始化还校验插件、release、generation 和操作身份 |
| 语义视图 | contract 1.0.0 / protocol 1.0；contract 1.1.0 / protocol 1.1 | 每种组合要求 semanticView min/max 精确匹配；核心为 collection、detail、settings、inspector；1.1 增加受控写操作 |
| 业务 capability | 插件声明的版本化契约 | 不设全局业务版本；命名空间、输入/输出 schema、提供者依赖范围与具体绑定共同约束选择，不因安装新版本自动换绑 |
| 默认 renderer | dev.aibo.ui-default 1.0.0，semanticVersion 1.0.0 | 显式接受 experimental-v1、v1、v1.1 快照；四个核心语义必需；numbered-detail 1.0.0 可选，失败回退核心 detail |
| 公共数据 SDK | @aibo/plugin-protocol 0.1.0 | 纯数据，不导出 DOM、框架或函数；包含 capability、semantic、presentation、renderer 数据合同 |
| 插件本地运行 helper | @aibo/capability-runtime 0.1.0 | Node >=22；函数与取消协作接口仅存在于本地 helper；不是公共数据协议的一部分 |
| 可信 Web renderer 本地接口 | @aibo/web-presentation 0.1.0 | 仅类型包，mount 接收 HTMLElement；不从公共数据 SDK 重导出，消费者自行提供 DOM 类型 |

上述支持表是当前明确接受的组合，不代表任意协议范围都能协商成功。未知必需贡献或不支持的版本不可启用；可选呈现按声明协商并局部降级。插件登记成功、启用成功和子进程握手成功是不同阶段，不能将元数据检查当作实际运行成功证明。

实现依据：`src-tauri/src/plugin_manifest.rs`、`plugin_registry.rs`、`capability_broker.rs`，以及 `src/lib/workbench/plugins/default-presentation.ts`。独立包消费与边界检查见 `test/protocol-package.test.mjs`、`test/presentation-boundaries.test.mjs`。

## 操作系统范围

| 平台 | 实现与安装识别 | 当前发布验收结论 |
| --- | --- | --- |
| macOS arm64 | darwin-arm64；Unix 写入路径可用 | 本轮真实 App 的外部插件、双皮肤、审批、恢复和原生 AX 验收环境 |
| macOS x64 | darwin-x64；样例清单允许安装 | 尚无本轮该架构真实运行证据，不扩展 arm64 的验收结论 |
| Linux arm64 / x64 | linux-arm64 / linux-x64；Unix 写入实现存在 | 尚未完成原生运行、进程清理、路径、审批和桌面交互验收 |
| Windows arm64 / x64 | windows-arm64 / windows-x64 | 尚未完成原生验收；当前 Capability 写入被 `cfg!(unix)` 支持检查拒绝 |

清单必须显式包含当前平台，宿主不会将纯数据协议跨平台等同于插件执行跨平台。表中 Linux/Windows 是代码识别范围，不是已经通过的发行支持承诺；外部样例仅声明两个 darwin 平台。其他 OS/架构未列入支持范围。

证据：[P4 退出核对](./plugin-platform-p4-exit-audit.md)、[P5 外部插件原生记录](./baselines/plugin-platform-p5/external-plugin-native.json)。P5 JSON 记录了 darwin，执行工作站为 Darwin arm64；它不提供其他架构证明。

## UI 信任与扩展边界

默认 Presentation Plugin 和两套皮肤随宿主构建，属于可信代码。安装能力包不能注册 renderer 代码；v2 清单携带 presentation 描述并不授予执行资格，当前启用检查拒绝该声明。Web 本地接口包提供类型，不提供动态代码加载器或隔离设施。

Custom Surface 目前没有必须通过任意插件界面才能满足的实际需求，因此暂缓独立 ADR 与实现，不阻塞基础 SDK 交付。未来出现需求时，仍须先通过隔离与消息桥 ADR，再验证主题、焦点、无障碍替代、降级和崩溃恢复；当前不宣称支持任意第三方 UI。

## 后续版本变更门

当前继续保留 v1 兼容入口与已接受的稳定快照，不借 SDK 拆包删除旧协议。新增支持组合须同步本表、运行时校验与真实消费者回归；破坏性变化使用新的协议/契约版本，不修改旧版本的解释。弃用须先在发行说明中列出受影响版本、替代方式和迁移证据，再单独决定移除版本；当前未宣布任何移除日期，也不承诺未经验证的未来版本自动兼容。

升级失败、绑定提交、旧依赖保留和数据恢复仍是 P5 独立验收项。本表不会用“元数据检查通过”替代这些测试；对应清单在获得证据前保持未完成。
