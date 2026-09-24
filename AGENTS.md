# Aibo agent instructions

## Host business logic and agent capabilities

These rules apply to every host business logic change, including frontend,
backend, session lifecycle, permissions, menus, and command routing.

- Drive agent-dependent behavior through generic capability contracts,
  plugin declarations, or negotiated runtime capabilities. Do not hardcode
  branches or lookup tables keyed by agent names, plugin IDs, executable
  names, or equivalent identity checks to select business behavior.
- When agents need different behavior, extend the shared capability model
  and let plugins supply the relevant declarations or implementations.
  Keep vendor-specific protocol mapping and compatibility logic inside the
  corresponding plugin or adapter, outside generic host policy and UI.
- Treat declarations as capability requests, not authorization grants. The
  host validates contracts and enforces installation grants and workspace
  policy through generic rules; plugins retain their native enforcement
  responsibilities.
- Define explicit behavior for absent or unsupported capabilities without
  inferring support from agent identity. A new plugin implementing the same
  contract must work without changes to host business logic.
- Before handing off a host logic change, inspect the affected paths for
  identity-based special cases and verify the behavior using capability
  combinations, including missing capabilities and a third-party plugin.

## Host and plugin ownership

For changes to plugin contracts, session routing, presentation state, actions,
or recovery, read [boundary lessons and regression requirements](docs/plugin-boundaries-and-regression.md).
For capability negotiation also read [session negotiation](docs/session-capability-negotiation.md);
for modes and permission ownership read [session controls](docs/session-controls.md);
for external rendering read [presentation package contracts](docs/presentation-package.md).

- The host owns authoritative workspace/session state, immutable release
  bindings, durable history and queues, recoverable drafts and view state,
  action admission, approval routing, and recovery. Capability plugins own
  native protocol mapping and execution under the negotiated policy.
  Presentation plugins own layout and visual expression of host snapshots.
- Keep plugin management, trusted approval, and default-presentation recovery
  outside replaceable presentation surfaces. A failing or disabled renderer
  must not discard business state or make these controls inaccessible.
- Negotiate manifest contracts, actual Runtime handshake operations, and
  session-open capabilities together. Keep support, current action availability,
  and execution authorization separate; revalidate at the host when executing.
- Presentation actions use host-issued tokens scoped to the current context
  and generation/revision. Renderers cannot construct arbitrary IPC calls,
  capability requests, or permissions. Preserve the narrow host-owned local
  input exception without relaxing send, navigation, or approval checks.
- Dispatch existing sessions through their pinned installation/contribution;
  reuse matching live runtime generations and resume after shutdown. Failed
  upgrades or presentation candidates retain the last confirmed working state.
- Changing models, modes, skins, or layouts must preserve unrelated history,
  settings, drafts, attachments, queue items, and pending interactions according
  to their ownership and scope. Define any intended reset explicitly.

## UI architecture hard rules

These rules are mandatory for every UI change. They are enforced by the
architecture tests; documentation alone is not a substitute for the checks.
For changes to the default ak-ui kit's density, status, selection, hover,
truncation, or responsive behavior, read the
[current Aibo ak-ui spec](docs/design/ak-ui-current-spec.md).

- `src/lib/components/app/` and `src/App.svelte` may import visual components
  only from `$lib/ui-kit`.
- Never import `$lib/components/ui`, Lucide, Material Symbols, or another
  concrete UI library from an app-level component.
- Never branch on a skin ID (`shadcn`, `material3`, `data-ui-kit`, or
  `data-ui-theme`) from page or business behavior. Skin selection belongs to
  `src/lib/ui-kit/registry.ts` and skin implementations.
- New composite controls whose appearance differs between skins must extend
  `UiKitAdapter`. Pass semantic data and callbacks from the app layer; do not
  pass skin-specific classes or colors.
- App-layer CSS may express layout constraints only: display, position,
  sizing, flex/grid, spacing, overflow, ordering, containment and z-index.
  Colors, borders, radii, shadows, typography, icon language, focus feedback,
  transitions and animations belong to the active skin.
- Do not add raw color values, skin-specific CSS classes, or kit-specific CSS
  variables to app components or new app-layer CSS.
- Business modules under `src/lib/app/` must remain independent of Svelte,
  UI components, and concrete API implementations.

## Required verification

Before handing off a change, run:

```sh
pnpm run verify
```

For every implementation change or new feature, identify affected producers,
consumers, and shared paths before editing. Add a regression that detects the
original failure where applicable, then verify both the changed behavior and
the existing behavior it must preserve. Follow the impact matrix in
[boundary lessons and regression requirements](docs/plugin-boundaries-and-regression.md#regression-gate).
Passing only the new feature's test is not sufficient.

Changes to shared contracts must cover supported, absent, and rejected
capabilities, an unrelated provider, and old supported declarations. UI changes
must cover the registered built-in ak-ui kit in light and dark themes and any
affected external presentation surface, including inheritance and failure
recovery. Rust execution/persistence changes
also require relevant Rust tests; `verify` does not run them or browser/native
probes. Report commands, results, and any unverified boundary explicitly.
An unexplained failure blocks a claim that regression verification passed;
do not delete coverage or narrow old assertions to accommodate new behavior.

If a rule is intentionally changed, update the UI contract, architecture
tests, and `docs/ui-architecture.md` in the same change. Do not weaken a test
to make an implementation pass.

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
