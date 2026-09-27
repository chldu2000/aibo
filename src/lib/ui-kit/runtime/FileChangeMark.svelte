<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiFileChangeMarkProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiFileChangeMarkProps = $props();
  const Component = $derived($activeUiKit.FileChangeMark);
</script>

<PublicControl control="FileChangeMark" {props}><Component {...props} /></PublicControl>
