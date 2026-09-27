<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiGoalBarProps } from '../contract';
  import PublicControl from './PublicControl.svelte';

  let props: UiGoalBarProps = $props();
  const Component = $derived($activeUiKit.GoalBar);
</script>

<PublicControl control="GoalBar" {props}><Component {...props} /></PublicControl>
