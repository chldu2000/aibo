# Business module rules

- Keep modules framework-independent: no imports from Svelte, UI components,
  or concrete API implementations.
- Expose pure state transitions and dependency-injected controllers to the
  page layer.
- Do not add presentation classes, colors, theme IDs, or skin branches to
  domain and lifecycle logic.
