# Presentation 包合同 v1

本合同已接入 App 安装、隔离执行与故障恢复。独立 shadcn / Material 3 呈现包及共享工作台
的历史交付基线见[交付说明](presentation-release-0.3.0.md)，实现与验收边界见
[退出审计](presentation-plugin-exit-audit.md)。阶段过程另见[重构记录](presentation-plugin-refactor.md)。

包根目录使用 `presentation.json`。主题、控件和整窗呈现使用同一 manifest，
同一插件 ID 的不同版本是不同 release。独立于现有能力包的 `plugin.json`，
不能通过能力包旧 presentation 声明绕过新安装与验证流程。

```json
{
  "schema": "aibo.presentation-package/v1",
  "id": "dev.example.ocean",
  "version": "1.0.0",
  "displayName": "Ocean",
  "hostApi": "1.0.0",
  "coreSemantics": "1.0.0",
  "snapshotSchemas": ["aibo.semantic-view/v1"],
  "resources": [],
  "themes": [{
    "id": "ocean",
    "label": "Ocean",
    "colorScheme": "dark",
    "tokens": { "--primary": "#4a80cc" }
  }],
  "defaultThemeId": "ocean"
}
```

## 版本与身份

| 字段 | 含义 |
| --- | --- |
| schema | manifest 格式；当前只接受 v1 |
| id | 稳定插件身份，小写点号或连字符分段 |
| version | release 版本，当前采用三段非负整数，拒绝前导零 |
| hostApi | 外部呈现消息桥接口版本，当前精确 1.0.0 |
| coreSemantics | 必须保留的业务信息结构，当前精确 1.0.0 |
| snapshotSchemas | 显式可读快照格式；必须包含稳定 v1，不能从语义版本推断 v1.1 写动作支持 |

包的完整性身份还包含原始 manifest 与全部声明资源的摘要；同 ID/版本不同内容
不得覆盖已有 release。manifest 字段不授予文件、网络或执行权限。

## 可选定制与默认继承

| 声明 | 行为 |
| --- | --- |
| themes | 宿主默认主题上的 token 覆盖；未提供的 token 保留默认值 |
| entry | 自包含 Worker JavaScript bundle，路径必须对应声明为 text/javascript 的资源 |
| surfaces: controls | 使用宿主控件消息合同定制视觉；未处理控件使用默认实现 |
| surfaces: semantic | 实现核心 collection/detail/settings/inspector；缺失必需语义拒绝激活 |
| surfaces: workbench | 使用宿主快照和动作组织整个工作台；管理、审批、恢复区域留在宿主 |

entry 与 surfaces 必须同时提供，themes 与 defaultThemeId 同样成对。
包至少提供 themes 或 entry。不提供某个 surface 时继承宿主实现；声明提供后
初始化失败不能静默标为成功，必须触发恢复。主题与可执行角色共同激活，不能
出现候选主题已生效、旧工作台仍被视为新 release 的半提交状态。

## 资源与校验

resources 中每个条目声明 path、sha256、bytes 和 mediaType。
支持 JavaScript、CSS、PNG、WebP、WOFF2。entry 不使用远程 import；构建工具
必须产出自包含 bundle，资源由宿主提供。未在清单中的文件不提供给呈现。

资源路径只允许字母、数字、下划线、连字符、目录分隔符和最后一个扩展名，
拒绝绝对路径、点目录、编码路径和反斜线。大小写折叠后不可重复；原生安装器
还必须拒绝符号链接及任何解析后逃出包目录的文件。

manifest 最大 128 KiB，最多 128 个资源、单个资源最大 8 MiB、资源总量最大
32 MiB。安装和重新加载都验证实际长度与 SHA-256，不根据文件名或缓存记录
假定文件仍可信。原生读取应在分配内存前应用同样的限制。

主题值允许基本数字、颜色和 CSS 数学/颜色表达式；拒绝 URL、CSS 声明分隔符、
注释、转义和资源获取函数。token 应按宿主语义使用；样式资源只进入隔离呈现，
不能覆盖宿主固定区域。

## 执行与恢复

隔离决策见 [ADR-0009](adr/0009-presentation-package-isolation.md)。宿主验证包后，
创建新的隔离呈现代际，通过 ready/preflight 确认兼容后提交选择。消息必须校验
来源、代际、工作区/会话上下文和动作权限；不接受任意 Tauri 命令名称。

包缺失、校验失败、不兼容、初始化超时和执行故障都需要实际 App 验证。
本合同文档不代替消息桥实现、安装事务或沙箱逃逸与可用性探针。

## 可执行入口

包代码运行于 Worker，定义 `self.aiboPresentation.render(input)`，同步或异步返回
`PresentationNode`。输入与视觉树类型从 `@aibo/plugin-protocol` 导出，不需要 DOM
类型。下面的语义呈现入口只绑定输入中的宿主动作：

```js
self.aiboPresentation = {
  render(input) {
    const action = input.data.actions?.[0];
    if (!action) return { tag: 'span', key: 'empty', text: '暂无可用动作' };
    return {
      tag: 'button', key: 'primary-action', text: action.label,
      className: 'toolbar-button', events: { click: action.token }
    };
  }
};
```

input 包含 surface、宿主 context（workspaceId/sessionId/revision）、data 和主题
token。渲染函数不能直接调用业务操作：宿主绘制桥仅从真实用户事件构造 intent，
主宿主再次匹配上下文并按业务权限执行。插件伪造 Worker intent 消息不会被转发。

节点 key 在一棵树内唯一，稳定 key 用于恢复焦点、光标与滚动位置。节点只能使用
已声明的标签、属性和事件；不允许 script、iframe、任意 on* 属性或 href/src URL。
图片使用 `resource` 指向包内 PNG/WebP；SVG 图标使用受限 svg/path 等节点。
CSS 字体或图片地址可写 `url("aibo-resource:font.woff2")`，宿主只替换已验证资源。

候选 iframe 在首棵有效树绘制前隐藏，activate 前禁止 intent。初始化与更新
具有超时，Worker 心跳发现运行中失控后终止 Worker 并移除 frame。宿主销毁旧
实例时关闭 MessagePort、移除文档并释放 Worker URL。输入 revision 必须递增，
旧树上的迟到用户事件不会获得新上下文权限。

宿主可将明确的本地编辑动作（当前为工作台 draft）加入 localInputActions。
这类 input 事件在同一工作区/会话内允许跨快照 revision，防止流式或草稿快照
更新丢弃连续打字；它不放宽导航、发送、停止或跨会话动作的校验。绘制桥为本地
输入生成 editSequence，宿主快照回传确认序号，较旧渲染结果不得覆盖尚未确认的
文本和光标。可执行包不能自行把动作加入此宿主许可列表。

Ctrl/Command+Shift+Backspace 是宿主保留的恢复快捷键。固定绘制桥在 iframe
捕获真实按键并发送恢复消息，因此焦点在外部输入框时也能恢复内置呈现；该消息
不经过包 Worker 的事件处理。

## 独立语义呈现与本地交互

声明 semantic 角色的包在选择前用 collection、detail、settings、inspector 四类
有效快照预检；预检是可运行性检查，不能证明任意插件都完整展示了每个字段。
实际输入的 `data.snapshot` 保留经过校验的完整核心快照；`data.actions` 提供
宿主生成的短 token、标签和原动作身份。视图使用 token 绑定真实 click，宿主按
当前快照重新解析并校验，插件不能自行构造能力调用或更改动作输入。

未声明支持的快照格式、渲染异常或超时会销毁该语义实例，使用同一份 props 恢复
默认 SemanticView。语义角色继承宿主工作台，不要求包同时实现整窗呈现。

`localEvents` 用于纯呈现交互，与发给宿主的 `events` 分开。同一个节点的同一种
事件不能同时属于两者。宿主绘制桥只将真实本地事件送到 Worker 的
`self.aiboPresentation.handle(event, input)`，处理后调用 render 更新视图；本地
事件不会转成业务动作。Worker 可以持有筛选、展开等临时状态；需要跨插件切换或
重启恢复的状态仍需宿主状态合同，不能依赖 Worker 全局变量持久化。

`PresentationNode.primaryEnter` 可在 textarea 上绑定现有宿主 click token，提供
⌘/Ctrl+Enter 操作。可信桥只接受真实、非输入法组合、非自动重复的按键；普通
Enter 保持换行。禁用/只读输入框不触发，不能同时声明 keydown 事件。生成的意图
仍受宿主当前动作目录和严格版本门禁控制，不授予新的业务能力。

## 独立控件呈现

声明 controls 角色后，宿主以 `surface: 'controls'` 调用同一个入口。当前公开目录
包含 ModelMatrix 和 AgentStatusMark，纯数据联合类型为
`PresentationControlData`；其他内部 UiKitAdapter 控件继续继承默认实现。
`data.control` 标识控件，`data.props` 包含完整展示数据，业务回调不会交付 Worker。
模型选择通过 `data.actions` 的宿主 token 绑定 click，宿主重新检查当前可用选项
及 disabled 状态后执行。ModelMatrix actions 按 `kind: model | serviceTier` 区分，
不能把服务层级动作当作模型选择；`props.fastTier` 为 null 时不画 Fast 控件。
完整参数语义与上下文选择见[模型配置](model-configuration.md)。

AgentStatusMark 仅提供展示，没有业务动作。消费可选 `props.icon: { path }`，
在 24 × 24 viewBox 内用受限 svg/path 节点和 currentColor 绘制；缺失可用通用图标或文本。
保留宿主 label 作为文字或可访问名称，不根据兼容字段 `agent` 硬编码品牌图标。
精确 props/actions 类型见 [presentation-controls.ts](../packages/plugin-protocol/src/presentation-controls.ts)。
AgentSettingsForm、ModelContextSelect、GoalBar、SubagentCard、SubagentDialog 均为内部控件，
未加入外部 controls 目录，不能通过声明同名控件取得其接口。

控件 render 可以返回 null，表示继承该控件的完整默认实现；这是 controls 专属
协议，semantic/workbench 仍须返回有效视觉树。宿主在候选提交前预检两个目录项，
运行时异常或超时也恢复同一份 props 的默认控件。继承实例继续接收数据更新，
后续 render 可以提供定制。

控件替换仅在 PresentationHost 的工作台上下文内生效。宿主管理与审批区域不消费
外部控件。状态标记的可访问名称由宿主 props 提供，其 iframe 不进入 Tab 顺序，
也不截获父行的点击。当前每个控件独立运行实例；大型列表的资源开销仍需后续验收。

## 工作台导航

工作台输入新增 `data.navigation: PresentationNavigation` 和
`data.navigationActions: PresentationNavigationAction[]`。前者包含全部已加载工作区
及其会话、展开/加载状态、搜索/筛选、创建入口、改名草稿和忙碌状态；不会只交付
当前工作区的简化会话列表。原首批顶层字段暂时保留兼容。

创建候选来自 `data.navigation.agentChoices ?? []`，每项为 `{id, label, icon?}`。
使用 navigationActions 中同时匹配 `operation === 'createAgent'`、`targetId === workspace.id`
和 `choiceId === choice.id` 的 token；候选为空或动作缺失时不提供执行入口。
旧 createCodex/createPi 动作已移除，不根据品牌补造入口，也不解析 choice ID。
类型见 [presentation-navigation.ts](../packages/plugin-protocol/src/presentation-navigation.ts)。

操作目录的 operation 表达用途，targetId 表达宿主选定的目标，token 用于绑定指定
事件。目录覆盖导航、创建会话、信任/移除/打开工作区、搜索筛选、改名、归档与
取消归档。宿主在收到事件时重新生成当前目录，拒绝已移除、运行中不可归档、
忙碌、错误事件类型、非法筛选值及过期上下文；插件不能借 token 提交任意参数。
改名输入上限为 120 字符。执行仍调用既有业务控制器及其权限/确认流程。

搜索和改名是宿主明确许可的本地输入。绘制桥随快照更新许可清单，并使用和草稿
相同的编辑确认机制，避免连续输入被旧树覆盖。改名 token 包含目标会话身份；
结束或切换改名后，旧输入不再匹配当前目录。点击、筛选和跨会话输入仍受 revision
与上下文校验。

应用通知、归档确认和 Pi 分支导航确认固定在 PresentationHost 之外，使用可信
默认控件。确认期间暂停工作台动作；皮肤不能覆盖或自行批准这些宿主流程。
会话内容/Composer、Inspector/Git 及能力工作台分别使用下文的数据与动作合同；
导航目录本身不构成整窗功能等价验收。

## 工作台会话与 Composer

`data.conversation: PresentationConversation` 提供完整时间线元数据、目标、用量、
重试信息、队列、运行状态、附件、执行配置、模型目录、路径与命令建议，以及当前
会话的用户问题、回答草稿和会话树。`data.conversationActions` 是宿主生成的操作
目录，覆盖 Composer、发送/停止/重试、队列、附件、模型与访问模式、压缩、分支、
用户回答和会话树操作。原首批顶层 draft/timeline 字段暂保留兼容。

token 是不透明句柄，插件按 operation 和 args 选择控件，不解析或自行拼接 token。
args 是宿主已选定的目标和选项；点击携带的 value 不能替换模型、路径或回答选项。
宿主按当前状态再次计算可用操作，拒绝不存在的模型级别、已消费附件、未绑定的
历史会话操作、运行中不可用操作及迟到点击。可选队列、模型推理、分支、压缩和
会话树操作分别受会话能力约束。底层业务控制器和原生权限校验继续执行。

本地输入只允许目录明确声明的 draft/answer。目录只保留当前条目，移除再出现的
操作获取新 token；切换会话也重新分配 token，因此回到同一会话不恢复旧输入权限。
用户问题操作还绑定 turnId，避免相同 requestId 在后续轮次复用时接收旧回答。

回答草稿键为 `JSON.stringify([sessionId, requestId, questionId, turnId])`。
默认 TimelinePanel 和外部呈现共用宿主草稿：切换皮肤不清空，提交失败继续保留，
请求结束后清理。回答草稿按窗口持久化，重载时仅为身份匹配的实时请求恢复，
不会重建 Agent 待答请求。只有当前问题的草稿交付当前呈现。确认和审批仍位于固定宿主区域。

### 会话专项消费规则

- 模式/权限菜单读取 `executionProfile.sessionControls`，选择绑定 `selectAccess` 的 control ID，
  不使用旧 accessModes 或自行构造 profile；权限归属见[会话控件](session-controls.md)。
- 模型目录与 selectServiceTier/selectContextWindow 动作见[模型配置](model-configuration.md)。
  上下文选择绑定 change 事件，提交字符串 ID；其他点击动作的 value 不能替换宿主参数。
- 目标使用 conversation.goal / goalBusy，区分目标状态与 running，绑定 clearGoal/pauseGoal/resumeGoal；
  不自行恢复 budgetLimited 目标，见[目标生命周期](goal-lifecycle.md)。
- timeline 的 `toolName === 'subagent'` 内容经校验后展示独立任务卡，失败保留可读降级；
  使用 openSubagent 与 child.id 对应的宿主 token 打开详情，不直接调用历史 IPC，见[子 Agent 历史](subagent-history.md)。
- 队列优先使用可选 items/paused/revision，旧快照可显示 steering/followUp 文本，但不能合成条目 ID。
  removeQueuedMessage/sendQueuedMessage 绑定 item.id，sending 项无单条操作，uncertain 不提供立即发送且阻止 resumeQueue。
  运行中立即发送另需 queue.steer，等待队列和附件归属见[消息队列](message-queue.md)。

以上状态用于展示，执行入口仍只来自当前动作目录；切换呈现不重置队列、历史或草稿。
完整数据与动作枚举见 [presentation-conversation.ts](../packages/plugin-protocol/src/presentation-conversation.ts)。

## 工作台 Git

`data.git: PresentationGit` 提供工作区状态、文件标志、分支、历史分页、提交文件分页、
远端/暂存栈、加载/错误/忙碌状态以及完整差异预览。预览保留 hunks、truncated、
reason 与提交上下文，不把裁剪结果描述为完整差异。`data.gitActions` 通过同一
不透明句柄机制提供面板切换、读取、暂存、提交、分支、同步和暂存栈操作。
历史默认展示最近 16 条；`historyHasMore`、`historyLoadingMore` 与
`historyLoadMoreError` 告知呈现是否提供、正在执行或需要重试 `loadMoreHistory`。
这些字段对旧呈现可选；新操作由宿主按当前工作区和仓库重新校验。

文件、暂存侧、分支、历史提交及暂存栈引用均由当前宿主数据绑定。宿主重新核对
工作区、信任、忙碌状态和当前目标后调用既有工作区控制器；插件的事件 value
不能替换写操作参数。提交信息和新分支名先作为宿主草稿编辑，提交/创建动作绑定
当时的草稿值，修改草稿会撤销之前的提交句柄。原生写入审批与仓库状态复核保持
原有流程，前端目录检查不能替代原生检查。

默认 Git 面板与外部皮肤使用同一份 `PresentationGitDrafts`，按窗口/工作区保存
提交信息、分支名、历史分区与选中提交。失败保留草稿，成功只清除仍对应提交值的
草稿。切换皮肤不另外创建 Git 编辑状态。Inspector 的工程动作/产物/检查点使用
下文的独立合同，Git 投影不代替它们。

## 工作台 Inspector

`data.inspector: PresentationInspector` 交付工作区能力、诊断、线程、执行配置、
附件、产物、工程动作和运行记录、完整变更集、检查点、恢复记录及文件差异。
`data.inspectorActions` 支持读取产物、刷新、文件/hunk 暂存和还原、整轮恢复，
以及下文的工程动作编辑与执行。可用操作由宿主当前状态决定。

操作绑定当前会话、轮次、文件路径和 hunk 序号；宿主按当前目录重新核对，不接收
包自行构造的写入参数。整轮恢复要求 agent 归属，整文件还原拒绝 baselineDirty，
重命名文件不提供 hunk 操作，写操作另受工作区信任、运行/归档/忙碌状态约束。
原生审批、检查点和文件内容冲突复核继续决定是否实际执行。

产物预览由宿主持有，包含加载、内容截断和错误状态。切换皮肤不会取消读取或
丢失预览；关闭、切换会话、移除产物后旧结果不可恢复预览。读取失败可重试。
会话差异读取也校验当前轮次和请求代际，旧会话或旧轮次的迟到结果不交给当前
皮肤。预览目前只保留在窗口内存中，未承诺跨应用重启恢复。

### 工程动作编辑与执行

Inspector 的 `projectEditor` 和 `runningActionId` 由宿主持有。编辑器按工作区保存
窗口内草稿，默认面板和外部皮肤共用新增、编辑、字段修改、保存及关闭入口。
字段只允许 name/kind/program/args/cwd；参数支持逐行 argv 或 JSON 字符串数组，
不把参数拼接为 shell 命令。编辑已有动作保留 enabled 值。

保存失败保留草稿和错误，保存成功关闭对应工作区的编辑器。保存期间禁止重复
提交和字段修改；切换工作区不让迟到保存结果覆盖另一工作区的草稿或动作列表。
每次开始编辑分配新 generation，旧字段输入不能修改新的编辑对象。保存句柄
绑定完整当前草稿，修改任意字段后撤销旧保存句柄。

运行只为当前可信工作区的已启用动作提供，取消只绑定当前工作区仍在运行或待
批准的记录。执行仍进入已有 project-task-controller 和原生审批流程，Presentation
包不能指定任意 actionId/runId 或跳过批准。工程动作草稿目前不持久化磁盘，
不提供跨应用重启的工程动作草稿恢复。

## 已安装能力工作台

`data.capability` 包含可用能力视图目录、当前贡献与作用域、完整语义快照、错误、
布局、阅读方式和恢复状态。`data.capabilityActions` 提供打开/关闭/重新加载、
布局/阅读切换，以及宿主构造的语义动作。不透明动作绑定原快照 context、条目和
动作身份；旧快照、不可用贡献、恢复中的动作及任意替换参数均不会执行。

能力视图的 open/act/write/release 生命周期由宿主控制器持有。更换 Presentation
不会重新打开能力视图、释放其 generation 或重置当前详情；默认视图只是状态的
消费者。显式关闭或切换贡献才释放，重新打开沿用既有选择/详情/分页/布局恢复。
写动作继续走 InstalledController 的原生审批、未知结果处理和刷新流程。

工作台包也必须声明支持其接收的 semantic snapshotSchemas。候选选择时若当前
能力视图格式不受支持，准备失败并保留当前呈现；运行中遇到未声明格式，宿主
不向包交付该快照，并恢复默认呈现，能力实例本身继续存在。

## 独立打包工具

`packages/presentation-tools` 可打包为本地 npm tarball，在仓库外使用 Node.js CLI：

```sh
node /path/to/package/build.mjs presentation.source.json dist/skin-1.0.0
```

源 manifest 的资源列表提供路径和媒体类型，工具读取实际字节并生成大小与 SHA-256，
输出正式 `presentation.json`。与宿主共用校验实现，拒绝无效格式和主题、路径穿越、
符号链接资源及已有输出目录。完整用法见 [工具说明](../packages/presentation-tools/README.md)。
纯主题样例见 [Ocean 源文件](../examples/presentation-theme/presentation.source.json)。
脚本必须预先构建成 Worker 可执行单文件；此工具不转换 DOM/Svelte 组件，也不证明
脚本能成功初始化。安装及运行验收仍通过实际 App 完成。

独立双皮肤包现位于 `packages/presentation-shadcn` 和
`packages/presentation-material3`，各自有构建入口和说明。当前发布范围是全部
主题、四类核心语义视图、模型矩阵和状态标记；双皮肤 0.3.0 装配共享工作台 0.2.0。
这两包的整工作台已进入 App 浏览器流程；macOS arm64 原生安装、升级、重启、
禁用/卸载和启动/运行故障恢复已有证据。整体视觉和交互退出验收仍见
[退出审计](presentation-plugin-exit-audit.md)。
未显式选择主题时，PresentationHost 使用 manifest 的 defaultThemeId。

## 外部工作台视觉状态恢复

宿主在窗口内按工作区/会话缓存外部工作台的焦点 key、选择范围、非零滚动位置与
原生 details 展开状态。缓存不含字段内容，最多保留 32 个上下文；每份状态限制
1024 个滚动节点和 1024 个展开节点。只接受活动实例当前上下文/revision 的桥消息，
Worker 不能直接写入此缓存。新皮肤通过相同节点 key 恢复能够匹配的状态。

激活和更新时宿主明确决定是否允许恢复焦点，固定管理/审批控件持有焦点时不会
被外部 iframe 抢走。换会话使用独立状态，不把原会话位置带入新会话。
当前缓存不写盘。默认 composer 与外置 `conversation:draft:input` 共享焦点和选区；
普通消息 `message:<id>`、分组 `message-group:<group-id>` 通过可见消息及相对顶部
偏移映射默认消息区和外置滚动祖先。消息锚点不包含正文，目标不存在时不强制定位。
不同第三方皮肤的不相同 key 不能被推断为同一个控件。

消息富文本的 copyCode/openLink 动作由宿主从当前可见消息解析生成，参数绑定
消息 ID、块序号和实际内容。过期消息或已撤销目录不能继续复制旧代码/打开旧链接。
外部树使用带 link 角色的按钮发出意图，不向 iframe 授予任意导航或剪贴板权限。

## 工作台布局状态

可选 `data.layout` 提供导航/辅助列宽度、最小/最大值及辅助列开关，
`data.layoutActions` 提供宿主范围内的 resize input 令牌。数值由宿主限制，
辅助列关闭后撤销其调整动作。独立工作台的布局滑块消费该合同，不创建本地宽度副本。

视觉树 `inlineSize` 只接受 0–4096 的有限数值，可信桥将其转换为
`--presentation-inline-size` 像素变量；皮肤决定如何应用和在窄屏下重排。
不允许将任意 style 或 CSS 字符串通过这个字段传入。

`PresentationNode.resize` 可在 button 上声明 `{token,value,min,max,direction}`，
尺寸必须为 0–4096 的有限数值，min 不得大于 max，direction 为 1 或 -1。
它不能与节点 keydown 处理器并用。可信桥将真实拖动和左右方向键/Home/End 转为
宿主 input 意图及编辑序号，只有宿主当前允许的输入令牌才能发出调整。连续拖动
依靠稳定容器捕获指针，不依赖被重绘替换的按钮；控件消失或身份变更即终止。

布局快照可选 `mode` 为 standard/focus/review，缺省为 standard；`switching` 表示
宿主布局切换中。`selectMode` click 令牌调用现有宿主布局控制器并沿用其持久化。
focus 不提供列宽动作；resize 身份包含布局模式，避免左右交换后继续接受旧方向
的拖动。review 交换导航/辅助区域并反转对应分栏的增长方向。

`PresentationNode.suggestions` 仅用于 textarea：`listKey` 指向列表容器，`keys`
引用容器内已有宿主 click 动作的按钮，`confirmWithTab` 可启用 Tab 确认。每个
列表最多 100 个键，整棵树最多 1000 个引用；不能与节点 keydown 处理器并用。
可信桥处理上下键、Enter、Escape 和可选 Tab，拒绝合成事件与输入法组合确认。
普通主修饰键 Enter 仍走 primaryEnter；设置 confirmWithPrimary 且存在当前选中项时优先确认建议。建议确认复用当前点击令牌，不新增权限。
输入尚未得到宿主快照确认时隐藏旧列表；完成后将光标移到新文本末尾。

建议配置可包含 `categories: [{key,options}]`：key 指向容器内无业务/本地事件
绑定的分类按钮，options 只能引用本列表的选项键。最多 8 个分类，分类引用也
计入整树 1000 引用上限。Tab/Shift+Tab 循环分类，点击分类只改变显示筛选，
不会发出宿主意图。鼠标确认选项保留编辑器焦点，并复用补全后的光标恢复。

外部 semantic 合同当前只声明四类核心语义，不声明可信本地的可选专业 adapter。
当这类包覆盖 SemanticView 时，宿主不会继续宣称内置带行号阅读已生效：存在专业
阅读偏好则显示通用降级提示，使用同一份完整快照和动作。完整工作台样例同样
显示降级提示，并提供“使用通用阅读／尝试专业阅读”切换宿主偏好。停用外置
semantic 后，原有内置专业协商恢复；未覆盖 semantic 的包仍继承内置能力。

宿主支持图片节点 `resource: "attachment:<id>"`，ID 必须来自当前会话的附件。
宿主 iframe 根据会话范围请求图片，并直接给图片节点设置预览；图片数据不会
进入皮肤 Worker 的输入。文件不存在或已经变化时保留附件名称，预览显示失败。
独立 shadcn/material3 皮肤 0.3.1 在输入框和用户消息下显示附件；已安装的旧皮肤
需要安装新版本才能采用新增渲染逻辑。
