<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { Snapshot } from '../presentation/contract';
  import type { PresentationProps } from './types';
  import { SemanticView } from '$lib/ui-kit';
  let { snapshot, focusTarget, ...props }: Omit<PresentationProps, 'snapshot' | 'focusTarget'> & { snapshot: Writable<Snapshot>; focusTarget: Writable<string | null> } = $props();
</script>
<SemanticView snapshot={$snapshot} focusTarget={$focusTarget} {...props} />
