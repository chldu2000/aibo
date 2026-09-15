<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiWorkbenchChromeProps } from '../contract';
  let props: UiWorkbenchChromeProps = $props();
  const Component = $derived($activeUiKit.WorkbenchChrome);
</script>

<Component {...props} />
