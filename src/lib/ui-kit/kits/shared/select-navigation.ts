type NavigableOption = { label: string; disabled?: boolean };

/** Arrow keys wrap across enabled options; Home/End jump to the first/last enabled one. */
export function stepEnabledOption(options: readonly NavigableOption[], active: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End') {
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  if (!enabled.length) return -1;
  if (key === 'Home') return enabled[0];
  if (key === 'End') return enabled.at(-1)!;
  const index = enabled.indexOf(active);
  return enabled[(index + (key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
}

/** Type-to-select: typing within 700ms extends the query; the first enabled label prefix match wins. */
export function createTypeahead() {
  let query = '', typedAt = 0;
  return {
    /** A space continues a recent query instead of confirming the active option. */
    continues: (key: string) => key === ' ' && query !== '' && Date.now() - typedAt <= 700,
    reset() { query = ''; },
    match(options: readonly NavigableOption[], key: string) {
      query = Date.now() - typedAt > 700 ? key : query + key; typedAt = Date.now();
      return options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
    },
  };
}
