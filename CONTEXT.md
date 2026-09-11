# Aibo Domain Language

Aibo is a local host for multiple coding Agents. This glossary separates host-owned identity and history from installable plugin code and vendor-native state.

## Language

**Agent Plugin**:
A versioned, installable package that contributes one or more Agent kinds to Aibo.
_Avoid_: Adapter, provider integration

**Plugin Release**:
An immutable pairing of a Plugin ID, plugin version, and package integrity digest. Active sessions remain pinned to one Plugin Release.
_Avoid_: Current plugin, latest plugin

**Plugin Installation**:
A locally recorded, enabled or disabled copy of one Plugin Release.
_Avoid_: Agent installation

**Agent Contribution**:
A discoverable Agent kind declared by an Agent Plugin and identified by an Agent ID. A plugin may provide more than one contribution.
_Avoid_: Provider, adapter type

**Aibo Session**:
A host-owned conversation with a stable Session ID, independent of any plugin process or vendor-native session identifier.
_Avoid_: Thread, native session

**Native Session Binding**:
The versioned association between an Aibo Session, its pinned Plugin Release and Agent Contribution, and the plugin-owned data needed to resume execution.
_Avoid_: Session, thread mapping

**Runtime Generation**:
One supervised incarnation of a plugin process. Events from an earlier generation cannot affect a session attached to a later generation.
_Avoid_: Plugin version, session generation

**Capability**:
A versioned, machine-readable promise that an Agent Contribution can perform an optional operation or interaction. A declared capability is not a permission grant.
_Avoid_: Permission, feature flag

**History Projection**:
The host-owned durable record of normalized session activity, readable even when its Agent Plugin is disabled, missing, or incompatible.
_Avoid_: Native history, recovery data

**Plugin View**:
A validated declarative view document rendered by Aibo through the active UI kit. It contains no executable WebView code or visual skin instructions.
_Avoid_: Plugin UI, embedded app

## Plugin Platform Evolution

**能力插件（Capability Plugin）**：提供领域行为、业务数据和可选语义贡献的插件。Agent 插件是能力插件的一种。

**能力契约（Capability Contract）**：对一种业务能力的身份、输入、输出和行为语义的版本化约定。它不代表调用者已经获得执行权限。

**语义贡献（Semantic Contribution）**：插件声明的业务入口、信息结构与动作含义，不指定物理布局或具体组件。
_Avoid_：用“UI 插件”指代只声明页面内容的包。

**Presentation Plugin（表现插件）**：负责工作台布局、语义渲染与视觉风格的表现实现，可组合 Shell、renderer 和 skin 角色。
_Avoid_：用“皮肤”泛指整个 Presentation Plugin。

**语义动作（Semantic Action）**：表达用户意图的动作，按责任分为本地交互、宿主导航和能力调用。

**宿主导航（Host Navigation）**：以业务目标描述的当前位置、详情目标与返回关系，不指定侧栏、中央面板等物理位置。

**能力作用域（Capability Scope）**：能力调用所关联的身份与资源边界，包括 application、workspace 和 session。作用域不等于运行实例或进程。

**核心语义（Core Semantic）**：每个兼容表现插件都必须保留的信息结构和操作含义，由宿主治理其版本。

**专业呈现（Specialized Presentation）**：针对已知语义提供的可选展示方式；它不拥有业务事实，也不替代权限或审批。

**语义降级（Semantic Fallback）**：专业呈现不可用时，使用仍保留必要信息与操作的核心视图表达同一功能。
_Avoid_：用“降级”指代隐藏必需数据或禁掉必需操作。
