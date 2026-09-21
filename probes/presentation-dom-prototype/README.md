# Framework-independent DOM presentation — throwaway P0 prototype

This is an experiment, not an installable presentation package or production SDK.
It answers three questions: can React and Svelte use the same host snapshot/action
directory; can a DOM renderer forge host confirmation; and does a DOM infinite loop
block the host in a WKWebView iframe versus a separate WKWebView?

The host imports the existing conversation action directory. The two renderers
manage their own DOM and only receive data/messages. In these initial standalone probes, side effects are in-memory
counters: no Agent, real send, Git write or approval API is connected. A valid send
request requires a trusted host click, and confirmation rechecks current state.
The intentionally small gate covers draft/send, not the complete production action
catalogue. It is not a production security boundary or resource limiter.

From the Aibo root, after the usual `pnpm install`:

```sh
npm ci --prefix probes/presentation-dom-prototype --ignore-scripts
npm --prefix probes/presentation-dom-prototype run probe:browser
npm --prefix probes/presentation-dom-prototype run probe:native
npm --prefix probes/presentation-dom-prototype run probe:ipc
```

React/React DOM are pinned in this directory only. Svelte, esbuild and Playwright
come from the existing workspace dependencies; this prototype does not establish
repository-independent plugin packaging. Each browser/native command rebuilds a
single self-contained `dist/iframe.html` which can also be opened directly to
explore mounting, state retention, requests and confirmation. The native experiment
uses `dist/webview.html`. Build results and experiment JSON live under ignored `dist/`.

The macOS native runner compiles a standalone Swift WKWebView host and an AXPress
helper. It only targets the spawned probe PID and its explicitly titled window.
Native accessibility automation must be available. This verifies trusted native
accessibility input, not hardware mouse/keyboard input or screen-reader coverage.
Each experiment has an external 45-second watchdog. Do not run the loop scenario
in a valuable browser tab; iframe starvation is an expected negative result.

The IPC experiment launches the actual Tauri app with a unique application
identifier and a WebView having no matching capability. It only calls
`list_workspaces`, records whether it was allowed and the list length, and shuts
down its own process group. It does not read or delete the user's Aibo data.
The isolated application support directory may remain for inspection.

Captured initial results: React/Svelte shared drafts; forged confirmation rejected;
iframe DOM loop starved the WKWebView host; a separate nonpersistent WKWebView left
the host responsive, allowed AXPress confirmation during the loop and could be
replaced. An ungranted Tauri WebView could call the application command. These
findings do not enable DOM plugins: production IPC admission, integrated trusted
approvals/recovery, resource pressure and platform qualification remain mandatory.

Prototype source is retained on `prototype/presentation-dom-p0`; production work
must reimplement only validated decisions behind the published interfaces.


## Integrated Tauri gate experiment (second round)

From the repository root, run **serially**, since existing probes share a Vite port:

```sh
node probes/presentation-dom-prototype/tauri-app.mjs
node probes/presentation-dom-prototype/audit.mjs
```

This runner mounts the actual App and adds a native child WebView with an opt-in
`presentation-dom-p0` debug Cargo feature. It tests an application ACL manifest,
registered/unregistered callers, native suspension, a real Git stage approval in a
temporary repository, CPU loop/close, finite memory and message pressure, long
history updates, resizing and replacement after a precise content-process crash.
The child still renders fixture data, not a complete workbench. AXPress is native
accessibility automation, not physical input. A unique application identifier
isolates data. The temporary repository is removed; app-support data may remain.

PID lookup uses the private WebKit `_webProcessIdentifier` selector **only for
measurement and targeted fault injection**. It is not a supported production
termination API. The runner kills only the diagnosed experimental content PID;
all native process-group cleanup is limited to the process it launched.

`dist/tauri-app-result.json` contains observations; `completed: true` means the
probe ran to completion, **not that P0 passed**. Host command compatibility and
resource reclamation can fail while the probe completes. See the
[gate assessment](../../docs/presentation-framework-p0-gates.md).
`action-policy.json` is an exhaustive candidate classification, not an implemented
authorization grant. The audit checks coverage of 118 operations and 107 host
commands; it does not substitute for native invocation or user-intent tests.

This second experiment is retained on `prototype/presentation-dom-p0-gates`.
Production loading and release builds must not enable the experiment feature.
