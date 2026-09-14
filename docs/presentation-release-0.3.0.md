# Presentation 0.3.0 交付

皮肤就是 Presentation 插件：同一入口管理主题、控件、核心语义和完整工作台，
宿主保留未覆盖范围、业务状态、审批与恢复。双皮肤独立包为 0.3.0，共享纯数据
工作台模块为 0.2.0；工具与公共协议仍为 0.1.0。

本地交付位于 `dist/presentation-release-0.3.0/`（生成物，不纳入 Git）：

- `shadcn-0.3.0.zip`、`material3-0.3.0.zip`：解压后，在 Aibo 设置中点击“安装皮肤插件”，选择包含 `presentation.json` 的目录，再选中该皮肤。
- `ocean-theme-1.0.0.zip`：同一安装入口的纯主题样例，其他范围继承默认呈现。
- `sdk/`：五个离线本地 npm tarball，包含两皮肤、工作台、打包工具、公共协议。
- `receipt.json`：版本、资源摘要、压缩包摘要和验收记录对应关系。

0.3.1–0.3.3 仅供原生探针模拟升级、失败候选和运行故障，不包含在交付中。
同 ID/版本的内容不可替换；修改资源后请使用新版本和新输出目录。

若重新运行主项目构建，`dist/` 会被清理。可按两包 README 将本地 tarball 安装到
仓库外目录，运行各自 `build.mjs` 重建；默认输出版本读取 package.json。

本版包含三种宿主布局、独立历史/编辑区、键盘建议、焦点/选区与消息锚点恢复、
草稿和布局持久化、完整语义数据及明确专业阅读降级。插件代码运行于可终止
Worker，不能直接控制 DOM、网络、存储或 Tauri IPC。

验证结果：最终 verify 全部通过（25 项架构检查、248 项 Node 测试、类型与构建），
原生存储 4 项测试通过。Chromium 验证真实 App/Worker 和浏览器输入，原生 IPC
为替身；macOS arm64 验证真实 Tauri 四进程生命周期，操作为宿主 DOM 脚本。
这不构成其他 OS、原生物理输入或所有屏幕阅读器认证。既有构建与 Rust 警告保留。

完整逐项证据见 [退出审计](presentation-plugin-exit-audit.md)，可校验摘要见
[交付收据](baselines/presentation-p4/release-0.3.0-receipt.json)。

[离线 SDK 安装记录](baselines/presentation-p4/release-0.3.0-sdk-install.json) 在全新目录
通过 npm 一次安装全部本地 tarball 后，运行两包默认构建；manifest、脚本和样式
与交付目录逐字节相等。可使用 `npm install --offline --ignore-scripts /绝对路径/sdk/*.tgz`
安装本地 SDK，再按皮肤 README 构建。
