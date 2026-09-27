<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSessionControlMarkProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiSessionControlMarkProps = $props();
  const Component = $derived($activeUiKit.SessionControlMark);
</script>

<PublicControl control="SessionControlMark" {props}><Component {...props} /></PublicControl>
