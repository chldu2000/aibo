# P5：公共协议与 SDK

## 第一批：公共数据协议包

`packages/plugin-protocol` 是 `@aibo/plugin-protocol` 的源目录，当前版本 0.1.0、仅本地打包。它持有语义快照/动作、呈现代际消息及纯数据 renderer 描述；宿主原路径改为重导出，避免复制协议定义。wire schema 及其稳定/实验性标记保持原样，包版本不是 wire 版本。

包使用 ES2022 标准库独立编译，输出 ESM 与声明文件，零运行时/peer 依赖。可执行 renderer 的 mount/update/dispose 继续在宿主本地层，公共包不导出 DOM、Svelte、CSS 或回调。

架构检查继续递归检查公共类型：宿主纯数据层可以导入协议包，协议包只能依赖自身。所有包内类型均禁止函数类型和方法签名，不能借文件改名绕过原有 contract 检查。`docs/ui-architecture.md` 同步记录新的定义归属。

`test/protocol-package.test.mjs` 将实际源文件编译到临时目录，执行离线 `npm pack`，在仓库外解包到独立消费者的 node_modules，再进行不带 DOM/自动类型库的消费者编译及 Node ESM 导入。它验证实际包内容和所有公开入口，不使用工作区符号链接或宿主源码作为消费入口。

这一步只证明公共数据包可独立构建和消费。Capability Runtime SDK、完整仓库外能力包的安装/执行/贡献/卸载、发布版本与平台矩阵、升级失败及数据恢复仍待实施；P5 清单保持未完成。是否统一所有插件目录和注册表发布，仍应在完整仓库外样例验证后决定。

本批验证：独立协议/边界测试通过；`pnpm run verify` 通过（25 项架构检查、169 项 Node 测试、类型检查及构建）；`node probes/semantic-ui-browser.mjs` 双皮肤核心视图、布局、状态、键盘和恢复回归通过。未修改 Rust。主 chunk 大小提示仍保留。

## 第二批：Capability Runtime SDK

此批最初使用 `packages/capability-sdk` / `@aibo/capability-sdk@0.1.0` 命名，第三批在发布前改为 `packages/capability-runtime` / `@aibo/capability-runtime@0.1.0`，将插件本地可执行 helper 与纯数据 SDK 明确分开。默认入口为独立消息 dispatcher，`/stdio` 使用 Node 标准输入/输出承载 Runtime 2.0。初始化绑定 plugin/version/contribution/instance/generation，调用检查协商过的精确 operation 和 deadline；同一实例拒绝并发执行。插件间 call 自动带上当前 invocation/generation，禁止覆盖宿主 scope、权限等字段；有界子请求关联保留成功/拒绝，未做自动重试。

调用完成、deadline 到达或传输关闭后，取消信号失效旧上下文，待处理子请求拒绝，迟到 handler 结果不再发送。SDK 不宣称停止 handler 的全部本机副作用；真实权限、输入输出 schema、进程终止、批准、持久身份及结果未知仍由 Broker 决定。业务实现必须合作处理取消信号。

公共协议包新增与当前 Rust 消息一致的 Capability 数据类型；前端 `api.ts` 的 scope/request/result 改为重用公共定义。运行 SDK 的函数/取消接口与纯数据类型分包；取消接口使用结构类型，不重导出 DOM AbortSignal 或框架类型。

验证包括 dispatcher 的身份/版本/过期拒绝、子调用关联及权限字段拒绝、拒绝不重试、deadline 后迟到结果忽略；真实 Node stdio 进程完成初始化和调用。两个实际 tarball 在仓库外解包后，SDK 与协议声明使用 ES2022、空自动类型列表编译，并验证所有入口可导入。该验证仍不替代仓库外插件的生产安装、Broker 调用、语义贡献和卸载链路，下一批继续完成这些要求。

第二批 `pnpm run verify` 通过：25 项架构检查、173 项 Node 测试、类型检查及生产构建。未修改 Rust；主 chunk 大小提示保留。

## 第三批：仓库外构建与真实安装

`examples/capability-plugin` 是不导入宿主源码的 TypeScript 样例。构建器复制样例到系统临时目录，使用实际打包的协议 SDK 与 Runtime helper 进行离线 npm 安装，按 ES2022/空自动类型列表编译，再将运行依赖一起打包。恢复版本号依赖声明后才打包，避免产物引用开发机 tarball 路径。宿主安装的是最终 tarball 的解包目录，不是开发目录或工作区符号链接。

原生探针在隔离 macOS App 中安装/启用包、发现并绑定 application Provider，在挂载 UI 前执行能力；随后用实际 App 的通用命令入口在双皮肤中打开语义详情，刷新必须产生新的 completed invocation。卸载移除贡献、关闭活动视图并拒绝新调用，全程无需 Agent 会话。

首次集成暴露两项样例错误：直接调用缺少显式 Provider 绑定；语义 Provider 的输入 schema 错误地只接受空对象。现已按宿主合同修复，公共协议补充 `SemanticQuery`，明确 actionId/itemId/offset，而不是放宽宿主校验。

包边界与发布决定：继续单仓库维护，保留独立可打包的 `@aibo/plugin-protocol`（公共纯数据 SDK）和 `@aibo/capability-runtime`（插件本地 Node helper）。后者的函数处理器和取消回调不属于 SDK 数据合同，也不跨进程序列化；公共 SDK 不重导出 helper。暂不发布注册表、不迁移既有 Agent 插件目录；先完成版本/平台与升级恢复矩阵。可信 Web renderer 本地接口的独立包仍待后续处理，因此 P5 第一项暂不勾选。

第三批证据：[外部构建与原生结果](./baselines/plugin-platform-p5/external-plugin-native.json)，包括 tarball 文件清单、挂载前调用、双皮肤通用入口/刷新及卸载。`node probes/external-plugin-native.mjs` 外层退出 0，清理隔离 App 的内部 ELIFECYCLE 为正常结束输出。`pnpm run verify` 通过：25 项架构检查、174 项 Node 测试、类型检查与构建；新增构建回归检查解包产物没有符号链接、临时路径依赖或应用源码。当前原生证据仅覆盖 macOS，样例 manifest 也只声明对应平台。

## 第四批：可信 Web renderer 本地接口

新增独立类型包 `@aibo/web-presentation@0.1.0`，持有 PresentationProps、WebPresentationAdapter 和 MountedPresentation。包没有运行时代码，仅供可信构建 `import type`；它不会使安装 manifest 的 presentation 描述获得代码加载权限。

宿主的 `workbench/types.ts` 与 `ui-kit/presentation-props.ts` 改为重导出同一份定义，避免本地接口漂移。该包依赖公共协议，允许 HTMLElement 与挂载/更新/释放回调；公共协议 SDK 禁止反向依赖本地 Web 接口或 Node helper。根 TypeScript 路径映射用于仓库内开发，外部消费者不使用该映射。

实际 tarball 测试将三个包解到外部消费者目录：只导入协议/Node helper 时不带 DOM 编译通过；显式导入 Web 接口时，不带 DOM 因 HTMLElement 缺失而失败，加入 DOM 后实现一个 renderer 编译通过。Web 包只含声明、README 与 package.json。既有 Svelte/DOM renderer 实现继续由宿主可信构建提供。

公共纯数据 SDK、插件本地 Runtime helper 和 Web 本地接口现已分开，可勾选 P5 的 SDK 提取项；注册表发布、兼容平台/版本以及升级与数据恢复验收继续保留未完成。

第四批 `pnpm run verify` 通过：25 项架构检查、174 项 Node 测试、类型检查及构建。独立打包和有/无 DOM 的编译测试通过；未修改 Rust 或 renderer 运行逻辑。主 chunk 大小提示仍保留。

## 第五批：版本矩阵与真实旧数据库升级

版本与平台范围见[支持矩阵](./plugin-platform-support-matrix.md)。公共数据包、本地执行 helper、可信 renderer 类型包分别版本化；Custom Surface 无当前实际需求，暂缓。

将 `session_migration_preserves_old_history_and_allows_external_identity` 从内存逐条 SQL 测试加强为磁盘数据库回归：先由 SQLx Migrator 建立 migration 19 的旧数据库，写入会话、绑定、turn、消息、进程记录和旧事件；迁移到 27 后加入 schema 2.0 事件，再通过应用 `open_database` 升到当前版本，并关闭、重新打开验证第二次迁移不重复数据。检查两种事件原始 payload/schema、外部会话/turn 身份、进程 generation 与消息保留，且实际 `session_history::read` 无 runtime 即可读取旧消息；原有外键与外部 Agent 身份断言保留。

该测试补强 Agent 历史的升级证据，不代表插件升级失败或私有数据恢复已经验收。核心迁移的完整退出核对与 release 回滚项继续保持待完成。

本批验证：完整 Rust 208 项通过；`pnpm run verify` 通过。已有主包体积警告仍在，本批未修改运行时代码或构建阈值。

## 第六批：真实子进程的私有数据并存与回滚

新增两个实际 release、真实 Node runtime、磁盘数据库重开及 Broker 重建的回归。验证显式切回旧版后恢复原 instance 与原数据，同时卸载新版仅移除代码，不删除其私有数据。代码回滚、数据恢复和未完成的初始化失败绑定问题分别记录在[release 恢复说明](./plugin-platform-release-recovery.md)，P5 对应整项继续保持未完成。

本批完整 Rust 209 项及 `pnpm run verify` 通过；已有主包体积警告保持原状。

## 第七批：候选 release 初始化失败不覆盖旧绑定

先用合法 manifest、实际崩溃 runtime 写出失败回归，证实旧实现选择新版时立即覆盖绑定。新增 migration 0040 与独立候选绑定模块：替换选择暂存，首次经过原有调用授权边界完成初始化后事务提交；失败撤销候选并保留原绑定。写请求仍经过可信批准，已开始执行后的失败保持结果未知和持久重放规则。候选 ID 参与审批复核，防止同版本重新选择后旧批准或旧完成结果被复用。

实现和验收边界见[release 恢复说明](./plugin-platform-release-recovery.md)。旧依赖升级组合和原生复验仍保留为退出核对事项。

本批验证：原始失败回归先红后绿；完整 Rust 212 项通过，其后补强的 Broker 18 项、写候选审批与代码回滚定向回归通过；`pnpm run verify` 通过。回滚回归现在先实际调用确认旧版，再重开数据库并执行与宿主一致的 Broker 恢复，避免将未提交候选当作已完成回滚。

## 第八批：旧依赖升级恢复组合与原生复验

补齐新版缺依赖拒绝启用、崩溃候选不覆盖旧绑定、旧父插件保持旧 leaf 锁定，以及父插件/leaf 卸载后递归保留、从保留字节导出重装并实际调用的组合回归。保留包必须先导出注册表之外再安装，未放宽安装器的目录边界。

外部插件原生探针增加崩溃新版选择、失败与旧版后续调用的验收；同时复跑可信写入原生探针，两组外层 exit 0。完整 Rust 213 项通过。证据和恢复步骤见[release 恢复验收](./plugin-platform-release-recovery.md)，P5 release 清单项完成。

本批 `pnpm run verify` 通过；主包体积警告仍为已知构建提示。

## 第九批：核心数据库退出核对

逐项核对嵌入式迁移、独立迁移连接的外键策略、复制重建表与旧历史读取断言，形成[数据库退出核对](./plugin-platform-database-exit-audit.md)。结合最新完整 Rust 213 项和原生恢复证据，P5 数据库清单项完成。本批为文档核对，`pnpm run verify` 通过；全部阶段的最终审计仍单独进行。
