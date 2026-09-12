# P3 退出矩阵

2026-09-12。P3 以只读能力和贡献安装为验收范围；写入审批、写冲突、写后结果未知和持久幂等继续属于 P4。

| 验收目标 | 结果 | 证据 |
| --- | --- | --- |
| Manifest v2、命名空间、版本/声明校验；v1 适配 | 通过 | plugin_manifest/plugin_registry Rust 测试；manifest 与 dependencies 前期记录 |
| application/workspace/session Broker；turn 关联 | 通过 | capability_broker 测试；lifecycle-native-results.json |
| 身份、输入输出、release/generation、超时/取消 | 通过 | capability_broker 全部测试；broker-native-results.json |
| 实例缓存上限、空闲回收、工作区取消/崩溃隔离 | 通过 | cache_limit_eviction_and_crash_preserve_scope_identity_and_isolation 及既有取消测试 |
| 声明依赖、必需环拒绝、可选降级、固定 release | 通过 | plugin_dependencies 测试；dependencies/call-chain native 证据 |
| 只读插件调用链身份、权限交集、取消传播 | 通过 | call-chain-native-results.json；父超时/崩溃/深度上限测试 |
| 升级不改已有绑定；卸载保留恢复引用及历史 | 通过 | release 固定、原生双启动、registry 重新安装与传递依赖回收测试 |
| 包外版本化私有数据，不随卸载或 GC 删除 | 通过 | plugin_storage 测试；retired_release_is_retained_until_recovery_references_disappear |
| 稳定语义 v1 和旧实验快照继续读取 | 通过 | semantic-stable.test.mjs；completion-browser-results.json |
| 五扩展点、可选不兼容诊断、只读 settings/inspector | 通过 | all_registered_extension_points_have_scoped_read_only_views；completion-native-results.json、completion-manager-results.json |
| 两套皮肤与独立 DOM renderer 的读/刷新语义 | 通过 | completion-browser-results.json；completion-*-stableSettings/Inspector.png |
| 不启动 Agent、不挂 Git UI 直接调用 Git | 通过 | completion-native-results.json 的 backgroundGitWithoutUi；completion-audit-results.json |
| Git 自带贡献/独立声明贡献自动发现与呈现 | 通过 | completion-native-results.json；禁用、卸载及重启场景 |
| Echo/Codex/Pi v1 Host 与旧历史回归 | 通过 | Rust 全量 140 项；原 Echo 安装、流式、取消、重启、卸载历史保留测试 |
| Codex/Pi 真实服务冒烟 | 通过 | completion-provider-results.json：Codex transport/smoke/resume、Pi 插件 smoke |
| 必需仓库检查 | 通过 | pnpm run verify：23 项架构、140 项 Node、类型及生产构建；Rust 140 项 |

桌面审计：42 次 completed，42 组能力生命周期事件；没有 Agent session、AgentEvent 或遗留 running。规范调用记录保留，不以删除测试失败记录或旧历史换取通过。

前期 P2 凭据失败、P0 B05 和 P3 中间一次旧 Host interrupted 偶发现象仍按原记录保留；本次完整回归通过，不宣称这些历史问题的根因已被本批修复。真实 Codex smoke 使用 app-server，Pi 使用 v1 插件；完整宿主行为由 Rust 实际子进程回归与此前 P2 原生矩阵补充，不将两种测试混为同一路径。
