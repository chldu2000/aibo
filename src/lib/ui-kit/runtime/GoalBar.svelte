<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiGoalBarProps } from '../contract';
  let props: UiGoalBarProps = $props();
  const Component = $derived($activeUiKit.GoalBar);
</script>
<Component {...props} />
