# 插件平台版本与平台支持矩阵

本表对应宿主 0.1.0 与 P5 的三个本地 SDK 包 0.1.0。包版本、线协议版本与业务能力版本分别管理，不能互相推导。当前发行方式为单仓库构建、本地 tarball；尚未发布公共包注册表。

## 当前可用组合

| 层 | 当前支持 | 判定依据与限制 |
| --- | --- | --- |
| 宿主 | 0.1.0 | Cargo 与 Tauri 版本一致；v2 清单的 `host.min <= host < host.maxExclusive`，以 Cargo 版本判定 |
| Manifest | v2 可执行；v1 只读元数据 | v1 不可启用；v2 分别声明执行依赖、能力和语义贡献 |
| 旧 Agent runtime / view | 执行支持已移除 | 旧 PluginHost 与 v1 进程传输已删除；旧视图动作 IPC 与渲染组件已删除 |
| Capability runtime | 2.0、2.1 | min/max 必须精确匹配同一受支持版本；2.1 增加 invocation 流与执行中控制，内置 Codex/Pi 及线程读取、分支、目录已接入共享 Broker；旧原生管理器已删除。实际初始化校验插件、release、generation 和操作身份；支持与验证限制见[会话能力迁移](./capability-session-migration.md) |
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

证据：[P4 退出核对](archive/plugin-platform-p4-exit-audit.md)、[P5 外部插件原生记录](archive/baselines/plugin-platform-p5/external-plugin-native.json)。P5 JSON 记录了 darwin，执行工作站为 Darwin arm64；它不提供其他架构证明。

## UI 信任与扩展边界

宿主保留可信默认呈现与兼容适配器。独立 Presentation 包使用
`aibo.presentation-package/v1`，hostApi/coreSemantics 均为 1.0.0；同一个包身份
可以提供主题、controls、semantic 和 workbench。能力包 v2 的 presentation 描述
仍不授予 UI 执行资格，这一规则与独立 Presentation 包入口分别验证。

外部代码只在可终止 Worker 中生成受限视觉树，可信 iframe 桥负责绘制和转发
宿主验证的动作；不能直接运行 DOM/Svelte 代码。信任设计见
[ADR-0009](adr/0009-presentation-package-isolation.md)，包合同见
[Presentation 包](presentation-package.md)。`@aibo/web-presentation` 仍只是可信
本地接口类型，不是该外部加载器。

shadcn/Material 3 独立包 0.2.0 已通过仓库外构建与实际 App 浏览器流程。
[macOS arm64 原生生命周期记录](baselines/presentation-p4/native-lifecycle.json)
验证真实安装、双包激活、0.2.1 升级、0.2.2 失败候选保留旧选择、退出进程后恢复、
禁用/卸载回退和工作区保留。操作为原生宿主 DOM 脚本点击与真实 Tauri IPC；未宣称
物理键盘、屏幕阅读器、其他平台或全部视觉/功能等价验收通过。

[原生运行故障记录](baselines/presentation-p4/native-runtime-failure.json) 进一步验证
0.2.3 测试包成功激活后 Worker 死循环，宿主清除持久选择并回退，固定设置入口
可重新激活健康版本。探针使用每次独立的窗口标识和主窗口等价权限，避免开发
网址的窗口级状态缓存影响重复验证。布局列宽跨进程恢复也已复验。

[原生启动故障记录](baselines/presentation-p4/native-startup-failure.json) 通过四进程
验证选中包的 manifest 丢失及资源完整性损坏时清除选择、默认回退、工作区保留
和健康包重新激活。故障仅注入独立测试应用的已确认选中包，检查结束恢复原文件。

默认/外置 composer 焦点、选区及消息锚点映射已通过双皮肤浏览器验证；回答草稿
重载只对匹配的实时请求恢复，不声称重建 Agent 待答请求。[固定审批故障记录](baselines/presentation-p4/approval-fault-browser.json) 已验证 Worker
死循环期间可允许请求、回退后可拒绝另一请求，原生 IPC 为替身。最终双皮肤 0.3.0 与共享工作台 0.2.0 已通过
[最终浏览器](baselines/presentation-p4/release-0.3.0-browser.json) 和
[macOS arm64 四进程原生验收](baselines/presentation-p4/release-0.3.0-native.json)。
交付摘要与运行证据已核对，详见 [退出审计](presentation-plugin-exit-audit.md)。

## 后续版本变更门

本次会话迁移已退役 v1 Agent 插件执行；旧清单元数据及已保存历史仍可读取。新增支持组合须同步本表、运行时校验与真实消费者回归；破坏性变化使用新的协议/契约版本，不修改旧版本的解释。弃用须先在发行说明中列出受影响版本、替代方式和迁移证据，再单独决定移除版本；其他协议的未来版本不承诺自动兼容。

升级失败、绑定提交、旧依赖保留和数据恢复仍是 P5 独立验收项。本表不会用“元数据检查通过”替代这些测试；对应清单在获得证据前保持未完成。
