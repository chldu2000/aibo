# Aibo

Aibo is a local coding workbench composed of a plugin host, capability plugins,
and presentation plugins. Codex and Pi run through the shared capability Broker;
the host owns workspace trust, sessions, approvals, and history.

See the [current documentation](docs/README.md) for architecture and supported
contracts. Previous plans, designs, and phase reports are in the
[documentation archive](docs/archive/README.md).

## Development

```sh
pnpm install
pnpm tauri dev
```

Use `pnpm dev` for browser UI preview and `pnpm run verify` for architecture,
type, test, and frontend build checks.

## Capability sessions

Codex and Pi run as v2 capability plugins through the shared Aibo Broker.
The host owns session identity, approvals, history and recovery admission;
plugins own their native engines. Pi uses the project-locked
`@earendil-works/pi-coding-agent` SDK. Workspace tools return through the
host gateway, including approved writes and commands.

The old Agent runtime and Pi JSONL host are retired. Old sessions without a
v2 capability binding are read-only. Offline process tests cover the new
session protocol and the Pi workflow:

```sh
pnpm run probe:session:capabilities
```

These tests include opening the installed Pi SDK, but do not make real-model
requests. Migration status and remaining validation are tracked in
[the migration record](docs/capability-session-migration.md).

## Native engine probes

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
