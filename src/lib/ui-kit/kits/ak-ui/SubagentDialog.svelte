<script lang="ts">
  import Dialog from '../shared/SubagentDialog.svelte';
  import type { UiSubagentDialogProps } from '../../contract';
  let props: UiSubagentDialogProps = $props();
</script>
<Dialog {...props} />
