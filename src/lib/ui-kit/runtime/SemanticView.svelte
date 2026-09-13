<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { PresentationProps } from '../presentation-props';
  import { externalPresentation } from '../external-presentation';
  import ExternalSemanticView from './ExternalSemanticView.svelte';
  let props: PresentationProps = $props();
  const Component = $derived($activeUiKit.SemanticView);
  let failure = $state('');
  $effect(() => { $externalPresentation; failure = ''; });
</script>
{#if $externalPresentation?.package.release.manifest.surfaces?.includes('semantic') && !failure}
  <ExternalSemanticView presentation={$externalPresentation} {props} failed={error => { failure = error.message; }} />
{:else}
  {#if failure}<p role="status">外部语义视图不可用，已恢复默认视图：{failure}</p>{/if}
  <Component {...props} />
{/if}
