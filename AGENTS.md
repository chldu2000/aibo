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

## UI architecture hard rules

These rules are mandatory for every UI change. They are enforced by the
architecture tests; documentation alone is not a substitute for the checks.

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

If a rule is intentionally changed, update the UI contract, architecture
tests, and `docs/ui-architecture.md` in the same change. Do not weaken a test
to make an implementation pass.

## Git commit guidance

When creating a Git commit, add the agent that made the change as a co-author
using a standard trailer with the agent's own name and email address:

```text
Co-authored-by: <agent name> <agent email>
```
