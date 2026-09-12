# @aibo/web-presentation

可信 Web renderer 的本地类型接口，只用 `import type` 导入。当前包不提供可执行 renderer，也不授权安装包向主 WebView 加载代码。

`PresentationProps` 描述本地视图参数和动作回调；`WebPresentationAdapter` 提供 mount，返回 update/dispose 句柄。这里允许 HTMLElement 与函数回调，因此消费者需要 DOM 类型库。它们不属于跨进程 JSON 协议，公共能力 SDK 不重导出这些类型。

依赖方向为 Web 接口 → `@aibo/plugin-protocol`；协议包保持纯数据，不能反向依赖本包。Svelte 等具体框架实现留在宿主可信构建中。本包当前仅本地打包，未发布注册表。
