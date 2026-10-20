# 插件设置与管理面板设计

状态：分阶段实现中。Host SDK 0.1.13 的首批实现提供静态管理面板：贡献声明、安装校验、设置导航、
多表单引用及 Codex 行为设置入口。当前可用合同见[Agent 插件设置](agent-plugin-settings.md#插件独立管理面板)。
1.1.0 已增加 application 只读 provider，并接入 Codex 账户状态与额度快照。
contextEpoch、管理写入授权、敏感挑战通道、后台操作监督及 Codex 原生插件管理仍是待实现设计。
静态 1.0.0 拒绝动态声明；只读 1.1.0 拒绝写入和长操作声明，后续继续以显式版本协商扩展。

Aibo 为 Capability Plugin 提供统一的管理面板承载能力。插件拥有页面内容、领域数据和原生操作，
宿主拥有导航、身份校验、草稿、操作监督和默认呈现。Codex 是首个完整使用者；其他 Agent 和非
Agent 能力插件通过相同合同接入，无需增加宿主品牌分支。

## 现状与需要补齐的能力

| 当前合同或实现 | 可复用能力 | 缺口 |
| --- | --- | --- |
| [Agent settings v1](agent-plugin-settings.md) | 普通字段、分层继承、草稿、原子 revision 校验 | 不能表达账户、用量、列表和异步操作 |
| [Semantic view](../packages/plugin-protocol/src/semantic.ts) | 安装身份、语义数据、动作上下文；已有 `settings.page` 扩展点 | 当前 settings 内容是属性和文本，不是组合管理页；设置目录尚未完整接入 |
| [Semantic writes](../src-tauri/src/semantic_writes.rs) | 宿主缓存动作、声明目标、过期校验 | 写入要求工作区，不适用于无项目时的账户操作 |
| [Capability Broker](../src-tauri/src/capability_broker.rs) | application/workspace/session scope、固定绑定、运行代际 | 当前权限准入只接受 workspace.read/write，缺少应用级管理写入路径 |
| [认证入口](../src-tauri/src/plugin_authentication.rs) | CLI 登录与状态检查，凭据留在原生工具 | 只有 login/status；登录打开终端当前仅实现 macOS；缺少结构化账户和异步完成流程 |
| [Tool view](tool-view-contract.md) | 隔离前后端、主题、监督退出 | 实例身份和界面合同围绕工作区工具，不能直接复用为设置面板 |
| [Codex engine](../src-tauri/capability-plugins/codex/engine.mjs) | 原生配置读取、额度读取和通知 | 额度展示依附 session；缺少独立管理 provider |

现有普通设置保存不写 Agent 原生配置文件。新增原生配置管理通过明确的管理操作实现，
不改变 settings v1 的数据所有权和保存语义。

## 所有权和身份

**Management Panel（管理面板）** 是插件提供的管理入口，可以关联该插件的多个贡献。
面板不是 Session Provider，也不是 Presentation Plugin；是否提供会话不影响提供面板的资格。

**Management Target（管理目标）** 是插件识别的某个原生配置或账户环境。它不同于 Aibo 的
application/workspace/session scope：两个工作区可以共享一个原生环境，一个插件也可以管理多个环境。
管理目标的标识由插件返回，宿主只接受当前安装和页面上下文中已验证的标识。

| 信息或行为 | 所有者 |
| --- | --- |
| 安装、release、窗口、工作区、会话身份与执行授权 | 宿主 |
| 分区声明、字段含义、原生账户、原生扩展目录、配置来源和生效规则 | 插件 |
| 管理目标的解析及原生环境之间的同步 | 插件 |
| 页面草稿、读取代际、导航、执行记录与恢复入口 | 宿主 |
| 字体、颜色、几何、键盘与控件视觉 | UI kit |
| 登录凭据和原生配置的持久化 | 原生工具或插件的专用机制 |

界面路由使用 installationId + panel contributionId + sectionId；涉及项目或会话时携带其
宿主身份。管理目标使用额外的 opaque targetId 和 target revision，不接受前端任意传入目录。
同一面板关联多个 Session Provider 时，共享账户分区可以只有一份，设置表单明确引用各自贡献。

同一 targetId 下账户也可能变化。插件报告不含凭据的身份连续性标识，宿主为每个安装和目标维护
`contextEpoch`，与 target revision、snapshot revision 分开。登录、退出、账户或租户切换、身份
连续性无法确认时推进 epoch；A → B → A 也不复用旧 epoch。普通状态刷新或身份不变的令牌续期
不推进 epoch。各 provider 共享同一目标时必须汇报一致的身份上下文，不能按页面分别维护账户代际。

插件在读取和执行前重新确认原生身份，覆盖外部 CLI 修改认证的情况；无法确认时禁止账户相关写入，
返回 context_unavailable。身份变化先使旧草稿、读取请求和动作 token 失效，再发布新上下文。
提交携带 expectedContextEpoch，宿主与 Adapter 均复核；执行中发现身份变化不得把操作重新投递给
新账户。无法保证身份检查与实际调用一致的原生接口，应拒绝该操作或报告结果未知，不能承诺原子切换。

会话入口按该会话固定的 release 查找面板。旧 release 不可执行或会话仅历史时，显示不可用原因和
历史配置，不静默跳到新 release 执行操作。应用入口使用当前已安装 release。正常升级沿用宿主现有
替换事务，不由面板迁移会话。

## 贡献与版本策略

新增可选 `managementPanel` contribution，并提供独立的 `aibo.management-panel/v1` 合同。
它使用现有能力运行时提供数据和动作，但不扩充旧 semantic snapshot 的含义，也不允许执行前端代码。
`semanticView` 的 `settings.page` 保持兼容，可在同一设置目录呈现旧内容。

选择独立贡献的原因是管理页需要组合表单、目标、分区、输入和长操作；这些不是现有 Detail 的可选
装饰字段。独立版本让旧语义视图及外部 renderer 继续按原合同工作。初版面板位于宿主固定管理区域，
通过 UI kit 适配外观；外部 Presentation 只获得导航意图，不接收账户内容或登录挑战。

拟议声明结构如下，字段约束须在实现阶段同时落实到 schema、TypeScript、Rust 和 SDK：

```ts
type ManagementPanelDeclaration = {
  kind: 'managementPanel';
  id: string;
  scope: 'application';
  required: false;
  title: string;
  contractVersion: '1.0.0';
  relatedContributions: string[];
  sections: {
    id: string;
    title: string;
    scopes: ('application' | 'workspace' | 'session')[];
    settingsReferences?: {
      key: string;
      contributionId: string;
      scopes: ('application' | 'workspace' | 'session')[];
    }[];
    providers?: Partial<Record<'application' | 'workspace' | 'session', {
      contributionId: string;
      readOperationId: string;
      actionOperationIds: string[];
      operationControl?: {
        statusOperationId: string;
        cancelOperationId?: string;
        recoverOperationId?: string;
      };
    }>>;
  }[];
};
```

每个 provider 引用必须指向同一安装中声明的 capabilityProvider，作用域必须一致，操作必须存在且
握手成功。初版不开放跨插件管理 provider 引用。仅有 settingsReferences 的分区无需启动进程；
宿主按声明顺序绘制表单，复用 read/save_agent_settings。key 在分区内唯一；每份引用的 scopes
必须同时属于分区和目标 settings descriptor 支持的范围。每份表单独立保存、冲突和反馈；草稿按
现有 settings target 共享，同一配置从不同入口打开不会产生副本。

动态 settings reference 块只能引用本分区已声明的 key，不能引入新 contribution 或扩大作用域。
未被动态内容引用的静态表单仍由宿主显示，已引用的只显示一次；动态 provider 失败不阻止静态配置。

新增贡献的宿主最低版本在功能交付时确定；required=false 只表示旧宿主可按其未知可选贡献规则忽略，
不能替代实际兼容测试。无法安全忽略的旧宿主由 host 版本约束拒绝安装。旧插件无需增加此贡献。
没有面板的 Agent 继续使用现有设置表单和认证入口。有面板时原入口直达对应分区，不能形成两套草稿。

## 内容与交互合同

面板分区不固定为账户、用量、插件。插件返回具有稳定 key 的有限内容块：

| 内容块 | 含义及约束 |
| --- | --- |
| settings reference | 宿主已有设置表单；复用层级、版本、revision 和草稿 |
| properties | 有标签的状态值、配置来源、更新时间；缺失值有原因 |
| metrics | 数值、单位、可选上限或重置时间；宿主不推算账单或剩余权益 |
| collection/detail | 有界列表、搜索、分页、详情；稳定 itemId |
| action form | 声明式普通输入与提交动作；输入按 schema 校验 |
| notice | 信息、错误、不可用原因和恢复动作 |

块不能任意递归嵌套。初版拟限制每分区 32 个块、每页 50 行、普通表单 64 字段、快照 256 KiB；
提交输入最多 64 KiB。身份、文本和查询长度也在 schema 中逐项设上限。翻页、搜索走有界读取，
不返回整个原生目录。内容是 JSON 数据，不接受 HTML、CSS、组件名或任意脚本。

读取结果包含目标、contextEpoch、单调 revision、更新时间和每个分区的状态。功能支持、当前可用性和授权分别处理：
声明与握手确定支持；快照表达 busy/unauthenticated/unavailable 等状态；宿主最终决定是否执行。
界面不因品牌推断可用按钮；一个分区失败不隐藏其他分区。

宿主只提供少量页面操作：打开/关闭、读取分区、编辑/保存配置、提交动作、查询/取消操作。
这些是宿主页面模块的接口，不是允许前端调用任意 capability 的代理。
普通动作提交包含宿主颁发的 action token、用户输入和 requestId；token 绑定窗口、安装 digest、
贡献、作用域、targetId、contextEpoch、target revision、snapshot revision、操作声明及可选 itemId。
插件提供默认参数，宿主从缓存解析，用户只能修改声明允许的输入字段。

普通配置保存只提交该表单草稿。登录、安装和刷新独立执行，不使用面板总保存按钮。
原生配置表单走 action form，并由插件检查原生 revision 或内容指纹，发生外部修改时返回冲突，
保留草稿。原生配置不写进 Agent settings 的 overrides。

### 长操作控制合同

actionOperationIds 中的动作通过统一结果封装返回 completed 或 accepted；accepted 必须携带
非空 opaque handle，并且 provider 已声明并握手支持 operationControl.statusOperationId。
无控制声明的动作只能同步完成。控制操作采用以下统一输入输出，插件不能只声明任意同名方法：

| 操作 | 输入 | 输出 |
| --- | --- | --- |
| 动作提交 | requestId、targetId、expectedContextEpoch、声明的业务输入 | completed + 脱敏结果，或 accepted + handle + 初始状态 + canCancel + 可选 recoveryRef |
| status | handle、原始 targetId、contextEpoch | 操作状态、executionState、canCancel、脱敏结果或错误 |
| cancel | handle、原始 targetId、contextEpoch、取消 requestId | 取消请求是否接受，以及最新状态；接受不等于已经取消 |
| recover | recoveryRef、原始 targetId、contextEpoch、原始 requestId | recovered + 新 handle + 最新状态，或 unrecoverable |

status/recover 是有界的只读对账，不能启动或重放原动作；cancel 是管理写入，遵守相同准入。
按钮可用要求 cancelOperationId 已声明、握手成功、操作当前 canCancel 且宿主允许；任一缺失都不可取消。
recoverOperationId 可选，只有声明并握手成功后才允许重启对账。recoveryRef 是有界、不含凭据的
关联信息，经专门存储验证后随操作记录保存，不能携带登录挑战或访问令牌。

宿主在投递前持久化 managementOperationId 和 requestId；前端只持有宿主操作 ID。插件 handle
绑定 installation/digest、provider、scope、targetId、contextEpoch 和 runtime generation，不能跨
目标、账户、release 或进程复用。控制请求由宿主操作记录解析，不能由 UI 拼装 handle。
账户变化后，监督器仍可对原操作进行只读对账或精确取消；Adapter 必须验证 handle 对应原操作，
不能将其解释为新账户操作。无法保证时停止控制并标记未知执行状态。

重启后旧 handle 立即失效。只有相同 release 且仍有授权时，监督器才可用 recoveryRef 调用 recover，
得到绑定新 generation 的 handle；不能直接向新进程发送旧 handle。无恢复支持或关联信息不足时
进入 outcomeUnknown。升级不迁移在途 handle，必须先按生命周期规则处理原操作。

## 管理操作的授权与敏感数据

在 Broker 增加宿主生成的管理授权凭据，与现有工作区写入凭据区别建模。应用级管理写入不能伪装
成 read，也不能虚构 workspaceId 复用 workspace_write_runs。

拟增加 `plugin.manage` 权限，限于已绑定安装和管理目标的原生账户、配置及扩展管理。
它不授予工作区文件写入、会话工具权限、任意宿主 IPC 或其他插件管理权限。读操作可沿用 application
scope 的空权限调用；需要工作区资源的操作仍须声明 workspace.read/write 并经过相应准入。
该权限是宿主准入合同，不是对原生插件进程新增了操作系统沙箱的承诺。

宿主从安装声明、当前 grants、操作目标和真实用户提交建立凭据，执行前再次校验；
管理动作不出现在 Agent 工具目录，不通过插件间依赖调用转授权。沿用现有确认策略的设计方式，
增加独立的管理操作类别，不因为按钮来自插件就一律弹确认，也不因插件声明而自动授权。
退出账户、变更共享环境等动作在执行区说明影响范围；真正的确认条件由宿主策略确定。

现有 Broker 的调用和事件持久化路径必须在接入前审计。登录 URL、设备码、令牌等不能通过普通
快照、action.input、capability event、通用错误日志或历史记录存储。新增宿主管理专用的短期挑战
通道，只将 allowlist 字段送到固定管理界面。浏览器打开经过宿主 URL 校验，回调由原生认证实现处理。
此通道仍执行相同的安装/目标/代际准入；不为厂商提供任意 IPC。

初版支持浏览器登录及受支持的设备码流程，不收集 API key。后续如需 API key 输入，先实现不记录
秘密的专用提交和清理机制；不能在 settings v1 增加 password 字段代替。执行记录只保存操作身份、
状态、时间和脱敏错误，不保存挑战或凭据。

## 生命周期与恢复

打开面板不创建聊天会话。应用级管理 provider 按绑定和 scope 获取 runtime，Codex 管理连接与
会话连接分开；共用的传输实现可以复用，但不能共用 engine 的全局 session 可变状态。

原生宿主的管理操作监督器独立于页面和窗口，负责操作记录、后台对账、截止时间及执行租约。
Broker 为监督器提供受限的宿主调用身份：从持久操作记录恢复原授权，只允许控制该操作，不能创建
新动作、假冒已关闭窗口或扩大权限。每次调用仍复核安装、grants、绑定及代际；权限撤销转入停止流程。

初版用轮询和明确刷新，不新增通用推送协议。插件在原生连接上消费登录完成等通知并映射状态。
UI 只订阅操作投影并刷新可见内容；关闭窗口释放 UI 订阅，不停止监督器。监督器对未结束操作有界
轮询和退避，提交时固定截止时间，插件不能无限续期。打开新页面不会重复创建后台轮询任务。
运行实例在操作可能仍执行时持有租约，不因 start 返回或页面关闭而回收；宿主退出走停止与恢复流程。

状态包括 pending、running、waitingForUser、succeeded、failed、cancelled、outcomeUnknown。
点击取消只表示已请求取消，只有 provider 确认后才展示 cancelled；不支持取消时不给按钮。
超时、进程崩溃或断连不等于失败且无副作用。插件若不能依据原生状态对账，必须返回 outcomeUnknown，
宿主提供刷新/检查指引，绝不自动重放登录、安装或原生配置写入。

结果状态与执行存活状态分别记录，executionState 为 active、stopped 或 unknown。截止时间到达
先对账、在已有授权和支持范围内请求取消，然后在有限宽限期内确认停止；不能确认时进入恢复状态，
停止常规轮询，保留生命周期阻塞和可操作的诊断入口。进程退出只证明其自身停止，不能证明外部任务停止。

| 状态证据 | 租约和后台任务 | 禁用、卸载和替换 |
| --- | --- | --- |
| 已确认终态且 executionState=stopped | 持久化结果，结束轮询并释放租约 | 不再因该操作阻塞 |
| outcomeUnknown 且已确认 stopped | 保存未知结果，结束轮询并释放租约；允许显式只读对账 | 预览显示未确认副作用，按现有策略继续，不因未知结果永久阻塞 |
| active，或 executionState=unknown | 保留执行租约；超过宽限期结束常规轮询，标记需要恢复 | 阻塞替换/卸载；禁用进入待停止状态，不能伪报完成 |

恢复入口允许重新对账或走宿主监督的停止/隔离流程。只有证据证明原执行已停止或已可靠隔离、不会再
访问待移除资源后，才能释放阻塞。关闭窗口、删除操作记录或强杀一个可能派生外部任务的进程都不能
替代该证据。操作结果仍未知时保留记录，即使生命周期操作最终可以继续。

requestId 去重及最小操作记录由宿主持久化，插件负责原生操作关联与对账。重启后没有可靠恢复信息的
在途操作归为 outcomeUnknown，登录挑战失效后明确重新发起。窗口关闭不冒充取消，重新打开面板可以
看到脱敏操作状态；敏感挑战只允许原发起窗口或经过显式接管的新窗口查看。

静态配置草稿继续按现有 settings target 缓存，附加指令等账户无关配置不因登录变化被清除。
原生 action form 草稿按安装、分区、表单 key、作用域、targetId、contextEpoch 和字段版本隔离。
epoch 改变时旧草稿标记失效、退出可提交状态，不为其自动换发新 token；再次登录原账户也不自动恢复。
界面提示原账户草稿已失效，用户可丢弃或明确重新编辑；重新编辑必须基于新快照校验，不自动迁移值。
切换分区/外观保留同一上下文的草稿。迟到读取按 epoch 与读取代际丢弃；写入完成更新原操作记录，
不覆盖新账户页面。运行时重启若无法证明身份连续性也推进 epoch。

禁用、卸载、替换期间，宿主阻止新操作；活跃管理任务参与现有生命周期影响预览和阻塞规则。
关闭页面不是释放执行权。安装替换后旧 action token 全部失效。管理读取与写入遵循现有升级撤销窗口
失效规则，不能让新版本使用原生状态后仍允许无条件撤销。

## 导航和面板布局

设置窗口增加动态的插件管理入口，Agent 可按 relatedContributions 归入 Agent 分组，其他插件归入
插件管理分组；分组只影响导航。插件安装详情、Agent 菜单、认证或额度状态都可发出相同直达意图。
分区数较少时用横向标签，较多时用局部导航；窄窗口切换为单列，不在小弹窗中再叠插件商店弹窗。

```text
设置导航                  Codex                         运行状态
  通用                    当前环境：与本机 CLI 共用
  外观                    账户  用量  插件  行为  高级
  插件与能力
  Agent                   当前账户
    Codex                 邮箱 / 认证方式 / 套餐
    Example Agent         [登录] 或 [退出登录]
                          操作状态 / 更新时间 / 重试
```

页面标题和分区来自插件声明。环境选择只在插件实际支持多目标时显示；只有支持项目/会话配置的分区
显示作用域控件。禁用插件保留静态配置和宿主恢复入口，动态数据明确不可用；打开页面不自动启用插件。
移除安装后清理导航，但业务历史和既有会话配置按原合同保留。

视觉使用现有 [UI 架构](ui-architecture.md) 与 [Material 3](design/material3-current-spec.md)、
[ak-ui](design/ak-ui-current-spec.md) 规范，必须遵守[面板与设置信息架构](ui-architecture.md#面板与设置信息架构)。
分区、作用域与只读数据分别由 ui-kit 的 `Tabs`、`SegmentedControl`、`ManagementDataView` 渲染，
刷新等分区级操作是标题右侧的图标按钮；宿主面板组件只负责装配，不新增私有样式类。
两套 UI kit 提供同一语义控件合同。加载保留布局，
错误就地展示；状态更新可访问，键盘能到达所有动作，标签切换恢复合理焦点。外部皮肤故障不影响管理入口。

## Codex 首个实现

| 分区 | 数据及操作 | 生效与限制 |
| --- | --- | --- |
| 账户 | 账户读取、登录、取消、退出 | 由原生认证保存凭据；显示共享环境影响 |
| 用量 | 账户额度窗口、重置时间、credits（存在时）、更新时间 | 不等同账单；缺失显示原因，不补零；会话 token 独立标注来源 |
| 插件 | 原生已安装/发现列表、详情、状态和支持的管理动作 | 不注册为 Aibo Plugin Installation；按实际版本能力开放 |
| 行为 | 附加指令；后续支持的原生默认配置 | 附加指令复用 settings v1；默认配置与当前会话控制区分 |
| 高级 | Codex 版本、原生配置来源、连接诊断 | 初版只读；重连等动作按影响范围单独声明 |

Codex 新增应用级管理 capabilityProvider；worker 按贡献路由，现有 session 和 catalog 行为保持。
管理与会话 provider 必须使用一致的原生环境解析。共用 CODEX_HOME 时显示“与本机 Codex CLI 共用”；
退出账户和变更配置可能影响 CLI 与多个会话，不能暗示只影响当前 Aibo 窗口。
账户变化后使相关会话的认证/额度缓存失效，在下一次需要认证的调用前重新检查；不中断回合或偷偷重发消息。
运行中不能安全切换时返回 busy 和影响说明，不强制杀死会话进程。

原生接口需按交付时安装版本生成的协议或实际探测验证。当前已查阅的
[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server) 提供账户登录/取消/退出和额度读取，
但将 plugin/list 与 plugin/read 标为开发中并要求生产客户端暂勿调用。原生插件管理排在后续阶段，
验证可用性之前显示能力限制和操作指引；不得通过直接改写未公开的原生存储结构绕过。

## 非 Codex 验证示例

增加仅用于验证的 Example Agent fixture，提供两个 Session Provider，共享一个管理面板。
一个行为分区分别引用两份 settings，另一个应用分区提供模拟连接状态和可取消的异步操作。
它没有账户、额度和插件商店；宿主不能补造这些分区，也不能要求它实现 Codex 协议。
同一 fixture 切换不同 targetId，以及在同一 targetId 下模拟 A → B → A 和外部身份变更，证明草稿、
操作和迟到响应隔离。两份 settingsReferences 在不启动 provider 时独立保存，一份发生冲突不影响
另一份；同一引用从不同入口打开共享草稿。另覆盖仅静态配置、无管理 provider 的最小插件，以及
不提供 Session Provider 的 Capability Plugin。

## 实施顺序与验收

| 阶段 | 交付内容 | 完成条件 |
| --- | --- | --- |
| 1 合同与准入 | managementPanel 声明/快照/动作合同、多表单引用、contextEpoch、status/cancel/recover 映射、管理授权和脱敏执行记录 | schema/类型/Rust/SDK 一致；操作 handle 与恢复语义定稿；旧插件和旧 semantic/tool view 合同不变；无品牌分支 |
| 2 通用宿主页 | 导航、配置复用、块渲染、草稿、目标切换、长操作监督、恢复 | Example Agent 和纯配置插件端到端可用；两套皮肤及故障恢复可达 |
| 3 Codex 接入 | 独立管理 provider、账户、用量、附加指令、只读诊断 | 未选工作区/未创建会话可用；认证挑战不落日志；真实打包桌面验证 |
| 4 原生扩展与高级配置 | 经验证的插件管理、原生配置编辑 | 原生版本门禁、冲突与生效边界、共享环境影响全部可验证 |

生产者是插件 manifest、settings descriptor 和管理 provider；消费者是原生管理控制器、固定设置界面
与 UI kit。执行者仍为 Broker 和绑定插件。预计改动集中于 contracts、plugin-protocol、manifest 校验、
Broker 管理准入、插件生命周期、独立 management controller、设置装配及 Codex worker/管理 Adapter。
具体持久表通过新增迁移实现，已应用 SQL 保持不变。设计阶段不修改当前运行合同或发布 SDK。

回归按 [宿主与插件约束](plugin-boundaries-and-regression.md#regression-gate) 选择并补充：

- 合同：未知可选贡献、只声明未实现、provider/scope 不符、字段和大小超限、动作输入伪造；无 status 声明却返回 accepted、缺 cancel 协商、动态引用未声明的 settings key。
- 身份与授权：跨窗口/安装/目标 token、过期 revision、应用写入无凭据、依赖调用提权、归档会话。
- 生命周期：关闭全部管理窗口后操作完成，监督器仍持久化终态、释放租约并允许升级；取消竞争、截止时间、unknown/stopped 与 unknown/unknown 的不同准入；重启拒绝旧 handle、有/无 recover 支持、禁用/卸载/替换、升级撤销失效和恢复。
- 数据：普通配置继承、两份静态表单独立保存与冲突、同一 settings target 共享草稿、原生外部修改、两目标隔离；同 targetId 下 A → B → A、外部 CLI 切换及身份不可确认时旧草稿/响应/token 失效，附加指令草稿保留；敏感字段不进入数据库和日志。
- 界面：真实设置入口、直达分区、无项目登录、缺依赖、离线、恢复、两套皮肤浅深色及窄窗口键盘操作。
- 相邻路径：原 settings 表单、CLI 认证、semantic 读写、tool view、会话固定绑定、队列和审批。

实现交付运行 pnpm run verify、相应 Rust 测试和浏览器/原生探针。模拟 provider 只能证明宿主合同，
不能代替真实 Codex 登录、原生版本兼容性或各操作系统桌面验收。
