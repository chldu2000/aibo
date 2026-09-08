# Phase 4.7B：宿主接线与异常场景检查

> 状态：已完成（自动化检查与 Tauri 窗口人工 smoke 均通过）
> 日期：2026-09-08
> 范围：App 接线、插件工作台状态、进程退出分类、会话终态和恢复

## 结论

宿主集成测试、旧数据库迁移测试、App 接线静态门禁、关键异常回归以及真实 Tauri 窗口中的人工 smoke 均已通过。P4.7B 验收完成。

## 自动化证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 外部包安装、默认禁用、启用和重复安装回滚 | 通过 | `plugin_host::tests::installs_external_package_streams_cancels_and_restores_persisted_session` |
| 创建、流式消息、Unicode、标准 view、取消、关闭与进程重启恢复 | 通过 | 同上；`test/echo-plugin-process.test.mjs` |
| 插件崩溃后的 session/turn/process_runs 状态 | 通过 | `plugin_host::tests::crashed_plugin_marks_generation_crashed_and_session_interrupted` |
| Runtime malformed/oversized/unknown response、超时和 generation 隔离 | 通过 | `plugin_runtime::tests::*` |
| 旧数据库历史、v1 event 读取和第三方 agent identity | 通过 | `plugin_registry::tests::session_migration_preserves_old_history_and_allows_external_identity` |
| App 安装、启用、创建、发送、取消、恢复、关闭 API 接线 | 通过 | `test/plugin-view-renderer.test.mjs` 的 App plugin controls 测试 |
| 轮询取消、旧 session view 不串线、timeline 与 view 异常分离 | 通过 | `test/plugin-view-renderer.test.mjs` 的 transition 测试 |
| disabled/closed session 的恢复按钮 | 通过 | `PluginWorkspacePanel.svelte` 的 `resumable` 门禁及对应测试 |

## 本次修正

- turn 终态 `completed`、`interrupted`、`failed` 分别投影为 session 的 `idle`、`interrupted`、`failed`，不再把取消和失败伪装为空闲。
- 进程退出根据是否由宿主主动停止区分 `process_runs.exited` 与 `process_runs.crashed`；崩溃会中断活动 turn 和 session，但保留历史投影。
- 已关闭的 Aibo Session 不允许再次 `resume`；插件工作台只对 `interrupted` 或 `failed` 会话显示恢复操作。
- 宿主写入按实例串行化，并为 SQLite 写锁配置忙等待，避免事件投影与下一次发送的短暂竞态被误报为插件退出。

## 人工 smoke checklist（2026-09-08：通过）

在支持 Tauri 窗口的环境中，用 `node probes/build-echo-plugin.mjs <new-empty-directory>` 生成仓库外测试包，然后验证：

1. 打开“插件”工作台，安装包，确认安装后默认禁用。
2. 启用插件并创建 Echo 会话，发送 Unicode 文本，确认时间线和 view 出现。
3. 发送长文本并点击停止，确认 session 进入 interrupted；点击恢复后可继续发送。
4. 关闭应用并重新打开，打开插件工作台，确认历史可读且恢复不会新建错误绑定。
5. 切换工作区、会话和 shadcn/Material 3 主题，确认没有旧 view 或错误状态串入当前会话。
6. 输入不存在或损坏的包路径，确认错误可见、按钮恢复可用，已有历史不消失。

人工 smoke 已通过，P4.7B 状态为“已完成”。P4.7D 继续补充完整视图动作、窄窗口、焦点恢复和生命周期验收。
