# 宿主提供的插件 SDK

Node ESM 能力插件可在 `plugin.json` 声明：

```json
"hostSdk": { "min": "0.1.0", "maxExclusive": "0.2.0" }
```

仍需声明 `.mjs` 或 ESM `.js` 入口，以及 Node.js `>=22` 运行依赖。Aibo 当前使用系统
Node，并不内置 Node 或替插件安装其他 CLI。此功能不改变呈现 Worker 的加载合同。

声明后，可直接使用以下公开入口，不需要把这些 npm 包放进安装产物：

- `@aibo/capability-runtime`
- `@aibo/capability-runtime/stdio`
- `@aibo/plugin-protocol`
- `@aibo/plugin-protocol/semantic`
- `@aibo/plugin-protocol/presentation`
- `@aibo/plugin-protocol/renderer`
- `@aibo/plugin-protocol/settings`

开发时仍将 SDK 安装为 `devDependencies`，以提供类型和本地开发工具；TypeScript
仍需编译为 JavaScript。使用 bundler 时将上述入口标记为 external，不能内联 SDK。
插件额外使用的第三方运行库仍放在插件自身 `node_modules`，或编入业务 bundle。
不要把它们一并改为开发依赖。Aibo 不会运行 `npm install`，也不公开应用自身的
`node_modules`。`@aibo/` 命名空间保留给宿主，未公开的包名、深层路径不能导入。

宿主在启动插件的独立 Node 进程前加载自己的 ESM resolver。只有以上公开入口会
映射到宿主 SDK；普通第三方包和 `node:` 内置模块继续使用 Node 默认解析。
`require('@aibo/...')` 不在本版支持范围内。此解析机制是公开 API 边界，不是新的
进程安全沙箱，也不会赋予插件额外的宿主调用权限。

## 版本与兼容

`hostSdk` 是独立 API 版本范围，不替代插件版本、宿主版本范围或 runtime 线协议版本。
不兼容的 SDK 范围会出现在插件激活诊断中，插件不能启用或被选择执行。
不声明 `hostSdk` 的已有插件继续沿用自己的运行依赖和原有模块解析方式。
迁移插件时递增插件版本，删除 SDK 的 `bundledDependencies`，并确认产物不包含
`node_modules/@aibo`；旧宿主不认识这个新清单字段，会拒绝安装，应先升级 Aibo。

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
