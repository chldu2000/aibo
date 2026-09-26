import type { UiKitAdapter, UiKitRegistration } from '../contract';
import { builtinRegistration } from './theme-catalog';
import { sharedControls } from './shared-controls';
import Icon from './ak-ui/Icon.svelte';
import AgentStatusMark from './ak-ui/AgentStatusMark.svelte';
import metadata from './ak-ui/themes.json';

export const akUiKit: UiKitAdapter = { ...sharedControls, Icon, AgentStatusMark };
export const akUiKitRegistration: UiKitRegistration = {
  ...builtinRegistration(metadata), adapter: akUiKit,
};
