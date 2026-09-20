<script lang="ts">
 import { activeUiKit } from '../registry';
 import type { UiAttachmentListProps } from '../contract';
 let props: UiAttachmentListProps = $props();
 const Component = $derived($activeUiKit.AttachmentList);
</script>
<Component {...props} />
