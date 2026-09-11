# P3 第五批：Git 只读能力包与语义贡献安装

> 2026-09-11。安装 → Broker 调用 → 现有界面呈现已打通；P3 整体仍需生命周期、完整扩展点合同和稳定协议收尾。

## 可使用的结果

在插件管理中安装并启用仓库内 `fixtures/plugins/git-read`，选择可信 Git 工作区，然后通过命令面板（⌘K / Ctrl+K）打开“Git 工作区变更”。可查看变更、分页、打开工作区或暂存区差异，以及返回列表、刷新和切换布局。无需 Agent 会话。当前包声明支持 macOS/Linux，依赖 Node >=22 与 Git；Windows 的子进程树管理尚未验收，因此此包暂不声明 Windows 支持。

`fixtures/plugins/git-view` 是可选的独立声明包：不含可执行入口，依赖前一个能力包，启用后出现“Git 变更（独立声明包）”。它与随包页面调用相同的固定能力 release，两者拥有各自的视图身份和状态。安装登记和启用仍分开，不自动下载或启用依赖。

| 能力契约（实验版本 1.0.0） | 输入 | 结果 |
| --- | --- | --- |
| `dev.aibo.git.changes` | `{}` | 带工作区/暂存区标记的变更条目与截断标记 |
| `dev.aibo.git.diff` | `path`、`staged` | 文本内容与截断标记 |
| `dev.aibo.git.view` | `actionId`、`itemId`、`offset` | 纯数据的 `state`、`view`、`actions` |

前两个能力可以在不加载任何 Git UI 时，经现有提供者列举、显式绑定和 `invoke_capability` 独立调用。第三个服务于已安装语义贡献；它由通用语义宿主按声明绑定，不改写工作区的全局提供者偏好。

## 宿主与界面边界

`semantic_plugins.rs` 从启用的安装目录发现 `workspace.tool` 贡献，当前只开放 `workspaceSelected` 可见性、实验协议 1.0 和 collection/detail 合同。Agent v2、其他扩展点/语义类型与 presentation 激活继续诊断为不支持；不把此批当作 settings/inspector 等完整合同已实现。

语义提供者输入合同固定为上述三个字段；初次打开使用 refresh/null/0。输出体见 `contracts/semantic-provider.experimental.schema.json`。宿主用已登记的贡献 ID、标题和当前工作区包装完整快照，生成 generation/revision；插件不提供宿主身份。完整快照通过既有 semantic-view schema、重复身份、枚举属性、选择和分页关系检查后才进入界面。

提供者只从本包或该贡献声明的直接依赖中选择；外部依赖先固定 release。调用使用声明的 operation 和 provider.version.min 对应的精确能力版本；没有候选或多个候选明确报错，不随意选一个。后续扩展版本协商时需演进合同，当前没有隐式寻找区间内更高契约版本。

动作必须来自同一窗口、同一工作区/贡献/generation 和最新 revision，且当前快照声明它可用；查看详情只能选择当前页条目。重复并发动作返回 busy。关闭或禁用释放 lease，旧动作不能重新激活页面。首次打开尚未返回 generation 时，前端以窗口内请求 ID 每 100 毫秒请求取消；宿主只取消该窗口对应的打开请求，不接收调用者身份或 generation 授权。每个宿主最多 128 个 lease，空闲期限 30 分钟；当前视图状态只驻留宿主内存。

`InstalledWorkbench` 与其数据控制器复用已有 PresentationSurface/UiKitAdapter。App 根据目录生成命令，无 Git 插件 ID 或皮肤分支；旧固定的 P1 只读命令已从主界面替换。目录每 2 秒刷新，当前窗口安装变更也触发刷新；停用页面立即在后端失效，界面在下一次目录刷新时关闭。布局、选中条目、详情和页码按窗口、工作区、贡献及 release 保存；恢复时重新查询并验证条目仍存在。

P1 的独立 Git 实验端口与测试保留作为参考/兼容路径；现有 Inspector 的 Core Git 面板及写入动作没有迁入此包。本批新增的已安装工具与后台能力均在插件进程执行，不将整套历史 Git 代码都宣称迁移完成。

## 资源、取消与限额

- Broker 仅允许可信工作区中的 `workspace.read`；路径来自宿主数据库。Git diff 与 view/inspect 在分发前通过宿主 Git 合同守卫，拒绝绝对路径、父目录、`.git` 和 canonical target 越界。worker 再次检查目标，并要求所选工作区就是该仓库根目录，避免读到上级仓库。
- 命令使用参数数组和 literal pathspec，不经过 shell；禁用外部 diff、textconv、fsmonitor、hooks，关闭交互提示和可选锁。此包不实现 stage、commit 等写入动作。
- Git 命令单次最多 4 秒、输出缓冲最多 2 MB；变更最多 1000 条，并受约 90 KiB 条目预算约束。语义页每页 50 条。差异最多 32,000 个 UTF-16 单元，截断不切断代理对；超限明确标记截断或返回不可用，沿用 Broker 的 256 KiB 结果限制。
- Unix 能力进程使用独立进程组，停止时一起结束它启动的 Git 子进程。关闭正在打开/读取的页面会持续请求取消直到已接纳调用收尾，不丢弃执行 future 后留下 running 审计。独立声明包停用只结束相关页面调用，不停用共享 Git 能力。
- 这些是可信本地进程和受控 API 的边界，不是 OS 文件/网络沙箱；工作区内容在查询期间变化时，下次动作重新读取，不保证跨查询文件系统快照一致性。

## 验证

- `cargo test --manifest-path src-tauri/Cargo.toml`：133 项通过。新增 5 项真实安装/进程测试覆盖后台独立查询、随包与独立声明包、宿主身份与过期动作、禁用/卸载、分页、未暂存文件的 staged 查询、Unicode 截断、symlink 重定向，以及首次打开取消和 Unix 子进程组清理。
- `pnpm run verify`：23 项架构检查、137 项 Node 测试、类型检查和生产构建通过。前端控制器覆盖乱序打开、上下文伪造、迟到结果释放和首次打开取消。
- `node probes/git-plugin-native.mjs`：两次真实 App 启动；挂载完整 App 前调用 Git 能力，再从实际命令面板进入已安装工具。shadcn/Material 3 均能展示真实列表和差异，独立声明包同样可用；禁用关闭页面、重启保留能力绑定、卸载使关联贡献失效。[原生结果](./baselines/plugin-platform-p3/git-native-results.json)。
- `node probes/plugin-manifest-browser.mjs`：两套皮肤均保留尚未支持类型的激活诊断、可选依赖局部降级、v1 创建与卸载入口。[管理界面结果](./baselines/plugin-platform-p3/git-manager-results.json)、[shadcn](./baselines/plugin-platform-p3/git-manager-shadcn.png)、[Material 3](./baselines/plugin-platform-p3/git-manager-material3.png)。
- 原生退出后只读检查隔离 SQLite：2 次后台 changes 与 16 次 view 调用完成，两次 App 启动产生 2 个进程 generation；0 个 Agent session/AgentEvent，无残留 running。[审计结果](./baselines/plugin-platform-p3/git-audit-results.json)。

一次中间的并发全量运行曾出现旧 Echo 用例期望 idle、实际 interrupted 的状态异常；后续全量 133 项及该用例单独复核均通过，未放宽旧 Agent 断言，原因尚未复现定位。最终原生结果全部通过。脚本在报告成功后主动结束 Tauri 开发进程，判断依据为外层退出码和结果断言。

## 剩余工作

P3 还需完整扩展点与 settings/inspector 合同、turn 关联、独立能力事件、稳定实例身份、完整升级/旧包回收/私有数据策略、接纳前失败审计，以及稳定协议兼容窗口与整体验收。写入审批、幂等和结果未知继续按后续写入阶段推进。
