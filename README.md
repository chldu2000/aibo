# Aibo

Aibo is a local multi-agent workbench. It owns workspace and session management, renders a unified interface, and exchanges reviewable context between headless agent runtimes.

The first supported runtimes are Codex and Pi. The product architecture and phased delivery plan are documented in [docs/aibo-research-and-delivery-plan.md](docs/aibo-research-and-delivery-plan.md).

## Current status

Phase 0 protocol probes are in progress. The Codex and Pi RPC probes use Node.js built-ins; the Pi SDK probe pins the adapter dependency that supplies native PowerShell execution on Windows. This validates protocol and process behavior before the Svelte 5 + Tauri 2 application is scaffolded.

## Phase 0 probes

Requirements:

- Node.js 22 or later
- `codex` on `PATH` for the Codex probe
- `pi` on `PATH` for the Pi RPC/model probe
- project dependencies installed with `pnpm install` for the Pi SDK probe
- Native agent authentication for an optional real-model smoke turn

Transport and session-state checks do not call a model. On Windows the Pi SDK
probe executes the read-only command `node --version` through Pi's native
PowerShell tool, then persists and reopens a Pi session. The Pi RPC probe is
also retained to expose platform/protocol differences:

```powershell
pnpm probe:codex
pnpm probe:pi
```

The Pi paths can also be run independently:

```powershell
pnpm probe:pi:sdk
pnpm probe:pi:rpc
```

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
