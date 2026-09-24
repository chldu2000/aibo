# Aibo plugin development

[English](plugin-development.md) | [简体中文](plugin-development_zh.md) | [Project README](../README.md)

This guide covers public extension paths and links to their contracts. Both language versions have the same scope.
Provider-specific implementation history and test results belong in separate records.

## Choose an extension path

| Goal | Extension | Starting point |
| --- | --- | --- |
| Add operations, services or domain data | Capability provider | [Standalone example](../examples/capability-plugin/) |
| Show business data and actions | Capability provider plus semantic contribution | The same example; no frontend code required |
| Integrate a coding Agent | Session capability provider using Runtime 2.1 | [Session negotiation](session-capability-negotiation.md) |
| Customize themes, controls or workbench rendering | Installable Presentation package | [Package contract](presentation-package.md) |

Capability packages use Manifest v2. Agent Runtime v1 and its archived guide are not executable extension paths.
Capabilities describe support, not execution authorization. See [domain language](../CONTEXT.md) for terminology.

## Check compatibility

| Dimension | What to verify |
| --- | --- |
| Host and OS | Manifest `host` range and `platforms`, plus the [support matrix](plugin-platform-support-matrix.md); installation support is not runtime acceptance evidence |
| Capability runtime | Exact supported protocol: 2.0 for the greeting example, explicit 2.1 for session streams and controls |
| Semantic views | Supported contract and snapshot format, independently of package versions |
| Host SDK | If declaring `hostSdk`, a host that implements it and satisfies the range; the current example requires SDK `>=0.1.0 <0.2.0` |
| Session features and permissions | Matching manifest, handshake, open response and host schemas; provider-managed permissions additionally require the [session-controls contract](session-controls.md) |
| Presentation | `presentation.json`, its hostApi/coreSemantics and declared snapshot formats; see the package contract |

A matching host version alone does not identify which source changes a development build contains.
Record the exact host commit/build, plugin release, SDK and native CLI versions used for validation.
A commit mentioned in historical notes is not a published minimum host version.

## Build and install the example

From the Aibo repository root, run `pnpm install`; Node.js 22+, npm and `tar` are required. Then run:

```sh
node --input-type=module -e 'import { buildExternalPlugin } from "./probes/build-external-plugin.mjs"; const result = await buildExternalPlugin(); console.log(JSON.stringify({ developmentRoot: result.root, installPath: result.packagePath }, null, 2));'
```

The builder packs local SDK tarballs, installs them offline as development dependencies in a temporary consumer,
compiles the worker and prints an unpacked installation directory. The greeting package contains `plugin.json`
and `dist/worker.js`, without Aibo SDK copies or `node_modules`; it has no third-party runtime dependencies.
The host supplies public SDK imports through [hostSdk](host-sdk.md). This build does not launch Aibo or call a model.
Copy the temporary development directory to a durable location before using it for long-term development.

Install and enable `installPath` through the desktop capability-plugin manager. Open **External SDK greeting**
from the command entry and check `EXTERNAL_SDK_OK` and refresh. Direct capability calls require a host-selected binding.
For macOS native installation acceptance, run `node probes/external-plugin-native.mjs` from Aibo's root with a working
Tauri environment; it builds its own package and uses isolated application data and a temporary workspace.

## Author and package a capability plugin

Use the matching [manifest](../examples/capability-plugin/plugin.json) and [worker](../examples/capability-plugin/worker.ts).

1. Set your plugin, contribution, capability and operation IDs. A capabilityProvider operation ID uses the plugin namespace,
   such as `dev.example.greeting.read`; its exact value must match the runtime handshake. Keep package, manifest and worker release versions consistent.
2. Declare scope, effect, permissions, input/output schemas, deadline and idempotency. Implement the operation allowlist,
   return schema-valid data, log to stderr and reserve stdout for the protocol.
3. Respond to `tools.signal`; use `tools.call` for declared provider dependencies. The Broker supplies scope and authorization.
   Do not automatically retry a write after cancellation, rejection or an unknown result.
4. For semantic contributions, return content and action meanings without HTML/CSS or executable UI code.
   The example receives `{ actionId: "refresh", itemId: null, offset: 0 }` and returns `state`, `view`, `actions`;
   the host supplies snapshot identity and revision. See the [write](../fixtures/plugins/capability-write/) and
   [semantic-write](../fixtures/plugins/semantic-write/) fixtures for host-approved writes.
5. Build and locally pack `packages/plugin-protocol` and `packages/capability-runtime`, install those tarballs as
   development dependencies, then compile your worker. Public SDK packages are not currently distributed through a public registry.
6. Declare `hostSdk` and package the compiled entry and manifest. Keep public SDK imports external to bundles.
   Third-party runtime libraries must be bundled into business code or explicitly included in the installation artifact;
   merely listing dependencies does not supply their files, and Aibo does not run `npm install`. See [SDK packaging rules](host-sdk.md).
7. Inspect the unpacked artifact for missing dependencies, developer paths and symlinks before installation.
   [`build-external-plugin.mjs`](../probes/build-external-plugin.mjs) is the complete dependency-free example flow.

Releases are immutable. Update release versions for changed package contents; existing sessions remain pinned to their
installation/contribution. Installing an upgrade does not migrate existing sessions or their recovery data.

## Implement a session provider

Session discovery uses enabled, runnable session-scope capabilityProvider contributions declaring `aibo.session.open`.
Declare `displayName` and optionally `icon: { path: "M12 2L22 12L12 22L2 12Z" }` on the contribution.
The icon is monochrome path data in a 24 × 24 viewBox, at most 8192 characters; full SVG, URLs, scripts and styles are rejected.
The host validates it; the skin supplies colors and fallback. Each contribution has its own identity and dependency readiness.

Use explicit Runtime 2.1 and the [session contracts](../contracts/session-capabilities.v1.json),
[event schema](../contracts/session-event.v1.schema.json) and [binding schema](../contracts/session-binding.v2.schema.json).
Native IDs and recovery belong to the provider; host session/turn identity, authorization and durable history belong to Aibo.
Declare controls in the allowlist, handle cancellation and emit only within the active invocation.
[Built-in workers](../src-tauri/capability-plugins/) are implementation references; their private shared helper is not a public SDK API.

Follow [session negotiation](session-capability-negotiation.md) for exact optional-feature schemas, handshake and open declarations,
response envelopes and missing-capability behavior. Support, current availability and authorization remain separate.
Menus consume host-validated `executionProfile.sessionControls`; selection submits a control ID.
[Session controls](session-controls.md) defines native authorization, CoreProxy and `agent-managed` permission ownership;
none can be inferred from a brand or feature label. Opening an edit mode alone does not authorize a write turn.

## Extend presentation

External skins use a separate `presentation.json` package and the [presentation tools](../packages/presentation-tools/).
Start with the [package contract](presentation-package.md), [shadcn](../packages/presentation-shadcn/) or
[Material 3](../packages/presentation-material3/) examples. Workers return restricted visual trees; the trusted bridge
renders them and forwards host action tokens. Packages cannot directly access DOM, network, storage or Tauri IPC.
Unprovided surfaces inherit the host default; management, approval and recovery remain host-owned.

`UiKitAdapter`, the kit registry and [web-presentation types](../packages/web-presentation/) are for trusted host development,
not the external installation mechanism. Changes to those boundaries follow [UI architecture](ui-architecture.md).
A new internal component is not automatically a new public controls surface.

## Feature contracts

| Work | Reference |
| --- | --- |
| Settings, inheritance and invocation snapshots | [Agent settings](agent-plugin-settings.md) |
| Models, reasoning, Fast, context-window selection and usage | [Model configuration](model-configuration.md) |
| Goal lifecycle and resume admission | [Goals](goal-lifecycle.md) |
| Durable waiting queue and separately negotiated steering | [Message queue](message-queue.md) |
| Subagent progress and process history | [Subagent history](subagent-history.md) |
| External snapshots, controls and action directories | [Presentation package](presentation-package.md) |

## Validate before sharing

In the plugin's own repository, run its tests and packaging checks, then exercise the packaged worker's handshake and schema-valid responses.
For session providers, validate native creation, permission behavior, cancellation and cross-process recovery separately.
Use isolated data; record commands, versions, supported configurations and remaining gaps. Do not publish credentials or raw provider logs.

When modifying Aibo, run `pnpm run verify` from the Aibo root and choose additional Rust, browser and native checks from the
[regression matrix](plugin-boundaries-and-regression.md#regression-gate). `pnpm run probe:session:capabilities` tests session workflows
with simulated engines; native probes are described in the [probe guide](native-engine-probes.md).
Build success, mocked-engine success, native installation and real desktop interaction are distinct evidence levels.
