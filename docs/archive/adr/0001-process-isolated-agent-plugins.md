---
status: accepted
---

# Run Agent plugins out of process behind versioned host contracts

Aibo will load Agent integrations as local executable Plugin Releases instead of linking vendor adapters into Rust Core or injecting plugin code into the WebView. Core supervises process generations and remains authoritative for workspace trust, permissions, Aibo session identity, normalized events, persistence, and history; a plugin owns vendor protocol translation, native session operations, capability discovery, and versioned recovery data. Communication uses newline-delimited JSON-RPC over stdio, while plugin views are validated declarative documents rendered through the Aibo UI kit. This boundary lets a new Agent be installed without rebuilding Aibo and contains crashes and protocol drift without treating process isolation as an operating-system sandbox.

The protocol does not freeze one process topology. Core may use one process for one session or multiplex sessions in a shared process, but every operation and notification is bound to an Aibo Session ID, Agent ID, and supervised Runtime Generation. Active sessions are pinned to an immutable Plugin Release; upgrades affect new process starts unless an explicit binding migration succeeds.

## Considered options

- Keeping Codex and Pi adapters in Rust Core was rejected because every new Agent would require changing and rebuilding the host.
- Loading dynamic libraries in process was rejected because ABI compatibility and plugin crashes would share the host failure boundary.
- Loading Svelte, JavaScript, or CSS into the main WebView was rejected because it would bypass the UI-kit and Tauri trust boundaries.
- Using MCP as the Agent runtime was rejected because MCP models tools and resources, not Aibo's session lifecycle, streaming, cancellation, recovery, and durable event semantics.

## Consequences

`AgentEvent v1` and historical rows remain readable but are not silently widened. Plugin-originated durable events use `AgentEvent v2`; the projector accepts both versions. Codex and Pi must ultimately ship as built-in Plugin Releases through the same registry, supervisor, protocol, and renderer path as external plugins. A compatibility bridge to the current managers is allowed only during P4.7B.
