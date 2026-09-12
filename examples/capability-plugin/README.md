# 独立 Capability 插件样例

这个目录只依赖 `@aibo/capability-runtime` 和 `@aibo/plugin-protocol`，不导入 aibo 应用源码。它声明 application 作用域的只读能力和 command 语义视图。

宿主查询语义视图时发送 `{actionId,itemId,offset}`，不会传空对象。此样例只提供 refresh，因此输入 schema 明确接受 refresh、null itemId 和非负 offset。能力输出包含 state/view/actions，宿主补齐视图身份与 revision；插件不自行生成宿主上下文。

开发流程：

1. 将本目录复制到仓库外。
2. 安装本地打包的两个 SDK tarball；使用 TypeScript 编译器运行 `tsc -p tsconfig.json`。当前 SDK 尚未发布注册表，不能假设公网安装已可用。
3. 使用 `npm pack --ignore-scripts`，`bundledDependencies` 会把运行所需的两个 SDK 放入产物。最终 package.json 的依赖使用版本号，不保留本机 tarball 路径。
4. 解包后从 aibo 插件管理安装、启用。直接能力调用先通过宿主选择并绑定 Provider；语义视图从通用命令入口访问。
5. 卸载后贡献消失，新调用被拒绝。

仓库内可运行 `node probes/external-plugin-native.mjs` 自动执行上述构建和 macOS 实际 App 验收，使用独立临时目录、离线 npm 缓存和隔离应用标识。构建器使用仓库已有 TypeScript 编译器作为开发工具，但消费者代码与类型解析全部位于仓库外；安装产物不包含编译器、工作区符号链接、Svelte、DOM/CSS 依赖或应用源码。
