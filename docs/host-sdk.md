# 宿主提供的插件 SDK

Node ESM 能力插件可在 `plugin.json` 声明：

```json
"hostSdk": { "min": "0.1.0", "maxExclusive": "0.2.0" }
```

仍需声明 `.mjs` 或 ESM `.js` 入口，以及 Node.js `>=22` 运行依赖。Aibo 优先查找本机兼容 Node；缺失时在设置的“运行与诊断”中
下载专用运行时或手动选择文件。默认安装包不含 Node，也无需 npm。
第三方运行依赖由插件构建时携带；宿主安装只复制和校验，不执行 npm。呈现 Worker 合同不变。

声明后，可直接使用以下公开入口，不需要把这些 npm 包放进安装产物：

- `@aibolabs/capability-runtime`
- `@aibolabs/capability-runtime/stdio`
- `@aibolabs/capability-runtime/host-tools`（SDK 0.1.1 起，工具目录、invoke 通道和 MCP bridge）
- `@aibolabs/capability-runtime/host-tools-mcp`（SDK 0.1.1 起，bridge stdio server）
- `@aibolabs/acp-adapter`、`@aibolabs/acp-adapter/session`、`@aibolabs/acp-adapter/transport`、`@aibolabs/acp-adapter/config`、`@aibolabs/acp-adapter/image-input`
  （SDK 0.1.2 起，通用 ACP 客户端会话、传输、配置解析与图片输入，见[包说明](../packages/acp-adapter/README.md)）
- `@aibolabs/acp-adapter/worker`（SDK 0.1.3 起，由 `plugin.json` 与 `acp.json` 驱动的通用 ACP Worker；0.1.4 起按 `approval.respond` 的声明形态提供多选项审批，0.1.5 起支持 ACP 表单 elicitation；0.1.6 起支持包内 Node 启动入口；0.1.7 起支持 current-model 参数范围声明；0.1.8 起把 ACP `usage_update` 与每轮 prompt 用量映射到 Aibo 用量快照）
- `@aibolabs/plugin-protocol`
- `@aibolabs/plugin-protocol/semantic`
- `@aibolabs/plugin-protocol/presentation`
- `@aibolabs/plugin-protocol/renderer`
- `@aibolabs/plugin-protocol/settings`

开发时从 npm 安装 SDK 为 `devDependencies`，以提供类型和本地开发工具，例如
`npm install -D @aibolabs/capability-runtime@0.1.8 @aibolabs/plugin-protocol@0.1.8`（ACP 插件另加
`@aibolabs/acp-adapter`）。宿主提供的这三个包版本等于宿主 SDK 版本，插件的 `hostSdk.min`
应不低于所用版本。TypeScript
仍需编译为 JavaScript。使用 bundler 时将上述入口标记为 external，不能内联 SDK。
插件额外使用的第三方运行库仍放在插件自身 `node_modules`，或编入业务 bundle。
不要把它们一并改为开发依赖。Aibo 不会运行 `npm install`，也不公开应用自身的
`node_modules`。`@aibolabs/` 命名空间保留给宿主，未公开的包名、深层路径不能导入。

SDK 0.1.8 起包名为 `@aibolabs/*`。此前未公开发布的 `@aibo/*` 名称作为弃用别名继续解析到同一模块，
使已安装的旧插件可以启动；新插件只能导入 `@aibolabs/*`，并声明 `hostSdk.min` 不低于 0.1.8，
因为更早的宿主不认识新名称。

宿主在启动插件的独立 Node 进程前加载自己的 ESM resolver。只有以上公开入口会
映射到宿主 SDK；普通第三方包和 `node:` 内置模块继续使用 Node 默认解析。
`require('@aibolabs/...')` 不在本版支持范围内。此解析机制是公开 API 边界，不是新的
进程安全沙箱，也不会赋予插件额外的宿主调用权限。

## 插件进程环境

宿主启动插件进程前清空环境变量，只继承系统与用户身份变量：`SystemRoot`、`WINDIR`、
`TEMP`、`TMP`、`TMPDIR`、`LANG`、`LC_ALL`、`HOME`、`USER`、`LOGNAME`、`USERPROFILE`
（`src-tauri/src/plugin_runtime.rs` 的 `PLUGIN_ENVIRONMENT`）。Agent CLI 依靠这些变量
找到自己的登录状态，例如 macOS 钥匙串条目按 `USER` 区分。`PATH` 由宿主重建：插件
可执行文件所在目录在前，其后为宿主的可执行文件搜索路径。其他变量（包括提供商 API key）
不会传入；插件需要的凭据应由原生 CLI 的登录状态或插件设置提供。

## 版本与兼容

`hostSdk` 是独立 API 版本范围，不替代插件版本、宿主版本范围或 runtime 线协议版本。
不兼容的 SDK 范围会出现在插件激活诊断中，插件不能启用或被选择执行。
不声明 `hostSdk` 的已有插件继续沿用自己的运行依赖和原有模块解析方式。
迁移插件时递增插件版本，删除 SDK 的 `bundledDependencies`，并确认产物不包含
`node_modules/@aibolabs`；旧宿主不认识这个新清单字段，会拒绝安装，应先升级 Aibo。

宿主升级后，兼容范围内的新 SDK 用于新启动的插件进程；这不是按插件安装固定 SDK
实现版本。破坏性 API 变更必须提升 SDK 兼容版本，不能复用已有版本悄悄改变合同。
现有存活进程继续使用已加载的实现；旧 SDK 缓存不会在升级时立即删除。

## 宿主实现维护

`packages/plugin-host/sdk.json` 是公开包实现的生成快照，与 loader 一起嵌入原生应用，
运行时不读取源码仓库。多个插件安装共享一份按内容摘要存储的 SDK，位于插件注册目录
下 `.host-sdk-<digest>`，不进入任何插件的不可变包或包摘要。每次启动都会检查 SDK
缓存内容，篡改导致启动失败。共享的是分发文件；各隔离进程仍有自己的 JS 模块实例。

修改公开 SDK 实现或 exports 后运行：

```sh
node scripts/build-host-sdk.mjs
pnpm run verify
cd src-tauri
cargo test --lib
```

`verify` 检查生成快照与源码一致。原生测试覆盖无 SDK 副本的真实安装与调用、Runtime
2.0/2.1、SDK 复用及完整性校验；Node 测试覆盖公开 exports、私有路径拒绝和插件自带库。
本地调试可以用 `node --import /absolute/path/to/packages/plugin-host/register.mjs worker.mjs`，
但最终插件产物不能记录这个开发机路径。

工具接入步骤、执行权限分离、分页和资源限额见[完整会话查询工具](session-history-tool-design.md)。

## Node 运行时查找与按需下载

默认顺序为进程 PATH、GUI 常见安装目录、已下载的 Aibo 专用 Node。自动模式跳过不能启动、
不满足宿主 `>=22` 或目标插件版本要求的候选。诊断与实际 Worker 启动使用相同解析规则；
Worker 的目录置于子进程 PATH 最前面，包内 ACP 继续使用 Worker 的 `process.execPath`。
本机 Node 不受 Aibo 版本固定；升级/删除后重新检测，或下次启动时按文件变化重新校验。

管理中心“运行与诊断”显示当前路径、版本和来源，提供重新检测、下载和文件选择。
手动选择是显式覆盖，保存在应用数据中；无效或不兼容时明确阻止启动，用户可恢复自动查找。
无效的新选择不覆盖原设置，取消文件对话框不清除设置。更新选择只影响新启动的进程，
已有插件进程和会话 release 绑定保持不变。插件的版本要求高于当前默认 Node 时，
自动模式可以选择满足其要求的专用版本；插件诊断显示实际选择的路径。

下载由 Rust 宿主完成，无 Node、npm、curl 或外部解压程序的引导依赖。
`scripts/node-runtime.json` 固定官方发行版本、目标平台和 SHA-256。显式点击下载后通过
HTTPS 获取压缩包，校验摘要，只解压普通文件中的 Node 与 LICENSE，做启动/版本验证；
随后发布到应用数据 `node-runtime/` 的独立目录，原子更新选择记录。失败清理暂存目录，
保留旧设置；不需要管理员权限，不修改系统 PATH，也不安装 npm。支持通过系统代理环境
访问下载地址；网络失败可以重试或手动选择本机文件。

启动应用不自动下载，缺 Node 不妨碍管理和历史查看。下载操作在设置关闭后继续，重新打开
可查看操作结果。重新下载不会覆盖运行中的二进制；旧专用目录暂时保留，以保护已有进程。
专用程序检测会核对下载元数据及二进制摘要。当前提供 macOS/Linux glibc/Windows 的
x64、arm64 映射；musl 等未覆盖平台只能手动选择兼容 Node，各平台仍需独立验收。

Tauri dev/build 不再执行 `prepare:node`，应用资源不再携带 Node。开发环境仍需 Node、pnpm、Rust。
`pnpm prepare:node` 仅保留为可选的旧插件探针测试夹具准备工具，不进入发布包。
升级专用版本需更新固定版本及官方摘要，执行查找/安装/打包/桌面回归。

## 发布 SDK

`@aibolabs/plugin-protocol`、`@aibolabs/capability-runtime`、`@aibolabs/acp-adapter` 的版本必须等于
`packages/plugin-host/sdk.json` 的版本；`pnpm run check:sdk`（包含在 `verify` 中）检查这一点，并按
`packages/plugin-host/sdk-releases.json` 拒绝修改已发布版本的快照内容。发布新版本：

1. 同步提升 `scripts/build-host-sdk.mjs`、`src-tauri/src/plugin_sdk.rs` 与三个包的版本，运行 `node scripts/build-host-sdk.mjs`。
2. 运行 `node scripts/check-sdk-release.mjs --record` 记录快照摘要，与版本变更一起提交。
3. 推送 `sdk-v<version>` tag，由 `.github/workflows/publish-sdk.yml` 发布；手动发布使用
   `pnpm run publish:sdk -- --runtime`（显式使用 `https://registry.npmjs.org/`，已发布版本自动跳过）。

呈现工具包（`web-presentation`、`presentation-tools`、`presentation-workbench`）独立编号，使用
`presentation-v<tag>` 或 `pnpm run publish:sdk -- --presentation` 发布。CI 发布依赖 npm Trusted Publishing，
需在 npm 上为每个包绑定本仓库与该工作流。
