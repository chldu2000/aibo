<script lang="ts">
  import View from '../shared/PluginView.svelte';
  import type { UiPluginViewProps } from '../../plugin-view';
  let props: UiPluginViewProps = $props();
</script>

<div class="plugin-view"><View {...props} /></div>

<style>
  .plugin-view { --plugin-radius: 0.5rem; --plugin-panel: var(--card); --plugin-ink: var(--foreground); --plugin-line: var(--border); --plugin-focus: var(--ring); --plugin-accent: var(--primary); --plugin-on-accent: var(--primary-foreground); }
</style>
