# Aibo 插件宿主演进最终退出审计

本轮 P0–P5 的必需范围已完成：能力通过宿主合同运行，标准贡献通过纯数据语义呈现，工作台可替换且宿主恢复/审批/历史独立，外部能力包可在仓库外构建并进入实际 App。代码已按阶段提交，未推送。

本结论依据当前实现、测试断言与归档的真实运行证据，保留下面列出的验收例外和发布边界。它不表示任意第三方前端、插件市场或所有桌面平台已经支持。

## 清单逐组核对

核对基准为 [实施清单](./plugin-platform-implementation-checklist.md)与[架构演进文档](./plugin-platform-evolution.md)。下表编号按各阶段清单从上到下计数，覆盖全部 75 个必需项；P5 两个 Custom Surface 条件项单列处理。阶段记录中的“下一阶段”“尚待实现”保留其历史含义，当前结论以本表及最终退出记录为准。

| 清单范围 | 要求及核对结果 | 实现与直接证据 |
| --- | --- | --- |
| P0 1–8 | 调用链、能力等价矩阵、历史样本、状态所有者、公共协议禁止项、版本并存、首切片、基线均已建立 | [P0 基线](./plugin-platform-p0-baseline.md)；真实验收及 B05 的用户批准例外见下文，未补造成功结论 |
| P1 1–9 | collection/detail 数据、身份、revision、动作分类、扩展点、受控映射、资源限额、正反 fixture、键盘/焦点合同 | [P1 记录](./plugin-platform-p1-semantic-slice.md)；semantic schema、Git projection/Host 与逆序/失效动作回归；当前验证继续读取这些合同 |
| P1 10–15 | 无 Agent 的窄端口投影、宿主权限复核、传递纯数据边界、Svelte adapter、双布局/双皮肤、完整视图状态 | `test/presentation-boundaries.test.mjs` 递归检查传递依赖与无 DOM 编译；P1 原生真实 Git 四组合，P4 核心视图复验 |
| P1 16–19 | 第二 DOM renderer、动作等价、四组合交互、通用可达入口与阶段边界 | P1 浏览器/原生 JSON 与截图；P4 核心视图探针继续验证 DOM/Svelte 和通用入口，未要求完整第二框架产品 UI |
| P2 1–3 | 统一 Agent facade、兼容装配隔离、非 Pi queue/tree 不误路由 | `test/agent-facade.test.mjs`、`test/p2-boundaries.test.mjs`；后者检查通用路由与兼容边界，不凭 Provider ID 增加新业务分支 |
| P2 4–5 | 状态所有者统一、草稿/选择/导航持久化和窗口隔离 | presentation-state、message-draft-ownership、workbench-drafts 回归；[P2 原生退出矩阵](./baselines/plugin-platform-p2/completion-matrix.md)两次 App 启动、第二窗口及草稿恢复 |
| P2 6–9 | 纯数据快照与本地 mount 接口分离，dispose/mount、generation 门禁、挂载失败恢复、流式和焦点保留 | presentation-lifecycle 回归、实际 Workbench 探针与 P2 原生 Echo；P4 重排/焦点/宿主恢复复验；P5 将本地 Web 类型单独打包 |
| P2 10 | Echo/Codex/Pi 等价与旧历史回归，Codex 推理强度修复 | P2 原生记录含真实模型设置和重启；model-configuration 回归及双皮肤模型矩阵；P3 真实 Provider smoke/resume 归档。没有把 CLI smoke 当作完整 UI 行为证明 |
| P3 1–5 | Manifest v2、v1 adapter、独立版本/依赖、schema/operation/命名空间、稳定语义与兼容 | plugin_manifest/plugin_registry 回归；`semantic-stable.test.mjs`；[P3 退出矩阵](./baselines/plugin-platform-p3/completion-matrix.md)与 P5 支持矩阵共同记录当前支持组合 |
| P3 6–12 | 三作用域 Broker、宿主身份、输入输出、release/generation/deadline、显式选择、错误/取消、权限受限调用链与固定依赖 | capability_broker/plugin_dependencies 实际进程测试；P3 broker/lifecycle/call-chain 原生归档；P5 候选初始化失败与旧依赖恢复进一步补强升级行为 |
| P3 13–17 | Registry/Runtime 复用、实例隔离和资源上限、五个扩展点、settings/inspector、进程外 Git 与声明贡献 | [P3 收尾](./plugin-platform-p3-completion.md)；原生双启动记录含无 Agent/无 Git UI 的后台调用、独立声明包和双皮肤；数据库审计为 0 session/AgentEvent，42 次完成与对应能力事件 |
| P3 18–21 | 活动/恢复引用保留、禁用排空、包外私有数据、独立事件与攻击/故障回归 | registry/storage/dependency/broker 回归；P5 升级失败、保留包重装、数据库重开后的同一 instance/数据恢复 |
| P4 1–5 | ADR 冻结边界、可信整窗 Presentation、通用入口、Core/optional/fallback、实际专业呈现 | [P4 退出核对](./plugin-platform-p4-exit-audit.md)逐项实现与探针；renderer 协商、完整文本保留、专业/核心连续失败与后续恢复回归；当前默认增强为带行号 detail |
| P4 6–7 | 非 never 的宿主确认、独立管理/授权/历史/停用与默认工作台恢复 | 原生 view/写入确认，App AST 确保可信区域在六个可替换槽位之外，host-shell/故障插件管理鼠标验收；失效批准和迟到回调测试 |
| P4 8–11 | 任务/Git 领域服务、持久写入/互斥/取消/未知结果、通用能力及逐层批准、页面离开不丢执行与过期上下文复核 | project_actions/workspace_git/workspace_write_runs/capability_writes/write_chain/semantic 写入真实进程回归；P4 三组原生写入，P5 原生写入重启与重放复验 |
| P4 12 | 整窗布局、全部核心视图、键盘/焦点、AX 名称、reduced-motion、双皮肤 | P4 退出文档列出五组浏览器与原生 AX 实际断言，既有证据未扩展为人工 VoiceOver 认证或其他 OS 验收 |
| P5 1–2 | 公共纯数据 SDK、独立本地接口，仓库外构建/打包/安装/调用/展示/卸载 | 三包实际 tarball，无 DOM 正编译与 Web 无 DOM 负编译；外部样例无宿主源码依赖；[P5 SDK 记录](./plugin-platform-p5-sdk.md)、本轮原生外部包记录 |
| P5 3 | 宿主/manifest/runtime/view/capability/renderer 版本与平台、UI 信任边界 | [支持矩阵](./plugin-platform-support-matrix.md)，逐项对照 Cargo/Tauri、manifest 支持检查、renderer 描述符和包 metadata |
| P5 4 | 新版失败不覆盖旧绑定、旧依赖保留、数据并存、代码/数据恢复分别说明 | [release 退出](./plugin-platform-release-recovery.md)：合法包崩溃/不兼容/超时、候选事务提交、审批与重复请求、旧依赖保留包恢复、真实 App 后续旧版调用及写入复验 |
| P5 5 | 核心增量迁移、旧 AgentEvent/历史可读、重建表保留字段 | [数据库退出核对](./plugin-platform-database-exit-audit.md)：磁盘旧库到 0040，v1/v2 原始 payload 与外部身份保留、重开幂等、只读分页、旧写入结果和 legacy 能力历史 |
| P5 6–7（条件项） | 没有实际 Custom Surface 需求，ADR 和实现均暂缓 | 支持矩阵明确此条件；没有动态 UI 加载器，不宣称已有隔离安全证明；不作为完成的实现勾选 |

## 最终验证与证据有效范围

最近完整 Rust 回归为 **213 项通过**，覆盖候选绑定、审批、旧依赖恢复和迁移至 0040。最终文档提交前 `pnpm run verify` 再次通过：25 项架构检查、174 项 Node 测试、类型检查和生产构建。SDK 包检查实际建立仓库外消费者，而不是只编译仓库源码。

P5 最后一次真实 App 复验已归档：[外部包与失败候选恢复](./baselines/plugin-platform-p5/release-recovery-native.json)、[可信写入与真实重启](./baselines/plugin-platform-p5/release-write-native.json)，两个外层进程 exit 0。前者同时证明双皮肤、无 Agent session、卸载关闭视图与拒绝后续调用；后者包含原生允许/拒绝、结果重放、卸载/信任撤销后历史以及无重复副作用。

P1–P4 的归档是相应阶段的真实验收记录，本文不声称本轮重新运行了全部历史探针或重新访问了远程模型服务。最终审计检查了阶段矩阵、关键归档 JSON、当前边界测试断言与后续改动覆盖；最后的运行逻辑改动集中在候选绑定，已经由完整 Rust、实际子进程和 P5 原生复验覆盖。纯数据包提取由外部编译与真实安装补证。

各阶段退出文档及 SDK/恢复/数据库文档的本地 Markdown 链接检查：38 个目标存在。链接存在只是交叉引用完整性，完成结论来自上表的实现与行为断言。

## 保留的例外与交付边界

- P0 基线的真实验收未执行与 B05 原始偶发失败按用户当时明确指令收尾；后续阶段各自进行了要求的真实回归。B05 根因仍不宣称已修复，P3 中间旧 Host interrupted 偶发现象同样保留历史记录。
- 原生验证范围为 macOS arm64。其他可识别平台不等于已验收；Windows Capability 写入目前不支持。平台范围以支持矩阵为准。
- Presentation/UI 实现随可信宿主构建发布。能力 SDK 无 DOM/框架/函数类型；本地 runtime helper 和 Web renderer 接口各自独立。主 UI 仍使用 Svelte，跨框架边界由独立 DOM renderer 与纯数据合同证明。
- SDK 保持单仓库、private、本地 tarball；外部开发路径已成立，不要求本轮发布公共注册表或迁移旧 Agent 目录。
- 插件市场、自动远程更新、运行中 Provider 热替换、任意第三方前端、通用工作流语言和完整第二框架产品 UI 不在本轮承诺内。
- 主 chunk 超过 500 kB 的构建提示与既有 Rust dead-code 等警告保留，没有放宽测试或告警阈值来完成验收。

上述边界与原计划一致，不是为结束任务临时缩小范围。75 个必需项按实现/证据闭合，两个未触发条件项明确暂缓；本轮“aibo 向插件宿主演进”目标达到退出条件。
