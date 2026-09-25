<script lang="ts">
  import Icon from '../../runtime/Icon.svelte';
  import type { UiSessionControlMarkProps } from '../../contract';
  import { sessionControlAppearance } from '../../session-control-appearance';
  let { control, compact = false }: UiSessionControlMarkProps = $props();
  const appearance = $derived(sessionControlAppearance(control));
</script>

<span class="session-control-mark" class:compact data-tone={appearance.tone} aria-hidden="true">
  <Icon name={appearance.icon} size={16} />
</span>
