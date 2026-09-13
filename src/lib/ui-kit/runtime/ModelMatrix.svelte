<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiModelMatrixProps } from '../contract';
  import { getContext } from 'svelte';
  import { externalPresentation } from '../external-presentation';
  import { PRESENTATION_CONTROLS, type PresentationControlScope } from '../control-context';
  import ExternalControl from './ExternalControl.svelte';
  const scope = getContext<PresentationControlScope | undefined>(PRESENTATION_CONTROLS);

  let props: UiModelMatrixProps = $props();
  const Component = $derived($activeUiKit.ModelMatrix);
</script>

{#if scope && $externalPresentation?.package.release.manifest.surfaces?.includes('controls')}
  <ExternalControl control="ModelMatrix" {props} presentation={$externalPresentation} {scope}>
    <Component {...props} />
  </ExternalControl>
{:else}<Component {...props} />{/if}
