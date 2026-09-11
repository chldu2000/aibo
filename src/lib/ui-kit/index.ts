/**
 * Stable visual-component seam for the application layer.
 *
 * App-level components import primitives from this module instead of binding
 * themselves to a particular component-library implementation. A replacement
 * kit should preserve the public props (`variant`, `size`, `class`, children,
 * and native attributes) and can be wired here without touching business code.
 */
export * from './primitives';
export type { UiPluginViewProps, UiPluginViewDocument, UiPluginViewNode, UiPluginViewInteraction } from './plugin-view';
export type {
  AppearanceSelection,
  UiAgentStatusMarkProps,
  UiButtonVariant,
  UiColumnSplitterProps,
  UiIconName,
  UiKitAdapter,
  UiKitOption,
  UiKitRegistration,
  UiModelMatrixCell,
  UiModelMatrixColumn,
  UiModelMatrixProps,
  UiModelMatrixRow,
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

// Trusted local lifecycle shell; visuals continue to use the active kit.
export { default as WorkbenchPresentation } from '../workbench/WorkbenchPresentation.svelte';
