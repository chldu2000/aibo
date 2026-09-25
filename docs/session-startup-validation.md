# 会话启动优化验证（2026-09-25）

实现涵盖 Codex 目录重复请求、初始额度阻塞、会话创建等待、重启后的模型显示及模式加载。
Cursor 原生认证和 new/load 仍是必要步骤；本次没有跳过认证或改变 Cursor 权限归属。

- 源码基线：Aibo `a4ead16` 加本次工作树修改；Cursor 插件 `5f60515`。
- Codex bundled release：2.0.14；Cursor：0.1.16（未修改插件）。
- macOS arm64；Node 24.18.0；Codex CLI 0.156.1；Cursor CLI 2026.09.18-9a7762b。
- 隔离桌面探针：`node probes/session-startup-desktop.mjs`，使用独立 application identifier、临时工作区，未发送模型请求。

| Provider | 本地创建 | 模式读取 | 原生就绪 | 完整模型读取 | 热复用 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Codex | 6 ms | 4 ms | 212 ms | 104 ms | 6 ms |
| Cursor | 4 ms | 4 ms | 13,091 ms | 71 ms | 4 ms |

这是同一台机器上的一次观测，不是网络延迟承诺或冷缓存性能上限。探针确认本地创建时尚无
nativeSessionId/协商能力，模式可读取；就绪后同一宿主身份获得模型能力，重复 resume 不重建原生身份。

相关验证入口：

- `test/session-startup.test.mjs`：额度永不返回仍可创建与读取模型；原生目录合并、重启失效。
- `test/session-model-cache.test.mjs`：持久化、会话隔离、过期、损坏及不可用存储、并发合并与失效。
- `test/session-startup-controller.test.mjs`：慢初始化可先选中、导航不受阻、失败及迟到结果。
- `session_host::tests::prepared_session_is_visible_before_native_start_and_negotiates_only_when_ready`：真实 Broker/数据库、未协商状态、本地模式、并发恢复和禁用拒绝。
- `probes/session-startup-browser.mjs`：实际 App/Composer，模拟慢 IPC；浅/深主题下的目录快照、重载、模式、初始化草稿与发送门禁。
- `probes/presentation-full-skins-browser.mjs`：实际 App 和独立构建的 shadcn/Material 3 Worker，共享会话、模型、草稿、导航和恢复。

浏览器替身不证明原生执行；隔离原生探针不证明付费模型调用或用户日常安装包已经更新。
旧会话继续固定原 release，不迁移其绑定；新建 Codex 会话才能使用 2.0.14。

本次结果：`pnpm run verify` 通过（40 项架构检查、390 项 Node 测试、类型检查及构建）；
`cargo test --manifest-path src-tauri/Cargo.toml --lib` 239 项通过；上述两个浏览器探针与隔离桌面探针通过。
初次完整 Rust 测试的进程组用例受沙箱限制，改在正常本机权限下重跑后通过。
浏览器回归还复现了重复选择同一会话清空模型目录但不触发响应式重载的问题，现由导航控制器保留当前上下文。
