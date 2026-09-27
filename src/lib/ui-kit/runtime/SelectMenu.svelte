<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSelectMenuProps } from '../contract';
  let props: UiSelectMenuProps = $props();
  const Component = $derived($activeUiKit.SelectMenu);
</script>
<Component {...props} />
