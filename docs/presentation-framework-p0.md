# 框架无关呈现 P0：原型、现状矩阵与接入门槛

日期：2026-09-22。对应[目标规格](presentation-framework-agnostic.md)。
状态：第一轮及真实 Tauri 集成实验已记录；P0 总体未通过，未进入生产 DOM 加载实现。
第二轮的阻断项、动作策略与决策建议见 [门槛评审](presentation-framework-p0-gates.md)。
本文下述数据保留第一轮口径，新增结果不覆盖旧证据。

## 实验结论

1. React 与 Svelte 可以直接管理自己的 DOM，并消费相同宿主快照与动作目录。
   原型使用现有 `createConversationDirectory`，框架切换保留宿主草稿。
2. 本机 WKWebView 中，iframe 内 DOM 死循环阻塞了宿主页面。该方案不满足
   当前审批/恢复可用性要求，不能直接替换现有 Worker 沙箱。
3. 独立、非持久化 WKWebView 的实验中，插件循环期间宿主心跳继续，宿主确认按钮
   接受 macOS AXPress 输入并产生一次模拟发送，随后可移除故障视图并挂载新视图。
   这是候选容器的局部证据，不是独立进程保证或生产故障终止验收。
4. 在真实 Aibo/Tauri 探针中，无匹配 capability 的测试 WebView 仍成功调用
   `list_workspaces`。新 DOM 容器必须有显式应用命令准入或完全不暴露通用 Tauri
   桥；仅省略 capability 不能作为隔离依据。当前 Worker 包不能直接调用该桥，
   此实验不表示现有外部 Worker 获得了 IPC 权限。
5. 有效 token 和插件自报 `isTrusted` 不能证明用户意图。原型中的发送只创建
   宿主确认请求，确认时重验目标状态；伪造确认、合成宿主 click、旧 revision、
   旧代际和挂起期间的请求不产生模拟发送。完整动作策略仍未实现。

因此保留旧加载路径，继续验证“原生独立容器 + 宿主动作准入”的方向。
本轮不接受最终运行容器 ADR，也不把其他平台或完整功能标记为支持。

## 可复现来源与证据

原型保存在独立分支 `prototype/presentation-dom-p0`，提交
`5aea830adbbfef78583b01cc569b7722143e8f15`。该分支的
`probes/presentation-dom-prototype/README.md` 提供构建和运行步骤。
主分支只保留审计结论和证据，不把试验宿主作为可安装插件发布。

可在独立工作树查看、重跑原型，避免切换当前开发内容：

```sh
git worktree add /tmp/aibo-dom-p0-review prototype/presentation-dom-p0
cd /tmp/aibo-dom-p0-review
pnpm install --frozen-lockfile
npm ci --prefix probes/presentation-dom-prototype --ignore-scripts
npm --prefix probes/presentation-dom-prototype run probe:browser
npm --prefix probes/presentation-dom-prototype run probe:native
npm --prefix probes/presentation-dom-prototype run probe:ipc
```

| 证据 | 实际覆盖 | 不代表什么 |
| --- | --- | --- |
| [浏览器](baselines/presentation-dom-p0/browser-result.json) | Chromium 153，真实 React/Svelte DOM、草稿与 token 目录、可信浏览器点击及拒绝路径 | 不含原生 IPC、CPU 隔离、完整组件库/工作台 |
| [原生 iframe](baselines/presentation-dom-p0/native-iframe.json) | macOS arm64 WKWebView，正常交互后触发 DOM 死循环，宿主不再响应 | 负面结果；不能算故障恢复通过 |
| [原生独立视图](baselines/presentation-dom-p0/native-webview.json) | 相同脚本与状态；循环中 AXPress 确认、宿主心跳、重新挂载 | 模拟发送；不是 Aibo 真实待审批请求、硬件输入或资源回收保证 |
| [Tauri IPC](baselines/presentation-dom-p0/tauri-ipc.json) | 独立应用标识、无匹配 capability、真实只读应用命令、空工作区列表 | 不接触用户 Aibo 数据；未尝试写命令，不代表允许生产 DOM 安装 |
| [构建](baselines/presentation-dom-p0/build.json)与[源文件摘要](baselines/presentation-dom-p0/source.json) | 固定 React 19.2.0、现有 Svelte 5.57.0、原型源码对应关系 | 原型借用仓库依赖/动作目录，未完成仓库外 SDK 独立交付 |

原生记录中的 `nativeAccessibilityConfirmations` 是 macOS AXPress 次数；
`physicalInputVerified: false` 明确表示未使用硬件鼠标/键盘。
最初在执行沙箱内探测到 AX 不可用；获准启动独立原生进程后 AX 可用，最终记录
来自后者。沙箱内浏览器/原生启动失败不计为产品故障或正式容器结果。

WKWebView 消息处理器还需要核对 `frameInfo.isMainFrame`：子 frame 可能看到
同一个 WebView 的处理器。原型同时核对原生 WebView 实例身份和主 frame 来源。
生产实现还需作用域、代际、资源和原生授权；不能复制这个小型原型当完整桥。

## 当前功能与改造影响矩阵

以下是代码盘点，不等于重新验收所有现有功能。所有 DOM 呈现消费者都待实现。
现有外部工作台数据在 [App.svelte](../src/App.svelte) 组装，经
[PresentationHost](../src/lib/ui-kit/PresentationHost.svelte) 交付 Worker。

| 区域 | 生产者、投影与动作执行者 | 当前公共合同/消费者 | DOM 迁移缺口及须保留行为 |
| --- | --- | --- | --- |
| 导航、工作区、会话 | navigation/workspace/session 控制器 → App externalNavigation → externalNavigationIntent | presentation-navigation.ts、navigation.ts、外部 navigation.js | 数据/动作已有；拆出 Svelte 无关投影，保留搜索/改名草稿、信任及归档校验 |
| 消息、Composer、发送/停止 | 会话状态与草稿控制器 → externalConversation → sendPrompt/abortPrompt | presentation-conversation.ts、conversation.ts、conversation.js/timeline.js | 数据已有；新增结果关联和可信请求准入，不改变会话绑定 |
| 队列、steering | message-queue 与会话能力 → conversation → queue/managePromptQueue | 同上 | 数据/动作已有；保留 FIFO、uncertain、不支持 steering 的降级和宿主持久化 |
| 回答草稿/用户问题 | user-input-drafts/storage → conversation → submit/cancelAnswers | 同上 | 保留 session/request/question/turn 身份及重载规则，不能由插件构造待答请求 |
| 图片、路径、会话引用 | 宿主附件/引用读取 → conversation + 受控预览 → 当前宿主服务 | 同上与 sandbox.ts 的附件桥 | DOM 会看到所呈现的图片；需作用域化服务，不沿用 Worker 不接触图片数据的承诺 |
| 模型、推理、Fast、上下文、模式 | model/configuration 与执行配置 → conversation → applySession* | 同上 | 数据/动作已有；必须保留协商、拒绝、忙碌与未知当前选项行为 |
| 目标、用量 | session-goal/usage → conversation → changeGoal | 同上 | 数据/动作已有；展示状态不等于执行权，不因外观重挂载继续目标 |
| 子 Agent 卡片与详情 | 宿主 timeline/subagents/history → conversation；openSubagent | 卡片与打开动作已有；详情 entries/loading/error 保留在 App 和 SubagentDetails | 若详情也由新外观控制，需新增宿主持有的详情快照/动作，不能复制私有状态 |
| 历史、分支、会话树 | session history/tree → conversation → loadOlder/fork/tree navigation | 树、历史条目和动作已有 | 原生操作确认保留；专业树布局及完整历史浏览状态需逐项映射，不能只按简化列表判等价 |
| Git、多仓库、差异 | workspace 控制器 + workbench drafts → externalGit → externalGitIntent | presentation-git.ts、git.ts、git.js | 数据/动作已有；保留仓库作用域、diff 截断、提交草稿及原生写复核 |
| Inspector、产物、检查点 | 宿主预览/变更集 → externalInspector → inspectorIntent | presentation-inspector.ts、inspector.ts、inspector.js | 数据/动作已有；读取晚到不能覆盖新选择，写结果由宿主追踪 |
| 工程动作编辑与运行 | project-editor/task 控制器 → inspector → 当前执行入口 | 同上 | 保留编辑 generation、保存草稿、取消/未知结果，不向 DOM 授予任意命令 |
| 能力工作台 | installed-workbench-controller → externalCapability → act/reload | presentation-capability.ts、capability-workbench.ts | 保留实例生命周期和完整 core snapshot；专业视图缺失明确降级 |
| 布局、焦点、消息位置 | presentation/workbench 状态 → layout 与 view-state | presentation-layout.ts、layout.ts、view-state/default-focus/default-scroll | 当前部分恢复依赖节点 key；DOM SDK 需语义焦点/锚点、缺失降级、宿主优先焦点 |
| 主题、安装、更新与恢复 | presentation-package-controller + 原生 presentation_packages | presentation-package.ts、package.ts、sandbox.ts | 新版本/运行时合同未有；旧包解释、原子激活、故障回退必须不变 |
| 管理、审批、通知与设置 | 可信 App/UI kit + 原生执行者 | 在可替换 PresentationHost 之外 | 保留在宿主；DOM 视图不能获得其 IPC 或覆盖其层级，暂停不能只依赖插件自觉 |

公共数据包现为纯数据，但 `PresentationInput.data` 仍是通用 JsonValue；完整
工作台投影和意图分派仍耦合在 App.svelte。P1 需要明确版本化工作台 envelope、
状态投影模块及动作结果通道，不能仅把当前 JSON 复制成第二份框架 store。

## 原型中的动作策略及未覆盖项

| 类别 | 本轮验证 | 生产要求 |
| --- | --- | --- |
| 本地 draft 编辑 | 现有目录重验 + 编辑序号，保留框架切换状态 | 补齐所有许可输入、IME、流式并发、长度/速率与重同步 |
| 模拟发送 | 插件只能提请求；宿主 trusted click/AXPress 确认；复核 revision、草稿及可用性 | 接入实际发送与审批，原子绑定完整参数，处理重复/未知结果 |
| 读取、Git、文件、剪贴板、链接 | 原型不提供；尝试通用 invoke/confirm 被拒绝 | 逐项审计现有动作目录，不让原生 Tauri 桥绕过专用 SDK |
| 失控和挂起 | 浏览器挂起拒绝；独立 WKWebView 循环期间确认可用 | App 层强制挂起、焦点/遮挡、洪泛、内存、崩溃及强制终止未验收 |

确认机制有明确交互成本：原型每次模拟发送多一次宿主确认。这里仅验证授权可行性，
尚未把这种交互定为产品默认行为。后续必须验证可接受的可信交互方案，不能用
插件自报手势消除确认，也不能以原型额外确认掩盖产品体验退化。

## 性能与资源范围

当前仅有单消息、小草稿 fixture 的首次挂载测量，设备/系统见原生结果。
React bundle 约 194 KB，Svelte bundle 约 53 KB（未压缩传输前的 minified JS 字节）。
这不是完整工作台体积；不能从一次几十毫秒挂载推断长历史或生产预算通过。

P0 余下需固定同一设备和数据集：至少 1,000 条消息、长文本、图片、持续更新和
反复切换；记录 p50/p95 输入到显示延迟、峰值内存、释放后内存与故障响应。
建议待实测确认的门槛：首次挂载 p95 ≤ 1 s、确认后的输入显示 p95 ≤ 100 ms、
故障发现/可恢复入口响应 ≤ 5 s。内存与消息上限必须依据实际容器实验定值，
不能把宿主仍有心跳当成回收了死循环子进程。

## P0 剩余门槛与下一步

1. 在真实 Aibo 容器实现并验证应用 IPC 默认拒绝：宿主正常访问、DOM 仅专用桥、
   未注册/旧代际视图拒绝，覆盖应用命令和 core/plugin 命令。不能只隐藏 JS 对象。
2. 集成候选原生视图的布局、焦点、窗口缩放和实际待审批/恢复入口；验证宿主能
   强制暂停交互，并保留全部既有 Worker 路径。
3. 为完整动作目录定义可信交互、请求确认与执行策略，验证真实授权和结果绑定。
4. 完成资源/消息压力、故障进程终止及量化基线；限定已验证平台，记录其他平台未知。
5. 门槛满足后记录运行容器 ADR，才启动 P1 公共 SDK 与 P2 生产加载链路。

## 参考依据

交付检查：`pnpm run verify` 通过（33 项架构检查、TypeScript、346 项 Node 测试、
Vite 构建）；构建保留动态/静态混合导入与大 chunk 提示。文档本地链接和原型归档
源码 SHA-256 核对通过。本轮没有修改生产 Rust/JS 行为；原生证据分别来自独立
WKWebView 和真实 Tauri 只读探针，不将其描述为完整原生回归或 P0 总体验收通过。

- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)：应用自定义命令默认行为与 capability 范围；本轮另外做了真实 IPC 实验。
- [ADR-0009](adr/0009-presentation-package-isolation.md)：现有 Worker 选择及宿主可用性要求。
- [宿主与插件回归规范](plugin-boundaries-and-regression.md)：新旧呈现、审批/恢复和原生证据门槛。
