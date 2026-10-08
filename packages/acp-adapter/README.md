# @aibolabs/acp-adapter

Generic [Agent Client Protocol](https://agentclientprotocol.com) client for Aibo session providers.
Part of the host SDK from 0.1.2 (`worker` from 0.1.3, option approvals from 0.1.4, form elicitation
from 0.1.5, package-owned launch from 0.1.6, `parameterScope` from 0.1.7, usage mapping from 0.1.8): plugins declaring `hostSdk` import it at runtime and
keep it as a development dependency only (see [host SDK](https://github.com/chldu2000/aibo/blob/main/docs/host-sdk.md)).

| Entry | Contents |
| --- | --- |
| `@aibolabs/acp-adapter/transport` | `AcpTransport`: NDJSON JSON-RPC to the agent process, bounded frames (8 MiB, 32 MiB prompts), write backpressure, stderr tail, timeouts; every failure settles pending requests |
| `@aibolabs/acp-adapter/session` | `AcpSession`: initialize/authenticate, new/load, mode and model selection confirmed by the agent, prompts, messages, reasoning, tools, permission requests, cancellation and recovery; `usage_update` and per-turn prompt usage map to the Aibo usage snapshot (`contextTokens`/`contextWindow`, accumulated input/output/total; host SDK 0.1.8) |
| `@aibolabs/acp-adapter/config` | Parsing of ACP session config options into models, reasoning levels and context windows |
| `@aibolabs/acp-adapter/image-input` | Validation of host image descriptors into ACP image content blocks |
| `@aibolabs/acp-adapter/worker` | `serveAcpAgent`: a Runtime 2.1 Worker driven by `plugin.json` plus `acp.json`, or by a code extension; host-tool MCP bridge included |

## Configuration-only plugins

`acp.json` (schema `aibo.acp-agent/v1`) holds `label`, `command` (an `executable` declared in
`plugin.json` `executableDependencies`), optional `args`, and `modes` mapping Aibo's `ask`, `plan` and `edit` to
native mode IDs; `edit` is the write mode, and `auto` (SDK 0.1.4) is a second write mode for controls whose
profile sets `approvalReviewer: "auto-review"`. Optional: `authMethodId`, `clientMeta`, `persistsEmptySessions`
(default `true`) and `requestPrefix`. The host manifest schema does not allow plugin fields, so this file is
read only by the Worker; an invalid one stops it before the Runtime handshake. Recovery data uses
`<pluginId>.recovery`, optional features use the manifest's `<pluginId>.<feature>` operations, and profiles follow
`agent-managed` execution. Declaring `hostTools` and `aibo.session.tool.respond` connects Aibo's host tools through
the SDK MCP bridge. See `aibo-plugins/plugins/acp-template`.

`approvalOptions` (SDK 0.1.4) lists native permission options as `{ optionId, toolKind?, label?, sessionControl?, contextReset? }`.
`label` replaces the agent's text on the approval card; `toolKind` limits the entry to requests for that ACP tool kind.
`sessionControl` names a `plugin.json` session control that some control lists in `transitions`: the option is offered
even outside a write mode, and choosing it lets the host commit that control before the agent is answered.
The Worker rejects entries whose control is undeclared, unmapped in `modes`, or not a transition target, and requires
the `{ requestId, optionId }` form of `approval.respond`.

`elicitation: true` (SDK 0.1.5; `extension.elicitation` in code) declares ACP form elicitation and claims
`user-input.respond`, which the manifest must declare. Each form field becomes one host question: selects and
booleans as options, strings and numbers as validated free text, a multi-select as a single pick, and a
`_askUserQuestionCustomAnswer` companion as the question's "other" input. Forms the host cannot express
(nested objects, more than 8 fields, duplicate labels, `url` mode) are cancelled without asking. `contextReset: true` (only with `sessionControl`) marks an
option after which the agent continues in a fresh context under the same session; the host records it and notes
on the first later resume that the restored context may predate the reset. The agent's mode report for a committed switch is adopted
and the turn continues; any other mode change during a turn fails it, and the host mode is restored before the next prompt.

Mode switching uses the agent's mode config option when it returns one, and the standard `session/set_mode`
request when it only exposes the session modes API. Reasoning and context-window capabilities are claimed only
when the agent returned those options, unless the extension sets `parameterizedPicker` (Cursor exposes
parameters per model).

## Writing a provider

An `AcpSession` is configured with an extension object. Required fields:

- `label`: agent name used in error messages (`Cursor` gives `Cursor session is not ready`).
- `command` / `args`: the agent executable, spawned without a shell in the trusted workspace.
- `recoverySchema`, `namespace`: recovery data schema and namespace of `extension.updated` events.
- `writableMode`: the native mode that may run write-authorized turns.
- `validateExecutionProfile(profile, permissions)`: maps the host execution profile to a native mode.

Optional hooks cover agent differences: `authMethodId`, `clientMeta`, `persistsEmptySessions`, `parameterizedPicker`,
`commandCategory`, `parameterized`, `subagentFromTool`, `handleRequest` and `handleNotification`
for vendor methods. Hooks receive a narrow session surface (`event`, `respond`, `await`,
`updateSubagent`, `subagents`, `turnId`, `sessionId`); the session keeps all other state private.

Client file and terminal capabilities are advertised as unsupported, and only `allow_once` /
`reject_once` permission options are selected: the host approves each request, and persistent
agent-side grants are never chosen on the user's behalf. The Cursor plugin in `aibo-plugins`
is the reference extension.

With `approvalOptions: true` (the Worker sets it when the manifest's `approval.respond` declares
`optionId`), `approval.requested` carries `options: [{ id, kind: 'allow' | 'reject' }]` for those once options, and
`respondApproval(requestId, { optionId })` answers with one of them; any other option ID is rejected.
Extension approvals receive `{ optionId }` instead of `accept` / `cancel`.

`BASE_CAPABILITIES` is a candidate list: `session.resume` is returned only when initialize
advertises `loadSession: true`. An agent without load support can still create and run sessions;
restoring a persisted session fails explicitly rather than creating a replacement.
Vendor questions are not part of the default capability set. An extension implementing question
requests through `handleRequest` and `await` must add `user-input.respond` to its `capabilities`.

## Package-owned ACP runtime (host SDK 0.1.6)

Instead of an external `command`, a configuration-only plugin can declare:

```json
{ "launch": { "kind": "node", "entry": "vendor/node_modules/example-acp/dist/index.js" } }
```

This is a fragment of `acp.json`; label, schema and modes remain required. `command` and `launch`
are mutually exclusive. `args` are passed after the package entry. The entry is resolved against
`plugin.json`, checked to remain inside the package, and started with `process.execPath` (the Node
resolved for the Worker: a local installation, a manual selection or the Aibo-managed download). The child's working directory remains the user workspace. Missing entries fail startup.
No shell, npm, npx or global executable is needed. External `command` still requires an executable
manifest dependency. A package launch only needs the Node runtime dependency, plus any genuine external
tools it uses. Declare `hostSdk >=0.1.6`; ship the locked production dependency graph and platform assets.
`extensionFromConfig` accepts a third `manifestUrl` argument for package launches.

## Sequential model parameters (host SDK 0.1.7)

Declare `"parameterScope": "current-model"` in `acp.json`, or `parameterScope: 'current-model'`
in the extension. Use the new `model.select` output contract variant requiring this field.
The adapter returns it on list and set; options still belong only to the current model.
The host selects and confirms a model before offering its reasoning options. This adapter does
not accept `all-models` in acp.json because ACP session configuration is not a complete matrix.
Omission preserves legacy behavior. Require hostSdk >=0.1.7 for this declaration.

### Vendor usage metadata (SDK 0.1.10)

`AcpExtension.mapUsage(update)` may return generic `limits` observations. The session calls it only for current live `usage_update` notifications, including while idle, and merges limits by ID into the same snapshot as context, cost and turn totals. Omitted windows are preserved; reconnect clears observations and history replay is ignored. No vendor keys belong in this SDK. A limit includes `id`, `label`, numeric `usedPercent`, `windowMinutes`, optional reset time in Unix seconds (`resetsAt`, null if unknown), and observation time in Unix seconds (`observedAt`). Observations never enter recovery.
