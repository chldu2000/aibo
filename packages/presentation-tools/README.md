# @aibo/presentation-tools

独立的 Presentation 目录打包工具。当前通过本地 tarball 分发，尚未发布注册表。
CLI 只依赖 Node.js 22+；类型声明依赖 `@aibo/plugin-protocol`。

```sh
npm pack --ignore-scripts
node /path/to/unpacked/package/build.mjs ./presentation.source.json ./dist/skin-1.0.0
```

源 JSON 使用正式 manifest 字段；`resources` 中只需提供 `path` 与 `mediaType`，
工具根据实际文件生成 `bytes` 和 `sha256`。路径相对于源 JSON，拒绝路径穿越及
资源路径中的符号链接。入口 JavaScript 必须提前打包为单文件 Worker 脚本；工具
不执行源代码、不解析依赖，也不将 Svelte/DOM 实现转换成受限视觉树。

输出包含 `presentation.json` 和列出的资源，可在 App 的 Presentation 安装目录
入口选择。输出目录必须不存在；升级使用同 ID、更高版本和新的输出目录。构建
验证与宿主共用实现，但原生安装仍独立验证文件与摘要。

纯主题源示例见 `examples/presentation-theme/presentation.source.json`，复制到仓库外
仍可构建。没有提供的控件、语义视图和工作台继承宿主。可执行包另声明 `entry`、
`surfaces`，并实现包合同规定的 Worker 接口；构建成功不代表运行或功能验收通过。
