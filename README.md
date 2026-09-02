# Aibo

Aibo is a local multi-agent workbench. It owns workspace and session management, renders a unified interface, and exchanges reviewable context between headless agent runtimes.

The first supported runtimes are Codex and Pi. The product architecture and phased delivery plan are documented in [docs/aibo-research-and-delivery-plan.md](docs/aibo-research-and-delivery-plan.md); the macOS-first freeze is recorded in [docs/architecture-freeze.md](docs/architecture-freeze.md).

## Current status

Phase 0 protocol probes are complete on the local macOS validation host, and the architecture is frozen for a macOS-first release. Codex App Server and both Pi paths (the locked SDK host and the RPC compatibility path) have passed real streaming, abort, and history-resume smoke checks. Windows is a follow-up compatibility gate after native Pi login. Phase 1 now prepares the Svelte 5 + Tauri 2 application skeleton, workspace persistence, and diagnostics before real adapters are integrated.

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
