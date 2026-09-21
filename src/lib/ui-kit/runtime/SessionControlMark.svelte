<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSessionControlMarkProps } from '../contract';
  let props: UiSessionControlMarkProps = $props();
  const Component = $derived($activeUiKit.SessionControlMark);
</script>
<Component {...props} />
