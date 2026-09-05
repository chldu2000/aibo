/**
 * Stable visual-component seam for the application layer.
 *
 * App-level components import primitives from this module instead of binding
 * themselves to a particular component-library implementation. A replacement
 * kit should preserve the public props (`variant`, `size`, `class`, children,
 * and native attributes) and can be wired here without touching business code.
 */
export * from './primitives';
export type {
  AppearanceSelection,
  UiButtonVariant,
  UiIconName,
  UiKitAdapter,
  UiKitOption,
  UiKitRegistration,
  UiThemeRegistration,
} from './contract';
export {
  activeTheme,
  activeThemeStyle,
  activeUiKit,
  activeUiKitName,
  appearanceSelection,
  availableUiKits,
  setUiKit,
  setUiTheme,
} from './registry';
export type { UiKitName } from './registry';
