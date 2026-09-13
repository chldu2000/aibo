# Aibo plugin development

[English](plugin-development.md) | [简体中文](plugin-development_zh.md) | [Project README](../README.md)

## Choose an extension path

| Goal | Extension | Starting point |
| --- | --- | --- |
| Add an operation, external service or domain data | Capability provider | [Standalone example](../examples/capability-plugin/) |
| Show plugin data and actions in the workbench | Capability provider plus semantic view | The same example; no frontend code required |
| Integrate a coding Agent | Session capability provider using Runtime 2.1 | [Built-in providers](../src-tauri/capability-plugins/) |
| Change layout, rendering or skin | Installable isolated presentation package | [Presentation package contract](presentation-package.md) |

For capability packages, use Manifest v2. Agent Runtime v1 and its archived development guide are no longer
an executable extension path. A capability declaration describes behavior; it does not
itself grant access to the workspace. See the [support matrix](plugin-platform-support-matrix.md)
for exact accepted versions and platforms.

## Build and install the working example

Run from the Aibo repository root after `pnpm install`, with Node.js 22+ and `tar` available:

```sh
node --input-type=module -e 'import { buildExternalPlugin } from "./probes/build-external-plugin.mjs"; const result = await buildExternalPlugin(); console.log(JSON.stringify({ developmentRoot: result.root, installPath: result.packagePath }, null, 2));'
```

This builds local SDK tarballs, copies the example into a temporary directory outside
the repository, installs those tarballs offline, compiles the worker and bundles its
runtime dependencies. It prints an unpacked `installPath` containing `plugin.json`,
`dist/worker.js`, and the required `node_modules`. It does not launch Aibo or call a model.
The returned development directory is retained for inspection; copy it somewhere durable
if you plan to keep working on it.

In the desktop app, open **Plugins**, enter `installPath`, install the package, and enable
it. The example contributes a command semantic view titled **External SDK greeting**;
open it from the command entry. Its content is `EXTERNAL_SDK_OK`, with a refresh action.
Direct capability invocations require a host-selected provider binding.

For automated macOS desktop acceptance, use:

```sh
node probes/external-plugin-native.mjs
```

That probe builds its own package and uses an isolated app identifier and temporary
workspace. It requires the Tauri development environment. Merely running `node` on the
worker is not an end-to-end test: the worker expects a host protocol handshake on stdin.

## Author a capability package

The [example manifest](../examples/capability-plugin/plugin.json) and
[worker](../examples/capability-plugin/worker.ts) are a complete, matching pair. Keep these
parts consistent when copying the example:

1. Choose your own `pluginId`, contribution ID, operation ID and capability namespace.
   Keep the manifest version and worker `pluginVersion` identical.
2. Declare `host`, `platforms`, and exact supported runtime versions. The example uses
   Runtime 2.0 and Semantic View 1.0; do not infer protocol versions from SDK package versions.
3. Declare each operation's scope, input/output JSON schemas, effect, permissions,
   timeout and idempotency. Use `application` for operations that need no workspace;
   select `workspace` or `session` when their identity is required.
4. Implement only the operations in the allowlist. Return schema-valid data, write logs
   to stderr, and reserve stdout for protocol messages.
5. Cooperate with `tools.signal`. Use `tools.call` for declared provider dependencies;
   the Broker supplies scope, invocation identity and authorization. Do not retry writes
   automatically after cancellation, rejection or an unknown outcome.

A semantic view references a declared provider operation. The greeting query receives
`{ actionId: "refresh", itemId: null, offset: 0 }`, not an empty object. Its output contains
`state`, `view` and `actions`; the host supplies snapshot identity and revision. Semantic
views express content and intent, without HTML, CSS, skin IDs or executable UI code.

For writes, declare a write effect and the required permissions. The host owns approval,
workspace admission and durable outcomes. Session permission consent only authorizes the
bound session's top-level turn; it is not general authorization for arbitrary plugin or
nested dependency writes. Reference [write](../fixtures/plugins/capability-write/) and
[semantic write](../fixtures/plugins/semantic-write/) fixtures alongside the contracts.

## Package your own changes

The external builder demonstrates the full process in
[`probes/build-external-plugin.mjs`](../probes/build-external-plugin.mjs). For a maintained
plugin project, repeat these stages in your own development directory:

1. Build `packages/plugin-protocol` with TypeScript, then locally pack it and
   `packages/capability-runtime` with `npm pack --ignore-scripts`.
2. Install both local tarballs in your plugin project. These packages are not available
   from a public registry; do not start with a registry-only installation command.
3. Compile `worker.ts` using `tsc -p tsconfig.json`. Keep runtime dependency versions in
   the final `package.json`; do not ship machine-specific tarball paths.
4. Run `npm pack --ignore-scripts` in the plugin project. The example's
   `bundledDependencies` includes both SDK packages. Inspect the archive for the manifest,
   compiled entrypoint and runtime dependencies; exclude workspace symlinks and app imports.
5. Unpack the archive into a directory, then install that directory through Aibo.
   For each changed release, increment the plugin version and worker version together.

Releases are immutable and sessions remain pinned to their provider installation.
Installing another version does not silently migrate active sessions or recovery data.
Test disable/re-enable, missing dependencies, incompatible versions and recovery behavior
before treating an upgrade as supported.

## Implement a session provider

Start with the current [Codex](../src-tauri/capability-plugins/codex/worker.mjs) or
[Pi](../src-tauri/capability-plugins/pi/worker.mjs) provider, plus their shared
[session provider implementation](../src-tauri/capability-plugins/session-provider.mjs).
That shared file is an in-repository implementation reference, not a published SDK API.

- Use Runtime 2.1 explicitly for invocation streams and controls; the helper defaults to 2.0.
- Implement the shared [session capability contracts](../contracts/session-capabilities.v1.json),
  [session events](../contracts/session-event.v1.schema.json) and
  [recovery binding](../contracts/session-binding.v2.schema.json).
- Keep native engine IDs inside native bindings. The host owns session and turn identity,
  first-message naming, permission decisions, event validation and durable history.
- Declare controls in the operation allowlist. Emit events only while the invocation is
  active; handle cancellation and reject controls that no longer belong to that invocation.
- Do not claim an enforcement backend by adding manifest fields. External providers without
  negotiated host enforcement receive a restricted profile; native sandbox support requires
  host integration and verification.

## Extend presentation

Create a separate `presentation.json` package to customize themes, controls, core semantic
views or the workbench. Start with the [package contract](presentation-package.md),
[build tools](../packages/presentation-tools/), and the independent
[shadcn](../packages/presentation-shadcn/) or [Material 3](../packages/presentation-material3/) examples.
The [0.3.0 release guide](presentation-release-0.3.0.md) describes installation and offline SDKs.

Executable packages return restricted visual trees from a terminable Worker; a trusted
iframe bridge renders them and forwards host-validated actions. Packages cannot directly
access DOM, network, storage or Tauri IPC. Unprovided surfaces inherit host defaults;
management, approvals and recovery remain with the host. Capability Manifest v2 presentation
metadata does not grant this execution path: capability data views still use semantic contributions.

For a host-integrated presentation, start with
[`default-presentation.ts`](../src/lib/workbench/plugins/default-presentation.ts),
[workbench adapters](../src/lib/workbench/presentation-adapters.ts) and
[`@aibo/web-presentation`](../packages/web-presentation/). Preserve core collection, detail,
settings and inspector semantics, declared snapshot compatibility, and a core fallback for
optional renderers. Dispose local views without losing host-owned execution state.

Use `UiKitAdapter` and the [UI kit registry](../src/lib/ui-kit/registry.ts) for skin changes.
App components import visuals only through `$lib/ui-kit`; business controllers do not depend
on Svelte or concrete API implementations. Layout and icon placement belong to presentation;
authorization, action meaning and business results belong to the host.

## Validate before sharing

```sh
pnpm run verify
cargo test --manifest-path src-tauri/Cargo.toml
pnpm run probe:session:capabilities
```

`verify` includes protocol packaging and architecture checks. Session workflow tests use
fake engines and do not establish real-model compatibility. Run relevant native probes
separately; see the [probe guide](native-engine-probes.md). Never publish raw credentials or
unredacted provider logs in a package, fixture or bug report.
