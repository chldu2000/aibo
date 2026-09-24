# UI kit rules

- For default ak-ui density, status, selection, hover, truncation, and responsive
  changes, read the [current Aibo ak-ui spec](../../../docs/design/ak-ui-current-spec.md).
- This directory is the only application boundary for swappable visual
  implementations.
- Keep `UiKitAdapter` and its component props semantic and stable. A new
  composite control must be added to the contract, runtime proxy, and every
  registered skin.
- Skin implementations own visual decisions: color, shape, typography,
  icon mapping, focus/disabled states, transitions, and animation.
- Adapter components may normalize third-party DOM and spacing, but must not
  own session, Agent, or API state.
- Register theme colors as semantic tokens in the skin registration; do not
  make page components know a skin's token names.
