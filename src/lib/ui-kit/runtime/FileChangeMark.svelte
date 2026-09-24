<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiFileChangeMarkProps } from '../contract';
  let props: UiFileChangeMarkProps = $props();
  const Component = $derived($activeUiKit.FileChangeMark);
</script>

<Component {...props} />
