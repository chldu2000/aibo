# Presentation 插件退出审计

本表核对 [原始目标与 P0–P4 清单](presentation-plugin-refactor.md)，不是重新定义范围。
截至本次核对，整体目标尚未完成。浏览器证据使用真实 App 与 Worker、替身原生
IPC；原生记录使用 macOS arm64 WebView 与真实 Tauri IPC，操作为 DOM 脚本。

| 原始要求 | 当前证据与结论 |
| --- | --- |
| 统一身份、可选主题/控件/语义/工作台、默认继承 | ADR-0008/0009、公共 manifest、`presentation-plugin.test.mjs`、`presentation-package.test.mjs`、`presentation-skins.test.mjs`，及主题/控件浏览器记录。已实现并验证。 |
| 发现、验证、安装、启用、切换、禁用、卸载、升级 | `presentation_packages.rs` 与原生四进程记录。P2 前两项已有证据，本次维持完成。 |
| 单一选择与旧外观兼容 | App 的 `presentationOptions`、`choosePresentation`、`choosePresentationTheme` 合并入口；registry 继续读取旧 `aibo.appearance.v1`，无需破坏性改写。[新增记录](baselines/presentation-p4/legacy-appearance-browser.json) 验证旧 Material 3/Sage 启动、外部包唯一活动项、重启和回退保留。完成。 |
| 迟到动作、取消、释放、重复切换 | `presentation-package-controller.test.mjs` 检查候选取消、失败持久化、dispose 后迟到提交回滚；[可信桥记录](baselines/presentation-p3/message-anchor-sandbox-browser.json) 检查旧 revision、合成事件、候选取消和实例释放。完成。 |
| 初始化/运行故障、丢失包、损坏包、重启 | [四进程原生记录](baselines/presentation-p4/native-startup-failure.json) 验证失败候选保留旧版本、运行死循环、缺失 manifest、错误摘要、清除选择、保留工作区与健康版本重新激活；包测试覆盖不兼容拒绝。对应 P2/P4 故障项完成。 |
| 固定管理、审批、恢复在恶意/故障呈现下可达 | 管理与恢复有上述原生和沙箱证据；[固定审批故障记录](baselines/presentation-p4/approval-fault-browser.json) 等待真实 Worker 进入死循环后点击允许，验证 iframe 尚未移除；回退后另一待审批可拒绝，伪造 token 无效、精确请求身份正确。P2 完成，审批交互的原生 IPC 为替身。 |
| 两套独立构建包、纯主题与完整样例、开发文档与工具 | `packages/presentation-{tools,workbench,shadcn,material3}`、`examples/presentation-theme`、[包文档](presentation-package.md)。`build-presentation-skins.mjs` 将 tarball 解包到仓库外再构建；`presentation-build.test.mjs` 与 `presentation-skins.test.mjs` 校验完整性、四主题/核心语义/控件/工作台。原生记录证明安装/展示/升级/卸载。P3 三项完成。 |
| 实际 App 双皮肤、布局、语义、键盘、焦点、滚动、草稿、会话 | [最新双皮肤记录](baselines/presentation-p3/message-anchor-browser.json)、[隔离记录](baselines/presentation-p3/message-anchor-isolation-browser.json)、[回答重载记录](baselines/presentation-p3/answer-draft-reload-browser.json) 和原生重启记录覆盖大量交互。尚缺整体渲染与辅助功能审查，不能将局部探针合并为全部体验已完成。 |
| 必需控件与核心语义完整、可选专业视图降级 | 内部 UiKitAdapter 仍完整；外部未提供范围继承，四类核心语义预检。可选专业呈现不是第二种插件身份；其具体协商/降级的最终交互仍需退出复核。 |
| 验证命令、UI 架构、支持矩阵 | 各阶段运行 verify，原生阶段有 Rust/真实 App 证据；本次修正包文档和矩阵的过期状态。最终退出前仍须对最终树运行 verify 并核对所有未完成项。 |

后续工作按剩余原始条目推进：审查双皮肤整体渲染、
键盘/辅助功能和可选视图降级。不会将缺少物理输入或其他平台证据表述为已通过。
兼容包版本仍为开发中的 0.2.0；原生禁止同 ID/版本不同内容，最终交付须确定新的
发行版本并用最终构建复验升级，不能拿历史构建摘要证明最终资源已验收。

本次核对补充旧外观兼容探针，并运行 `pnpm run verify`：25 项架构检查、247 项
Node 测试、类型检查与构建通过，保留既有动态/静态导入及构建体积提示。
