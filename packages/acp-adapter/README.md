# @aibo/acp-adapter

Generic [Agent Client Protocol](https://agentclientprotocol.com) client for Aibo session providers.
Part of the host SDK from 0.1.2: plugins declaring `hostSdk` import it at runtime and keep it as a
development dependency only (see [host SDK](../../docs/host-sdk.md)).

| Entry | Contents |
| --- | --- |
| `@aibo/acp-adapter/transport` | `AcpTransport`: NDJSON JSON-RPC to the agent process, bounded frames (8 MiB, 32 MiB prompts), write backpressure, stderr tail, timeouts; every failure settles pending requests |
| `@aibo/acp-adapter/session` | `AcpSession`: initialize/authenticate, new/load, mode and model selection confirmed by the agent, prompts, messages, reasoning, tools, permission requests, cancellation and recovery |
| `@aibo/acp-adapter/config` | Parsing of ACP session config options into models, reasoning levels and context windows |
| `@aibo/acp-adapter/image-input` | Validation of host image descriptors into ACP image content blocks |

## Writing a provider

An `AcpSession` is configured with an extension object. Required fields:

- `label`: agent name used in error messages (`Cursor` gives `Cursor session is not ready`).
- `command` / `args`: the agent executable, spawned without a shell in the trusted workspace.
- `recoverySchema`, `namespace`: recovery data schema and namespace of `extension.updated` events.
- `writableMode`: the native mode that may run write-authorized turns.
- `validateExecutionProfile(profile, permissions)`: maps the host execution profile to a native mode.

Optional hooks cover agent differences: `authMethodId`, `clientMeta`, `persistsEmptySessions`,
`commandCategory`, `parameterized`, `subagentFromTool`, `handleRequest` and `handleNotification`
for vendor methods. Hooks receive a narrow session surface (`event`, `respond`, `await`,
`updateSubagent`, `subagents`, `turnId`, `sessionId`); the session keeps all other state private.

Client file and terminal capabilities are advertised as unsupported, and only `allow_once` /
`reject_once` permission options are selected: the host approves each request, and persistent
agent-side grants are never chosen on the user's behalf. The Cursor plugin in `aibo-plugins`
is the reference extension.
