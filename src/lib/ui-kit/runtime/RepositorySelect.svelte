<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiRepositorySelectProps } from '../contract';
  let props: UiRepositorySelectProps = $props();
  const Component = $derived($activeUiKit.RepositorySelect);
</script>

<Component {...props} />
