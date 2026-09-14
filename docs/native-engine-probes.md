# Native engine probes

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
native RPC diagnostic path with a real model turn, run `pnpm probe:pi:rpc -- --smoke`.

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

For application setup, see the [English README](../README.md) or [中文 README](../README_zh.md).
