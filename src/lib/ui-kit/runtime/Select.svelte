<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSelectProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiSelectProps = $props();
  const Component = $derived($activeUiKit.Select);
</script>

<PublicControl control="Select" {props}><Component {...props} /></PublicControl>
