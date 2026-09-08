<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiPluginViewProps, UiPluginViewInteraction } from '../plugin-view';

  let props: UiPluginViewProps = $props();
  let state = $state<UiPluginViewInteraction>({ fields: {}, expanded: {} });
  const Component = $derived($activeUiKit.PluginView);
</script>

<Component {...props} interaction={props.interaction ?? state} />
