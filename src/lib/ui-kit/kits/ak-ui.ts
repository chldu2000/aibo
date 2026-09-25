import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';
import { sharedControls } from './shared-controls';
import Icon from './ak-ui/Icon.svelte';
import AgentStatusMark from './ak-ui/AgentStatusMark.svelte';
import metadata from './ak-ui/themes.json';

export const akUiKit: UiKitAdapter = { ...sharedControls, Icon, AgentStatusMark };
export const akUiKitRegistration: UiKitRegistration = {
  ...metadata, themes: metadata.themes as UiThemeRegistration[], adapter: akUiKit,
};
