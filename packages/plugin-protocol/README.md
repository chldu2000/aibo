# @aibo/plugin-protocol

Aibo 公共 JSON 类型与呈现能力声明。零运行时依赖，不导出 Svelte、DOM、CSS、挂载句柄或函数回调。

- `@aibo/plugin-protocol/semantic`：语义快照与动作。
- `@aibo/plugin-protocol/presentation`：呈现代际消息；仍标记 experimental-v1。
- `@aibo/plugin-protocol/renderer`：纯数据 renderer 描述、核心语义和支持版本常量。

包版本不替代 wire schema 版本。当前语义数据类型保留 experimental-v1、v1 与 v1.1；具体载荷仍须通过宿主运行时 schema 校验，TypeScript 类型本身不是权限或有效性证明。

从仓库根运行 `pnpm exec tsc -p packages/plugin-protocol/tsconfig.json`，再在此目录执行 `npm pack --ignore-scripts`。编译器由仓库提供，生成的包没有运行时或类型依赖。当前为本地打包验证阶段，尚未发布注册表，也尚非完整 Capability Runtime SDK。

可执行 renderer 的 mount/update/dispose 接口继续属于可信宿主本地层，不从此包重导出。
