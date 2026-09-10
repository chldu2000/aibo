<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { Snapshot } from '../presentation/contract';
  import type { PresentationProps } from './types';
  import { SemanticView } from '$lib/ui-kit';
  let { snapshot, ...props }: Omit<PresentationProps, 'snapshot'> & { snapshot: Writable<Snapshot> } = $props();
</script>
<SemanticView snapshot={$snapshot} {...props} />
