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
