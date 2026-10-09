# Independent tool views, version 1

`toolView` is a capability-plugin contribution for an interactive local application in
the tool panel. It is distinct from a semantic view and from a Presentation Worker.
The plugin owns its frontend, backend and domain state. The host owns installation
trust, the window/workspace identity, isolation, IPC routing and shutdown supervision.
The initial consumer is the external terminal plugin in `aibo-plugins`.

This contract requires host **0.1.1** (source implementation; not a claim that a release
has been published). Older hosts cannot execute this contribution. Existing semantic
views and PresentationNode restrictions remain unchanged.

## Manifest and installation

A v2 manifest declares a required contribution:

```json
{
  "kind": "toolView",
  "id": "dev.example.tools.console",
  "scope": "workspace",
  "required": true,
  "title": "Console",
  "contractVersion": "1.0.0",
  "frontend": "frontend.html",
  "backend": "tool-backend",
  "permissions": ["local.process"]
}
```

Both paths must identify files inside the immutable package. The package digest is
rechecked before a view is opened. The backend is a native executable for the declared
platform, with its runtime dependencies shipped in the package. There is no implicit
Node lookup or shell command-line interpolation. The frontend is a self-contained HTML
file of at most 4 MiB. Shared wire types are in `packages/plugin-protocol/src/tool-view.ts`.
Enabling the plugin authorizes its declared local-process behavior; this is independent
of any Agent's chat execution profile. No Agent tool catalog exposes this channel.

## Ownership and rendering

An instance is keyed by the native caller window label, workspace, installation and
contribution. A random instance ID routes requests; another window cannot use it.
Mounting a view, switching chats, hiding a panel or switching workspaces does not stop
its backend. Tool tabs are remembered only during the current app lifetime, not restored
from persistent layout. Frontend reconstruction reconnects to the same live backend.

The host serves verified HTML through `aibo-tool`, checking the caller window and a
live document ID. Responses are `no-store`, with an independent CSP that denies network,
frames, forms and external resources. The iframe uses only `sandbox="allow-scripts"`:
no same-origin access, Tauri access, popups or top-level navigation. A fresh MessagePort
is transferred on the initial load only. Unmounting revokes it; unexpected navigation
disconnects it. The native supervisor rechecks installation enablement on requests.

Built-in workbenches use the sidebar tool slot. An external workbench can open the same
tool through its existing contribution/sidebar action, but executable tool content is
hosted in a fixed host panel outside the replaceable Presentation surface. The external
skin never receives terminal bytes or executable tool resources.

## Backend protocol

Stdin/stdout carry one JSON object per line. There is exactly one outstanding request
per backend. Every envelope has `protocol: "aibo.tool-view/1"`.

| Method | Parameters | Successful result |
| --- | --- | --- |
| `initialize` | `{workspacePath, workspaceId, windowId}` | `{protocol:"aibo.tool-view/1"}` |
| `request` | Plugin-defined JSON | Plugin-defined JSON |
| `status` | `null` | `{active: number}` for shutdown confirmation |
| `shutdown` | `null` | `null`, after stopping owned work |

Responses contain `result` or a bounded `error` string. Stdout is exclusively protocol;
backend stderr is discarded rather than persisted. Frames are bounded to 1 MiB and a
request deadline is 10 seconds. Timeout, EOF or invalid framing fails the runtime; it
is not automatically restarted. The browser bridge limits requests to 128 KiB and 128
queued messages. Output and requests never enter `capability_events` or chat history.

The host provides `AIBO_TOOL_SETTINGS`, a validated private `tool-settings` instance
inside existing plugin storage. Configuration may be stored there. This does not
permit the terminal implementation to persist output or scrollback.

## Closing and faults

Closing a tool tab, disabling/removing/replacing the plugin, removing its workspace,
closing its window and quitting the app coordinate through the supervisor. Active
work prompts once per affected operation; cancellation retains the runtime. Window
closure affects that window only; plugin disable/removal and app exit cover all windows.
Removing a workspace from Aibo is global and closes its instances in all windows.
The frontend and backend lifetimes are separate. Frontend failure preserves the backend;
backend failure requires user action to open a fresh instance. The plugin must provide
OS-appropriate child cleanup even when its backend terminates unexpectedly.

## Regression checks

Run host `pnpm run verify`, native `cargo test --manifest-path src-tauri/Cargo.toml --lib tool_views`,
`node probes/tool-view-browser.mjs` and macOS `node probes/tool-view-native.mjs` after
building the external terminal. The browser probe uses a real PTY and the real isolated
component; the native probe covers installation, discovery, actual App tool entry,
custom-scheme rendering and handle revocation. Neither establishes Windows/Linux runtime
acceptance. Keep the existing semantic sidebar, plugin installation and presentation
regressions passing.

公开协议类型位于 `@aibolabs/plugin-protocol` 的 `tool-view.ts`，随本次未发布的 Host SDK 0.1.11 同步。既有已发布的 0.1.10 快照保持不可变。

### Parent-refresh regression

The tool component initializes once per keyed owner or explicit reload. Its injected
`open` callback runs outside Svelte dependency tracking: callback props and reactive
state read by the callback must not invalidate the frame lifecycle. The App keys both
mount sites by workspace and contribution identity, so an actual owner change still
remounts the frame. Ordinary parent refreshes preserve the iframe, MessagePort and focus.

`probes/ToolViewHarness.svelte` refreshes parent state every 50 ms while the browser probe
asserts iframe identity and performs real terminal keyboard I/O. The native probe also
checks that each skin retains its iframe across six seconds of actual App refreshes.
The earlier constant-callback browser fixture did not exercise this failure mode.

The regression was observed before the fix as `host refresh must preserve the terminal
iframe` failing. After isolating callback execution with `untrack`, both browser skins
passed frame stability, sustained keyboard I/O, Ctrl+C and reconnect checks. The macOS
native App probe passed `stableFrame` and real PTY checks for both skins; host `verify`
passed 41 architecture checks, 666 tests, type checking and production build. No plugin
package or native protocol change is needed for this host lifecycle correction.
