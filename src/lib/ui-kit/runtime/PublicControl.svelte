<script lang="ts" generics="Name extends PresentationControl">
  import { getContext, type Snippet } from 'svelte';
  import { externalPresentation } from '../external-presentation';
  import { PRESENTATION_CONTROLS, type PresentationControlScope } from '../control-context';
  import { controlAvailable, type ControlProps, type PresentationControl } from '../../presentation-runtime/controls';
  import ExternalControl from './ExternalControl.svelte';
  /** A control in the public catalog: an active controls package may replace it, else the kit renders it. */
  let { control, props, children }: { control: Name; props: ControlProps[Name]; children: Snippet } = $props();
  const scope = getContext<PresentationControlScope | undefined>(PRESENTATION_CONTROLS);
</script>

{#if scope && $externalPresentation?.package.release.manifest.surfaces?.includes('controls') && controlAvailable(control, $externalPresentation.package.release.manifest.hostApi)}
  <ExternalControl {control} {props} presentation={$externalPresentation} {scope}>{@render children()}</ExternalControl>
{:else}{@render children()}{/if}
