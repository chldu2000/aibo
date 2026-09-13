<script lang="ts">
  import { setContext, type Snippet } from 'svelte';
  import type { PresentationInput, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
  import type { InstalledPresentationPackage } from '../presentation-runtime/types';
  import { preparePresentationSandbox, type MountedSandbox } from '../presentation-runtime/sandbox';
  import type { PresentationInstance } from '../app/presentation-package-controller';
  import { get } from 'svelte/store';
  import { externalPresentation, type ExternalPresentation } from './external-presentation';
  import { PRESENTATION_CONTROLS, type PresentationControlScope } from './control-context';
  let { active, themeId, input, suspended = false, onIntent, onRestore, children }: {
    active: InstalledPresentationPackage | null;
    themeId: string | null;
    input: PresentationInput;
    suspended?: boolean;
    onIntent(intent: PresentationIntent): void;
    onRestore(): void;
    children: Snippet;
  } = $props();
  setContext<PresentationControlScope>(PRESENTATION_CONTROLS, { context: () => input.context, suspended: () => suspended });
  let target: HTMLDivElement;
  let mounted = $state<MountedSandbox | null>(null);
  let mountedRevision = -1;
  const replacesWorkbench = $derived(Boolean(active?.release.manifest.surfaces?.includes('workbench')));
  const tokens = $derived(active?.release.manifest.themes?.find(theme => theme.id === themeId)?.tokens ?? {});
  const themeStyle = $derived(Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(';'));

  export async function prepare(value: InstalledPresentationPackage, selectedTheme: string | null, failure: (error: Error) => void, signal: AbortSignal): Promise<PresentationInstance> {
    const theme = value.release.manifest.themes?.find(theme => theme.id === selectedTheme)?.tokens ?? {};
    const registration: ExternalPresentation = { package: value, theme, recover: onRestore };
    const surfaces = value.release.manifest.surfaces ?? [];
    if (surfaces.includes('controls')) {
      const { controlPreflights } = await import('../presentation-runtime/controls');
      for (const snapshot of controlPreflights()) {
        const candidate = await preparePresentationSandbox(target, value, { ...snapshot, theme }, () => {}, failure, signal, { allowInheritance: true });
        candidate.dispose();
      }
    }
    if (surfaces.includes('semantic')) {
      const { semanticInput, semanticPreflightSnapshots } = await import('../presentation-runtime/semantic');
      for (const snapshot of semanticPreflightSnapshots()) {
        const preflight = await preparePresentationSandbox(target, value, semanticInput(snapshot, 1, theme), () => {}, failure, signal);
        preflight.dispose();
      }
    }
    if (!surfaces.includes('workbench')) return {
      activate() { externalPresentation.set(registration); },
      dispose() { if (get(externalPresentation) === registration) externalPresentation.set(null); },
    };
    const snapshot = $state.snapshot(input);
    const capability = (snapshot.data as {capability?: {view?: {snapshot?: {schema: string} | null}}} | null)?.capability?.view?.snapshot;
    if (capability && !value.release.manifest.snapshotSchemas.includes(capability.schema)) throw Error('unsupported_presentation_snapshot');
    const candidate = await preparePresentationSandbox(target, value, { ...snapshot, theme },
      intent => { if (!suspended) onIntent(intent); }, failure, signal, { localInputActions: snapshot => {
        const data = snapshot.data as { navigationActions?: { token: string; event: string }[]; conversationActions?: { token: string; event: string }[]; gitActions?: { token: string; event: string }[]; inspectorActions?: { token: string; event: string }[] } | null;
        return ['draft', ...[...(data?.navigationActions ?? []), ...(data?.conversationActions ?? []), ...(data?.gitActions ?? []), ...(data?.inspectorActions ?? [])].filter(action => action.event === 'input').map(action => action.token)];
      }, onRecover: onRestore });
    return {
      activate() { candidate.activate(); mountedRevision = snapshot.context.revision; mounted = candidate; externalPresentation.set(registration); },
      dispose() { candidate.dispose(); if (mounted === candidate) mounted = null; if (get(externalPresentation) === registration) externalPresentation.set(null); },
    };
  }
  $effect(() => {
    const next = $state.snapshot(input);
    if (mounted && next.context.revision > mountedRevision) {
      mountedRevision = next.context.revision;
      mounted.update({ ...next, theme: tokens });
    }
  });
</script>

<div class="presentation-host">
  <div class="presentation-fallback" hidden={replacesWorkbench} style={themeStyle}>{@render children()}</div>
  <div class="presentation-external" bind:this={target} hidden={!replacesWorkbench || suspended}></div>
</div>

<style>
  .presentation-host { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; order: 2; }
  .presentation-fallback, .presentation-external { flex: 1; min-height: 0; min-width: 0; }
  .presentation-fallback:not([hidden]) { display: flex; flex-direction: column; }
</style>
