<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PresentationInput, PresentationIntent } from '../../../packages/plugin-protocol/src/presentation-runtime';
  import type { InstalledPresentationPackage } from '../presentation-runtime/types';
  import { preparePresentationSandbox, type MountedSandbox } from '../presentation-runtime/sandbox';
  import type { PresentationInstance } from '../app/presentation-package-controller';
  let { active, themeId, input, suspended = false, onIntent, onRestore, children }: {
    active: InstalledPresentationPackage | null;
    themeId: string | null;
    input: PresentationInput;
    suspended?: boolean;
    onIntent(intent: PresentationIntent): void;
    onRestore(): void;
    children: Snippet;
  } = $props();
  let target: HTMLDivElement;
  let mounted = $state<MountedSandbox | null>(null);
  let mountedRevision = -1;
  const replacesWorkbench = $derived(Boolean(active?.release.manifest.surfaces?.includes('workbench')));
  const tokens = $derived(active?.release.manifest.themes?.find(theme => theme.id === themeId)?.tokens ?? {});
  const themeStyle = $derived(Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(';'));

  export async function prepare(value: InstalledPresentationPackage, selectedTheme: string | null, failure: (error: Error) => void, signal: AbortSignal): Promise<PresentationInstance> {
    if (!value.release.manifest.entry) return { activate() {}, dispose() {} };
    if (!value.release.manifest.surfaces?.includes('workbench')) throw Error('当前版本尚未接入该呈现范围');
    const theme = value.release.manifest.themes?.find(theme => theme.id === selectedTheme)?.tokens ?? {};
    const snapshot = $state.snapshot(input);
    const candidate = await preparePresentationSandbox(target, value, { ...snapshot, theme },
      intent => { if (!suspended) onIntent(intent); }, failure, signal, { localInputActions: ['draft'], onRecover: onRestore });
    return {
      activate() { candidate.activate(); mountedRevision = snapshot.context.revision; mounted = candidate; },
      dispose() { candidate.dispose(); if (mounted === candidate) mounted = null; },
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
