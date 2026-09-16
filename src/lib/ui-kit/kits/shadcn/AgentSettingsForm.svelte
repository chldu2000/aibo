<script lang="ts">
  import Form from '../shared/AgentSettingsForm.svelte';
  import type { UiAgentSettingsFormProps } from '../../contract';
  let props: UiAgentSettingsFormProps = $props();
</script>
<div class="agent-settings-surface"><Form {...props} /></div>
<style>
  .agent-settings-surface { padding: 1rem; border: 1px solid var(--aibo-border); border-radius: .5rem; background: var(--aibo-surface); color: var(--aibo-text); }
  .agent-settings-surface :global(.agent-settings-form) { display: flex; flex-direction: column; gap: 1rem; }
  .agent-settings-surface :global(h3) { margin: 0; font-size: 1rem; font-weight: 600; }
  .agent-settings-surface :global(p), .agent-settings-surface :global(small) { margin: .25rem 0; color: var(--aibo-subtle); font-size: .8rem; line-height: 1.5; }
  .agent-settings-surface :global(.agent-settings-field) { display: flex; flex-direction: column; gap: .4rem; }
  .agent-settings-surface :global(footer), .agent-settings-surface :global(.agent-settings-inheritance) { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .agent-settings-surface :global(select) { padding: .6rem; border: 1px solid var(--aibo-border); border-radius: .5rem; background: var(--aibo-bg); color: var(--aibo-text); font: inherit; }
  .agent-settings-surface :global(input[type="checkbox"]) { width: 1.2rem; height: 1.2rem; accent-color: var(--aibo-accent); }
  .agent-settings-surface :global(select:focus-visible), .agent-settings-surface :global(input:focus-visible) { outline: 2px solid var(--aibo-focus); outline-offset: 2px; }
  .agent-settings-surface :global([role="alert"]) { color: var(--aibo-danger-text); }
</style>
