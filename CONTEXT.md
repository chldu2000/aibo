# Aibo Domain Language

Aibo is a local host for coding Agents, capability plugins, and presentation plugins.
This glossary distinguishes host-owned identity and history from plugin behavior and vendor-native state.

## Language

### Plugins and contributions

**Capability Plugin**:
An installable package that supplies domain behavior, business data, and optional semantic contributions.

**Agent Plugin**:
A capability plugin that supplies one or more session providers. It is not a separate runtime or authorization model.

**Plugin Release**:
An immutable combination of plugin identity, version, and package integrity digest. A session's provider binding remains pinned to its release.
_Avoid_: Using “current plugin” or “latest plugin” for a pinned release.

**Plugin Installation**:
The host's local record of a particular release and its installation and enablement state. The record can remain available for history after the package is removed.

**Contribution**:
A named entry supplied by a plugin for a declared role and scope. Its contribution identity is distinct from the plugin and installation identities.

**Capability Provider**:
A contribution that implements one or more capability contracts. A bound provider identifies the installation and contribution supplying those capabilities.
_Avoid_: Treating a provider as the entire plugin package or as a permission grant.

**Session Provider**:
A capability provider supplying the session lifecycle and any supported session features. It is the role used to discover and bind an Agent for a session, not a separate plugin or runtime category.

**Native Adapter**:
The plugin-side implementation that translates a provider's contracts into a vendor's native protocol, events, and recovery data. An adapter is an implementation role, not an installable plugin identity.

### Capabilities and execution

**Capability**:
A domain operation or interaction offered through a capability contract. Capabilities may serve application, workspace, or session scope and include both lifecycle operations and optional features.

**Capability Contract**:
The versioned agreement defining a capability's identity, inputs, outputs, and behavioral meaning. Declaring or implementing the contract does not grant permission to execute it.

**Capability Scope**:
The identity and resource boundary of a capability use: application, workspace, or session. Scope is distinct from a running instance or process.

**Execution Authorization**:
The host's permission for an operation under the applicable installation grants, workspace policy, session configuration, and approval requirements. Supported capability and current UI availability are separate concepts.

**Runtime Generation**:
One supervised incarnation of a plugin process. Events from an earlier generation cannot affect a session attached to a later generation.
_Avoid_: Confusing runtime generation with plugin release or presentation generation.

### Sessions and history

**Aibo Session**:
A host-owned conversation with a stable session identity independent of plugin processes and vendor-native session identifiers.
_Avoid_: Using a vendor “thread” or “native session” as the host session identity.

**Native Session Binding**:
The versioned association between an Aibo Session, its pinned provider installation and contribution, and the plugin-owned information needed to resume native execution.
_Avoid_: Confusing the binding with the native session identifier alone.

**History Projection**:
The host-owned durable record of normalized session activity, readable even when its provider is disabled, missing, or incompatible. It is distinct from plugin-owned recovery data.

### Semantics and presentation

**Semantic Contribution**:
A plugin-declared business entry, information structure, and action meaning, independent of physical layout or concrete visual components.
_Avoid_: Calling a package that only declares semantic content a presentation plugin.

**Presentation Plugin (Skin)**:
An installable visual extension that can customize themes, controls, semantic views, and the workbench; unspecified surfaces inherit the host default. Skin is the user-facing name for the same plugin concept.
_Avoid_: Defining skin and presentation as independently selected plugin identities.

**Semantic Action**:
A user intent classified by responsibility as local interaction, host navigation, or capability invocation.

**Host Navigation**:
The current business location, detail target, and return relationship, independent of placement in a sidebar or central panel.

**Core Semantics**:
The host-governed information structure and action meanings that a compatible presentation must preserve for the surfaces it renders. Uncustomized surfaces retain them through the host's default implementation.

**Specialized Presentation**:
An optional rendering of known semantics that owns neither business facts nor execution authorization.

**Semantic Fallback**:
Rendering the same data and actions through a core view when specialized presentation is unavailable.
_Avoid_: Using “fallback” to mean hiding required data or disabling required actions.

**Core Semantic Version**:
The version of the information and action meanings a presentation preserves. It does not determine which snapshot formats the presentation can read.

**Snapshot Protocol Version**:
The version of the view-data and action format exchanged between host and presentation, requiring explicit receiver support.
_Avoid_: Equating snapshot format, core semantics, and plugin release versions.
