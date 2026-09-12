# P5：公共协议与 SDK

## 第一批：公共数据协议包

`packages/plugin-protocol` 是 `@aibo/plugin-protocol` 的源目录，当前版本 0.1.0、仅本地打包。它持有语义快照/动作、呈现代际消息及纯数据 renderer 描述；宿主原路径改为重导出，避免复制协议定义。wire schema 及其稳定/实验性标记保持原样，包版本不是 wire 版本。

包使用 ES2022 标准库独立编译，输出 ESM 与声明文件，零运行时/peer 依赖。可执行 renderer 的 mount/update/dispose 继续在宿主本地层，公共包不导出 DOM、Svelte、CSS 或回调。

架构检查继续递归检查公共类型：宿主纯数据层可以导入协议包，协议包只能依赖自身。所有包内类型均禁止函数类型和方法签名，不能借文件改名绕过原有 contract 检查。`docs/ui-architecture.md` 同步记录新的定义归属。

`test/protocol-package.test.mjs` 将实际源文件编译到临时目录，执行离线 `npm pack`，在仓库外解包到独立消费者的 node_modules，再进行不带 DOM/自动类型库的消费者编译及 Node ESM 导入。它验证实际包内容和所有公开入口，不使用工作区符号链接或宿主源码作为消费入口。

这一步只证明公共数据包可独立构建和消费。Capability Runtime SDK、完整仓库外能力包的安装/执行/贡献/卸载、发布版本与平台矩阵、升级失败及数据恢复仍待实施；P5 清单保持未完成。是否统一所有插件目录和注册表发布，仍应在完整仓库外样例验证后决定。

本批验证：独立协议/边界测试通过；`pnpm run verify` 通过（25 项架构检查、169 项 Node 测试、类型检查及构建）；`node probes/semantic-ui-browser.mjs` 双皮肤核心视图、布局、状态、键盘和恢复回归通过。未修改 Rust。主 chunk 大小提示仍保留。
