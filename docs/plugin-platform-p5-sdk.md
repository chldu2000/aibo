# P5：公共协议与 SDK

## 第一批：公共数据协议包

`packages/plugin-protocol` 是 `@aibo/plugin-protocol` 的源目录，当前版本 0.1.0、仅本地打包。它持有语义快照/动作、呈现代际消息及纯数据 renderer 描述；宿主原路径改为重导出，避免复制协议定义。wire schema 及其稳定/实验性标记保持原样，包版本不是 wire 版本。

包使用 ES2022 标准库独立编译，输出 ESM 与声明文件，零运行时/peer 依赖。可执行 renderer 的 mount/update/dispose 继续在宿主本地层，公共包不导出 DOM、Svelte、CSS 或回调。

架构检查继续递归检查公共类型：宿主纯数据层可以导入协议包，协议包只能依赖自身。所有包内类型均禁止函数类型和方法签名，不能借文件改名绕过原有 contract 检查。`docs/ui-architecture.md` 同步记录新的定义归属。

`test/protocol-package.test.mjs` 将实际源文件编译到临时目录，执行离线 `npm pack`，在仓库外解包到独立消费者的 node_modules，再进行不带 DOM/自动类型库的消费者编译及 Node ESM 导入。它验证实际包内容和所有公开入口，不使用工作区符号链接或宿主源码作为消费入口。

这一步只证明公共数据包可独立构建和消费。Capability Runtime SDK、完整仓库外能力包的安装/执行/贡献/卸载、发布版本与平台矩阵、升级失败及数据恢复仍待实施；P5 清单保持未完成。是否统一所有插件目录和注册表发布，仍应在完整仓库外样例验证后决定。

本批验证：独立协议/边界测试通过；`pnpm run verify` 通过（25 项架构检查、169 项 Node 测试、类型检查及构建）；`node probes/semantic-ui-browser.mjs` 双皮肤核心视图、布局、状态、键盘和恢复回归通过。未修改 Rust。主 chunk 大小提示仍保留。

## 第二批：Capability Runtime SDK

`packages/capability-sdk` 提供本地版本 `@aibo/capability-sdk@0.1.0`。默认入口为独立消息 dispatcher，`/stdio` 使用 Node 标准输入/输出承载 Runtime 2.0。初始化绑定 plugin/version/contribution/instance/generation，调用检查协商过的精确 operation 和 deadline；同一实例拒绝并发执行。插件间 call 自动带上当前 invocation/generation，禁止覆盖宿主 scope、权限等字段；有界子请求关联保留成功/拒绝，未做自动重试。

调用完成、deadline 到达或传输关闭后，取消信号失效旧上下文，待处理子请求拒绝，迟到 handler 结果不再发送。SDK 不宣称停止 handler 的全部本机副作用；真实权限、输入输出 schema、进程终止、批准、持久身份及结果未知仍由 Broker 决定。业务实现必须合作处理取消信号。

公共协议包新增与当前 Rust 消息一致的 Capability 数据类型；前端 `api.ts` 的 scope/request/result 改为重用公共定义。运行 SDK 的函数/取消接口与纯数据类型分包；取消接口使用结构类型，不重导出 DOM AbortSignal 或框架类型。

验证包括 dispatcher 的身份/版本/过期拒绝、子调用关联及权限字段拒绝、拒绝不重试、deadline 后迟到结果忽略；真实 Node stdio 进程完成初始化和调用。两个实际 tarball 在仓库外解包后，SDK 与协议声明使用 ES2022、空自动类型列表编译，并验证所有入口可导入。该验证仍不替代仓库外插件的生产安装、Broker 调用、语义贡献和卸载链路，下一批继续完成这些要求。

第二批 `pnpm run verify` 通过：25 项架构检查、173 项 Node 测试、类型检查及生产构建。未修改 Rust；主 chunk 大小提示保留。
