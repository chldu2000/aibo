<script lang="ts">
  import type { UiFileChangeMarkProps } from '../../contract';
  import { fileChangeStates as states } from '../../file-change';
  let { kind, decorative = false }: UiFileChangeMarkProps = $props();
</script>

<span class="file-change-mark" data-kind={kind} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : states[kind].label} aria-hidden={decorative ? 'true' : undefined} title={states[kind].label}>{states[kind].symbol}</span>
