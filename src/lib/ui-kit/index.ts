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
  UiAgentStatusMarkProps,
  UiAgentSettingsFormProps,
  UiButtonVariant,
  UiColumnSplitterProps,
  UiIconName,
  UiHostPanelProps,
  UiGoalBarProps,
  UiManagementCenterProps,
  UiManagementSection,
  UiSettingsAction,
  UiSettingsItem,
  UiSettingsSectionProps,
  UiKitAdapter,
  UiKitOption,
  UiKitRegistration,
  UiModelMatrixCell,
  UiModelMatrixColumn,
  UiModelMatrixProps,
  UiModelMatrixRow,
  UiThemeRegistration,
  UiWorkbenchChromeProps,
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
export { default as PresentationHost } from './PresentationHost.svelte';

export { default as DefaultPresentationActions } from '../workbench/plugins/DefaultPresentationActions.svelte';
