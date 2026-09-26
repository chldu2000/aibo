import type { UiKitAdapter, UiKitRegistration } from '../contract';
import { builtinRegistration } from './theme-catalog';
import { sharedControls } from './shared-controls';
import Icon from './material3/Icon.svelte';
import AgentStatusMark from './material3/AgentStatusMark.svelte';
import metadata from './material3/themes.json';

export const material3UiKit: UiKitAdapter = { ...sharedControls, Icon, AgentStatusMark };
export const material3UiKitRegistration: UiKitRegistration = {
  ...builtinRegistration(metadata), adapter: material3UiKit,
};
