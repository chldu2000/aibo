import type { UiKitAdapter, UiKitRegistration, UiThemeRegistration } from '../contract';
import { sharedControls } from './shared-controls';
import Icon from './material3/Icon.svelte';
import AgentStatusMark from './material3/AgentStatusMark.svelte';
import metadata from './material3/themes.json';

export const material3UiKit: UiKitAdapter = { ...sharedControls, Icon, AgentStatusMark };
export const material3UiKitRegistration: UiKitRegistration = {
  ...metadata, themes: metadata.themes as UiThemeRegistration[], adapter: material3UiKit,
};
