# 按需 Node 运行时验收

日期：2026-09-30。宿主基线 `b4abafd` 加本次改动，macOS arm64。
宿主 SDK 0.1.7、本机 Node 24.18.0、专用下载版本 24.18.0。
真实会话使用已打包的 Claude Code 插件 0.4.2、外部 Claude Code 2.1.280。

## 实现范围

- 默认搜索进程 PATH 与 GUI 常见安装目录，跳过不满足宿主或插件要求的候选，最后使用已下载的专用 Node。
- 手动文件为持久化的显式覆盖；失败选择保留旧设置，恢复自动查找移除覆盖。使用 Node 报告的真实程序路径启动，版本管理器 shim 不会随插件工作目录切换引擎。
- 探测有超时和输出上限，缓存随文件变化失效，并在 30 秒后重新检查；重新检测立即清除缓存。
- 管理中心显示路径、版本、来源和诊断，提供下载、选择文件、恢复自动查找与重新检测。操作完成刷新插件可用性，不自动启用用户已禁用的插件。
- 原生下载校验固定官方 SHA-256，解压 Node 和 LICENSE 后验证可运行及版本。新目录和选择记录发布成功才启用，失败不覆盖原选择；不修改系统 PATH，不依赖 Node/npm/curl/tar。
- Tauri 开发和发布钩子不再准备 Node，应用资源移除 Node。旧进程和会话 release 绑定保持原状。

## 证据

| 层级 | 命令或探针 | 结果 |
| --- | --- | --- |
| 宿主自动检查 | `pnpm run verify` | 架构、类型、迁移检查、522 项 Node 测试与前端构建通过 |
| 原生模块 | `cargo test --manifest-path src-tauri/Cargo.toml --lib node_runtime` | 7 passed；另有 1 个真实下载用例默认忽略 |
| 原生完整回归 | `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=4` | 275 passed、4 ignored；随后增加的 shim 目标变化测试由上行单独通过 |
| 真实下载 | `cargo test --manifest-path src-tauri/Cargo.toml --lib node_runtime::tests::official_download_runs_with_empty_search_path_and_survives_restart -- --ignored` | 从官方源下载；空搜索路径选择专用程序、清空环境启动 `--version`、重新读取持久化配置通过 |
| 浏览器 App | `node probes/node-runtime-browser.mjs` | Material 3 与 ak-ui 浅/深主题，以及两个实际激活的外部工作台通过：缺失/低版本提示、下载失败重试、文件选择、自动查找恢复、依赖刷新 |
| 隔离原生桌面 | `AIBO_VERIFY_NODE_RUNTIME=1 AIBO_EXPECT_PARAMETER_SCOPE=current-model node probes/default-session-profile-native.mjs <claude-package>` | 本机解析、手动选择、无效路径拒绝且保留设置、恢复自动查找；插件安装启用、默认 Plan 会话创建关闭、模型配置读取通过 |
| 发布构建 | `pnpm tauri build --bundles app` | 成功；Aibo.app 实测约 41.81 MiB，Resources 内没有 node-runtime 文件 |

日志：`/tmp/aibo-node-{verify,rust,rust-all,download,browser,native,release}.log`。
界面截图：`/tmp/aibo-node-*.png`。桌面报告：`/tmp/aibo-default-session-profile-native.json`。
产物：`src-tauri/target/release/bundle/macos/Aibo.app`。

首次沙箱内 verify 的 MCP 回环服务监听被 EPERM 拒绝，允许本机监听后整套通过。
首次高并发 Rust 回归在既有写入审批测试的依赖可用性断言失败；单测重跑通过，
增加断言诊断并将并发设为四后整套通过，未放宽依赖探测超时或测试预期。
浏览器外部包探针最初使用了错误 iframe 选择器及会被替换的导航设置按钮；
修正为实际外部 iframe 和固定宿主设置入口后通过，产品代码没有为探针改动。
桌面探针成功后主动终止开发进程，日志尾的 ELIFECYCLE 不表示探针失败；探针退出码为 0。

## 边界

- macOS arm64 已实测；Windows、Linux 和其他架构尚未实机验收。
- 下载用例验证真实官方源；未逐一验证代理配置、离线网络及全部下载超时情况。失败保留旧配置有模块回归。
- 原生桌面通过 IPC 执行文件选择保存；系统文件对话框的点击由浏览器替身验证，未自动操作真实系统选择器。
- Claude 会话探针没有发送模型提示；本次未重跑模型生成、工具写入和审批回合。
- 重新下载留下旧专用目录，避免破坏既有进程；本次未增加旧运行时清理界面。
