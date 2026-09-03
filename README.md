# Aibo

Aibo is a local multi-agent workbench. It owns workspace and session management, renders a unified interface, and exchanges reviewable context between headless agent runtimes.

The first supported runtimes are Codex and Pi. The product architecture and phased delivery plan are documented in [docs/aibo-research-and-delivery-plan.md](docs/aibo-research-and-delivery-plan.md); the macOS-first freeze is recorded in [docs/architecture-freeze.md](docs/architecture-freeze.md).

## Current status

Phase 0 protocol probes are complete on the local macOS validation host, and the architecture is frozen for a macOS-first release. Codex App Server and both Pi paths (the locked SDK host and the RPC compatibility path) have passed real streaming, abort, and history-resume smoke checks. Windows is a follow-up compatibility gate after native Pi login. Phase 1 Codex real-session acceptance is complete on the local macOS host: the Svelte 5 + Tauri 2 shell, Rust Core, SQLite projection, stdio App Server adapter, streaming timeline, interruption, and restart resume passed the real UI gate. Phase 2 has started with Codex approval request projection and explicit allow/deny actions. Pi remains out of this slice.

## Phase 1 Codex vertical slice

The macOS-first shell provides workspace CRUD, canonical path validation, explicit trust state, SQLite/WAL migrations, Codex/Pi installation diagnostics, and a Codex session timeline. Create a workspace, start a Codex session, send a read-only prompt, observe streamed output, and restart the app to exercise the persisted projection. Run the desktop development app with:

```sh
pnpm install
pnpm tauri dev
```

The browser-only `pnpm dev` command remains useful for UI preview; it uses clearly marked sample data and does not persist workspace changes.

## Phase 2 Codex capability expansion

The first Phase 2 batch adds an explicit approval path. Codex requests use the `on-request` policy while retaining the read-only sandbox. Aibo projects the request as a reviewable card and sends an explicit `accept` or `cancel` decision; it never auto-approves. Thread listing, fork/archive, and full tool event projection remain subsequent batches.

## Phase 0 probes

Requirements:

- Node.js 22 or later
- `codex` on `PATH` for the Codex probe
- `pi` on `PATH` for the Pi RPC/model probe
- project dependencies installed with `pnpm install` for the Pi SDK probe
- Native agent authentication for a real-model smoke turn

Transport and session-state checks do not call a model. The Pi SDK probe
executes the read-only command `node --version` through the platform-native
shell tool, then persists and reopens a Pi session. The Pi RPC probe is also
retained to expose platform/protocol differences:

```powershell
pnpm probe:codex
pnpm probe:pi
```

The Pi paths can also be run independently:

```powershell
pnpm probe:pi:sdk
pnpm probe:pi:rpc
```

`pnpm probe:pi:smoke` exercises the project-locked SDK host. To exercise the
RPC compatibility path with a real model turn, run `pnpm probe:pi:rpc -- --smoke`.

Add `--smoke` to run a minimal model turn with all mutation tools disabled or read-only:

```powershell
pnpm probe:codex:smoke
pnpm probe:pi:smoke
```

The Codex approval probe asks the model to attempt one read-only command and has
the probe client reject the approval request:

```powershell
pnpm probe:codex:approval
```

Probe output is written below `.aibo/probe/runs/` and is ignored by Git because raw agent events can contain local metadata. Only redacted summaries and fixtures may be committed.

Executable paths can be overridden with `AIBO_CODEX_BIN` and `AIBO_PI_BIN`.
