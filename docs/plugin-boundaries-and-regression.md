# 宿主与插件边界：踩坑记录及回归约束

本规范由根目录 [AGENTS.md](../AGENTS.md) 引用，适用于宿主业务、能力插件、呈现插件及共享合同的修改。依据截至 `0ee10c5` 的相关提交和 [呈现退出审计](presentation-plugin-exit-audit.md)；历史提交用于解释约束来源，不表示本次重新验收过其全部行为。合同细节以目标版本的 schema、类型、实现及现行文档为准，archive 与早期阶段记录不能直接当作现行限制。

## 先确定谁拥有状态、谁执行动作

| 边界 | 应承担的职责 | 修改时必须守住的约束 |
| --- | --- | --- |
| 原生宿主、Broker、SessionHost | 安装信任、合同验证、作用域与身份、执行准入、固定绑定、事件持久化、队列及恢复 | 会话调用经 Broker；页面或插件不能自授权限、选择任意执行后端或重绑已有会话 |
| 宿主业务控制器与投影 | 管理已验证状态、可恢复草稿/浏览位置、加载与错误状态，生成当前动作目录 | 呈现切换不重建能力实例或丢弃业务状态；读请求与写结果分别处理 |
| 能力插件/原生 Adapter | 提供准确能力和数据，映射原生协议、配置、事件、审批及恢复 | 厂商兼容逻辑留在 Adapter；能力结果保持语义数据，不输出 HTML/CSS 或宿主 UI 实现 |
| 呈现插件与皮肤 | 消费宿主快照及动作，组织布局、视觉、局部筛选/展开等瞬时状态 | 不持有权威执行状态、不访问通用 IPC、不拼造动作或权限；跨切换/重启状态进入宿主合同 |
| 可信宿主界面与绘制桥 | 保有管理、审批、恢复入口；将真实用户事件转换为受限意图 | 入口位于可替换 surface 外；Worker 只计算受限视觉树，外部脚本/CSS 不进入固定宿主区域 |

出现“只有某个 Agent/皮肤需要例外”时，先检查是否遗漏能力、状态或展示语义。共享层扩展通用合同，由插件提供实现；厂商原生参数在 Adapter 中转换。新插件满足相同合同后，应无需修改宿主业务分支。

## 从提交中提炼的约束

### 能力可用不等于 UI 可用，更不等于执行授权

- `188782b`：没有 `model.select` 的会话仍触发模型发现，产生 provider unavailable。后台加载和刷新也必须受能力门禁控制，不能只隐藏控件。
- `f6ccff4`：第三方命令目录正常，但 Composer 因 `selectedAgent=null` 隐藏 slash 菜单。验证必须覆盖 App → 业务投影 → 控件，不以函数返回或 RPC 成功代替真实入口验证。
- `7865fad`：把 Agent 身份分支改为协商能力。manifest、握手和 open 声明必须共同满足宿主合同；支持与暂时可执行分开判断。详见 [协商规则](session-capability-negotiation.md)。
- `7a9ff8d`、`397c374`、`0ee10c5`：会话控件由 provider 声明，模式与权限类别分别呈现。宿主重新校验 controlId 对应补丁；呈现不提交任意执行配置。原生权限管理不等于沙箱或 CoreProxy，文案与状态标识须与执行路径一致。详见 [会话控件](session-controls.md)。

回归至少包括：相同能力但不同身份、缺少能力、schema/版本不匹配、只声明未实现、忙碌/归档/禁用、能力正常但 UI 无入口。未知第三方提供者与内置提供者使用同一套预期。

### 固定绑定、运行代际与候选提交不能混用

- `e5ad409`、`d2370dd`：读写回合均需沿用固定 installation/contribution，不能每轮动态选择并写回 provider。升级安装不改绑旧会话；不可用时明确失败，不切换其他 provider 或旧原生执行路径。
- `3eb7e6e`：元数据读取曾重复 open。只有绑定与存活 runtime generation 匹配时复用；关闭、过期或代际变化后必须恢复。测试同时证明“无需重复打开”和“确实需要时能够重开”。
- `b415ac0`：候选提供者初始化失败不能替换已确认绑定。呈现包同样要 ready/preflight 后提交，主题与工作台按同一 release 切换；失败保留上一可用状态。固定会话绑定与通用能力候选选择是两种机制，不互相替代。

### 呈现更换不能改变业务事实

- `27d383a`、`1090d2a`、`a16a738`：默认/外部呈现切换需要恢复语义焦点、消息锚点和仍有效的回答草稿。状态按窗口、工作区、会话、贡献或请求的实际作用域隔离；同名控件或相同文本不能充当完整身份。
- `33dfe69`：真实 Worker 死循环时，宿主审批仍须可见且可操作；恢复快捷键和管理入口不依赖故障 Worker。审批提交重新核对待处理请求与允许决定，旧 token、旧 turn 或伪造请求无效。
- `71d1e42`：长历史曾遮住编辑器和发送入口。布局改动要在真实尺寸检查可见性、滚动、键盘和焦点，不能只断言视觉树有对应节点。
- `0789562`：外部呈现缺少专业阅读能力时须明确降为 core；仍使用完整规范数据及原动作，不能为了适配皮肤丢字段、操作或能力实例。

修改状态或动作桥时，必须保留以下区别：只读迟到结果不能覆盖新选择；写入结果独立跟踪，离开页面不代表取消成功。连续输入仅使用宿主明确许可的本地编辑例外及确认序号，不能借此放宽发送、导航、审批或跨会话动作的 revision 门禁。详见 [呈现包合同](presentation-package.md)。

### 背压、队列、附件与恢复需要验证旧路径

- `4a9ac49`：有界事件队列满时直接失败会中断正常突发流。持久事件应施加背压而不是丢弃；停止时仍能解除阻塞并回收进程。事件持久化与投影顺序必须保持，UI 不能成为唯一历史来源。
- `dd2a458`：持久等待队列开放给标准会话插件，但不能因此推断原生 steering。等待发送、运行中立即发送和结果未知分别处理；未知投递不能自动重发。参见 [消息队列](message-queue.md)。
- `4f0795b`、`469f882` 扩展图片与预览链路：宿主保存并校验附件、绑定草稿/队列/历史身份，能力插件转换原生输入，呈现消费受控预览。新增图片路径时仍需回归纯文本、普通引用、草稿保留、队列删除和历史展示；呈现 Worker 不接收原始图片字节或任意文件读取权限。
- `b941a8e`：成功创建插件会话后未清理旧错误，造成新功能仍像失败。新增错误处理必须覆盖失败后成功、切换上下文及迟到响应，不能让旧错误覆盖当前结果。
- `94bac53`、`eb53191`、`74a4d5f`：终端开发环境不代表桌面包。运行依赖搜索、图标资源和 host SDK 加载需在实际产物验证；相邻源码、完整 shell PATH 或开发依赖不能成为发布运行前提。

## 协商变更的落实顺序

1. 写清生产者、宿主校验/存储/投影、消费者、动作执行者与不应变化的行为；确认能力、权限和 UI 的各自边界。
2. 对照 `contracts/` 与 `packages/plugin-protocol/src/` 定义版本和缺省行为。旧字段的含义保持不变；新增可选字段须让缺失值安全降级，真正不兼容时采用显式版本迁移。
3. 同步 schema、类型、生成验证器（如涉及）、Rust 校验/协商、插件声明/握手/输出、宿主投影和受影响消费者。内部 UiKitAdapter 增项同时更新 runtime proxy 与每个注册皮肤；它不自动成为外部 controls 合同。
4. 逐项验证可用、缺失、拒绝和降级；动作消费端重新校验上下文与授权。菜单数据加载成功后，再验证展示和真实动作闭环。
5. 对照下列回归门槛确认旧路径，再更新对应开发文档和证据。旧验收记录保留原基线，新增验证不能冒充历史结果的重跑。

<a id="regression-gate"></a>
## 改动与新特性的回归门槛

每次实现改动都要明确“新增/改变什么”和“哪些既有行为必须保持”。根据共享路径选择回归，不能以“没有编辑该文件”为由排除消费者。以下矩阵是最小选取依据；多行命中时取并集，不必运行与改动无关的全部付费模型探针。

| 改动入口 | 必须保留的相邻行为 | 现有回归入口（按需补充缺失场景） |
| --- | --- | --- |
| 能力、菜单、模式、模型协商 | 无此能力的会话正常使用；第三方与内置一致；旧 release、忙碌/归档门禁；模型/模式变化不丢历史和其他选择 | `test/session-capability-ui.test.mjs`、`test/agent-command-menu.test.mjs`、`test/model-catalog-navigation.test.mjs`、`test/model-configuration.test.mjs`、`test/composer-access-options.test.mjs`；`probes/plugin-command-menu-browser.mjs` |
| Broker、执行配置、会话生命周期 | 只读/写入准入、拒绝/取消、固定绑定、热复用/重启恢复；其他 provider 的原有回合 | `src-tauri/src/session_host_tests.rs` 及对应 Broker/执行配置 Rust 测试；`test/session-capability-providers.test.mjs`、`test/pi-capability-workflow.test.mjs`、`test/approval-routing.test.mjs` |
| 事件投影、队列、目标、子 Agent | 主回合唯一终态；历史重载、重复/迟到事件、FIFO/steering 区别、暂停/uncertain、普通对话与草稿不被消费 | `test/message-queue.test.mjs`、`test/session-goal.test.mjs`、`test/subagent-workflow.test.mjs`、`test/presentation-timeline.test.mjs` 及相应原生持久化测试 |
| 呈现/UiKit/共享工作台、动作桥 | 默认 ak-ui 浅/深主题与受影响的外部呈现一致保留业务；未覆盖 surface 继承；core 降级、草稿/焦点/锚点、过期动作、故障中审批/恢复可达 | `test/renderer-negotiation.test.mjs`、`test/presentation-package-controller.test.mjs`、`test/presentation-view-state.test.mjs`、`test/presentation-conversation.test.mjs`；`probes/presentation-full-skins-browser.mjs`、受影响 surface 探针 |
| 输入、附件、建议列表 | 纯文本/图片/引用、输入法与快捷键、长列表/长历史可用；草稿、队列、历史附件相互隔离 | `test/message-draft-ownership.test.mjs`、`test/clipboard-images.test.mjs`、`test/attachment-previews.test.mjs`、`test/presentation-suggestions.test.mjs`；`probes/composer-input-browser.mjs`、`probes/composer-paste-browser.mjs` |
| 安装、SDK、打包、升级 | 启用/禁用/卸载、旧 release 绑定、失败候选回滚、缺依赖、损坏资源、桌面启动与宿主 SDK 装载 | `test/plugin-management.test.mjs`、`test/host-sdk.test.mjs`、`test/external-plugin-build.test.mjs`、`test/presentation-build.test.mjs`；相关安装/原生桌面探针 |
| 共享 workspace/导航/设置/Git 状态 | 切换会话/工作区不串数据；设置继承和并发冲突；仓库选择不改变会话绑定；默认与外部工作台同步 | `test/session-navigation.test.mjs`、`test/session-lifecycle-navigation.test.mjs`、`probes/session-lifecycle-browser.mjs`、`test/agent-settings.test.mjs`、`test/git-repositories.test.mjs`、`test/presentation-navigation.test.mjs`、`test/presentation-git.test.mjs` |

执行要求：

1. 修复缺陷时优先加入能复现原故障的回归；新特性同时覆盖成功、拒绝/缺失及至少一条共享路径上的旧行为。测试断言外部可观察结果，不能只匹配实现字符串或证明新字段存在。
2. 运行根目录要求的 `pnpm run verify`，覆盖架构、类型、Node 测试与构建。对原生执行/持久化变更，另运行相关 `cargo test --manifest-path src-tauri/Cargo.toml --lib <filter>`；跨模块生命周期或数据库迁移需运行完整 `--lib` 测试。
3. UI 或呈现桥变化另跑实际 App/浏览器探针，覆盖内置 ak-ui 的浅/深主题，以及受影响的外部工作台/控件/语义 surface。未声明 surface 的继承与故障回退也是功能；仅默认 kit 通过不代表外部包通过。
4. 真实 CLI/原生 IPC/桌面安装受影响时，用隔离数据和临时工作区验证；浏览器替身 IPC 不能证明原生授权、持久化或 OS 行为。仅文档修改执行根目录 verify 并检查引用，无需启动无关原生或浏览器探针。
5. 对失败先确认是本次引入、原有失败还是环境阻塞，保留证据并修复本次引入的回归；不能删除旧用例、降低断言或修改基线掩盖变化。预期行为确实改变时，同步合同、迁移说明及新旧兼容用例。
6. 交付时列出变更行为、受保护的旧行为、实际命令/结果、证据层级和未覆盖边界。测试未执行或失败原因未解释时，不能声称“无回归”或“完整验收通过”。

这些要求让回归结论可核查，不保证有限测试能证明所有功能绝对无故障。新增边界或共享路径时应同步补充对应回归入口。
