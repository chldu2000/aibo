<script lang="ts">
  import type { UiFileChangeMarkProps } from '../../contract';
  import { locale } from '$lib/i18n/runtime';
  import { fileChangeState } from '../../file-change';
  let { kind, decorative = false }: UiFileChangeMarkProps = $props();
  const state = $derived(fileChangeState(kind, $locale));
</script>

<span class="file-change-mark" data-kind={kind} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : state.label} aria-hidden={decorative ? 'true' : undefined} title={state.label}>{state.symbol}</span>
