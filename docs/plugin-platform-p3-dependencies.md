# P3 第三批：声明依赖解析与 release 固定

> 2026-09-11。P3.2 的依赖解析验收完成；插件间调用传播、Git 能力及语义贡献安装仍待实施。

## 实现与选择原因

Registry 与 Broker 共用 `plugin_dependencies.rs`。v2 的 `packageDependencies` 表示插件包依赖，v1 的 `dependencies` 仍表示本机可执行文件依赖。

首次启用，或选定提供者后的绑定/执行，会将可用依赖固定到具体安装 release。优先选择已安装、已启用且满足版本区间的最高版本；版本相同时按安装 ID 确定顺序。安装列表和提供者查询只读，不因打开管理面板而改变绑定。缺失的可选依赖后来可用时，也在这些明确的激活/绑定/执行入口固定。

迁移 `0026_plugin_dependency_bindings.sql` 保存每个安装的依赖 release。已有固定优先于版本选择，即使该 release 被禁用或卸载，也不会静默换用另一个版本。这样安装新版本不会改变已有插件的运行环境；应用重启保留相同结果。本批没有自动升级、重新选择依赖的 API，也不自动下载或启用依赖。

| 情况 | 行为 |
| --- | --- |
| 必需依赖缺失、禁用、不兼容或成环 | 拒绝激活，不保存本次解析产生的部分绑定 |
| 可选依赖不可用或成环 | 仅停用声明中列出的本包 contribution；其余功能可用 |
| 依赖的必需依赖失效 | 沿必需依赖边传播不可用状态 |
| 传播遇到可选依赖边 | 只停用该边关联贡献，不继续把整个包判为失效 |
| 安装更新的依赖 release | 原绑定保持不变 |
| 恢复原固定 release | 重新满足条件后恢复可用，无需替换绑定 |

禁用/卸载通过现有串行生命周期入口处理：先阻止新调用，再沿已固定的反向依赖图取消受影响的活动调用和缓存进程。必需依赖影响整个依赖方；可选依赖只取消关联贡献，无关的正在运行调用可以完成。卸载继续沿用有界排空和历史保留规则。

解析使用事务与串行锁；失败的可选子图不留下半套绑定，根的必需依赖失败则不写入任何新绑定。图深度上限 16、可达 release 上限 128、安装目录上限 4096、加载的图 manifest 总量上限 8 MiB；超过限额明确拒绝。本机依赖和激活兼容性也参与可用性判断。

## 验证证据

- `pnpm run verify`：23 项架构检查、131 项 Node 测试、类型检查和生产构建通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：123 项通过。新增 6 项覆盖必需/可选缺失、只读查询不固定版本、最高可用版本、重装恢复、必需/可选环、失败无部分写入及反向失效传播。真实子进程并发测试确认受影响贡献取消、无关贡献完成。
- `node probes/plugin-manifest-browser.mjs`：两套皮肤均显示可选依赖诊断，并允许无关功能启用；旧 Agent 创建和卸载入口保留。[结果](./baselines/plugin-platform-p3/dependencies-results.json)、[shadcn](./baselines/plugin-platform-p3/dependencies-shadcn.png)、[Material 3](./baselines/plugin-platform-p3/dependencies-material3.png)。
- `node probes/dependencies-native.mjs`：真实 WebView → Tauri → 父包进程，两次实际 App 启动验证缺失降级、延迟固定、更新不换绑、禁用不转交、重启恢复及卸载后无关功能仍可调用。[原生结果](./baselines/plugin-platform-p3/dependencies-native-results.json)。
- 原生退出后只读检查隔离 SQLite：5 次 completed、无残留 running、1 条依赖绑定、0 个 Agent session。[审计结果](./baselines/plugin-platform-p3/dependencies-audit-results.json)。证据不保留临时工作区路径或输入正文。

原生脚本在成功报告后主动结束开发进程，子进程 ELIFECYCLE 不代表失败；以外层退出码和结果断言为准。

## 后续边界

当前父包通过真实进程执行自己的 echo 功能，依赖声明控制其贡献可用性；尚未执行父插件调用子插件。固定依赖不授予权限，也不继承依赖包的授权。下一批需要接通 Broker 插件间调用，传播原始调用者、权限与资源范围交集、调用链、deadline 和取消；之后完成 Git 只读能力迁包及语义贡献安装。P3 整体退出条件保持未完成。
