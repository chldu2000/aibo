# Aibo agent instructions

## Required reading

Read the applicable documents before editing; follow their current contracts and
regression requirements. Historical records explain earlier versions, not current rules.

| Change | Read |
| --- | --- |
| Domain terminology, identity, or ownership | [Domain language](CONTEXT.md) |
| Host business logic, plugin contracts, session routing, state, actions, or recovery | [Host/plugin boundaries](docs/plugin-boundaries-and-regression.md) |
| Database schema, migration SQL, historical SQL fixtures, or migration validation | [Database migrations](docs/database-migrations.md) |
| UI components, layout, styling, presentation lifecycle, or extension boundaries, including `src/lib/workbench/` | [UI architecture](docs/ui-architecture.md) |
| Default ak-ui appearance or interaction | [Current ak-ui spec](docs/design/ak-ui-current-spec.md) |
| Capability declarations, discovery, or negotiation | [Session negotiation](docs/session-capability-negotiation.md) |
| Session modes, permission controls, or execution policy | [Session controls](docs/session-controls.md) |
| External presentation packages, snapshots, actions, or rendering | [Presentation package contract](docs/presentation-package.md) |

## Cross-cutting constraints

- Select host business behavior through generic contracts and negotiated
  capabilities, never Agent names, plugin IDs, executable names, or equivalent
  identity branches. Keep vendor protocol mapping in the corresponding plugin
  or adapter. Define missing-capability behavior explicitly.
- Keep feature support, current action availability, and execution authorization
  separate. Declarations do not grant permissions; the host revalidates execution.
- Preserve host-owned state and pinned session bindings across presentation or
  configuration changes. Management, approval, and recovery remain reachable
  outside replaceable presentation surfaces.
- Keep applied or committed database migrations byte-for-byte immutable. Change
  the schema through a new migration with a higher version; preserve historical
  SQL and upgrade fixtures under the [migration rules](docs/database-migrations.md).
- App and trusted workbench components use `$lib/ui-kit` for visual components
  and only layout CSS. Business modules remain independent of Svelte, UI, and
  concrete API implementations. The UI architecture defines the complete boundary,
  including internal adapters and external Presentation packages.

## Required verification

Before implementation, identify affected producers, consumers, and shared paths.
Follow the [regression matrix](docs/plugin-boundaries-and-regression.md#regression-gate)
for both changed and preserved behavior, including applicable browser and Rust checks.
Before handing off any change, run from this repository root:

```sh
pnpm run verify
```

`verify` does not run browser/native probes or Rust tests. For documentation-only
changes, also check links; unrelated runtime probes are not required. Report actual
commands, results, and unverified boundaries. Investigate failures rather than
weakening coverage to pass. When intentionally changing an architectural rule,
update its contract, enforcing tests, and architecture documentation together.

## Git commit guidance

Commit messages must follow Conventional Commits. Use the subject format
`<type>[optional scope][!]: <description>`, for example
`feat(session): add resume support` or `docs: clarify commit guidance`.
Use `feat` for new features, `fix` for bug fixes, and an appropriate type such
as `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, or `style` for
other changes. Mark breaking changes with `!` before the colon or a
`BREAKING CHANGE: <description>` footer. Separate any body and footer blocks
from the subject with blank lines.

When creating a Git commit, add the agent that made the change as a co-author
using a standard trailer with the agent's own name and email address:

```text
Co-authored-by: <agent name> <agent email>
```
