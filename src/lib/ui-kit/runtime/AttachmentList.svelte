<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiAttachmentListProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiAttachmentListProps = $props();
  const Component = $derived($activeUiKit.AttachmentList);
</script>

<PublicControl control="AttachmentList" {props}><Component {...props} /></PublicControl>
