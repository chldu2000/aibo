<script lang="ts">
  import { untrack } from 'svelte';
  import type { PresentationProps } from '../presentation-props';
  import type { ExternalPresentation } from '../external-presentation';
  import { preparePresentationSandbox, type MountedSandbox } from '../../presentation-runtime/sandbox';
  import { semanticInput, resolveSemanticIntent } from '../../presentation-runtime/semantic';
  let { presentation, props, failed }: { presentation: ExternalPresentation; props: PresentationProps; failed(error: Error): void } = $props();
  let target: HTMLDivElement;
  let mounted: MountedSandbox | null = null;
  let latest = untrack(() => props.snapshot);
  let revision = 0;
  function fail(error: unknown) {
    mounted?.dispose(); mounted = null;
    failed(error instanceof Error ? error : Error(String(error)));
  }
  $effect(() => {
    const registration = presentation;
    const abort = new AbortController();
    let candidate: MountedSandbox | null = null;
    untrack(() => {
      const snapshot = $state.snapshot(props.snapshot);
      latest = snapshot;
      const version = ++revision;
      if (!registration.package.release.manifest.snapshotSchemas.includes(snapshot.schema)) {
        fail(Error('unsupported_snapshot_schema')); return;
      }
      void preparePresentationSandbox(target, registration.package, semanticInput(snapshot, version, registration.theme), intent => {
        if (intent.event !== 'click') return;
        try { props.onAction(resolveSemanticIntent(latest, intent.id)); }
        catch (error) { fail(error); }
      }, fail, abort.signal, { onRecover: registration.recover }).then(instance => {
        if (abort.signal.aborted) { instance.dispose(); return; }
        candidate = instance; mounted = instance;
        instance.activate();
        if (revision > version) {
          if (!registration.package.release.manifest.snapshotSchemas.includes(latest.schema)) throw Error('unsupported_snapshot_schema');
          instance.update(semanticInput(latest, revision, registration.theme));
        }
      }).catch(error => { if (!abort.signal.aborted) fail(error); });
    });
    return () => { abort.abort(); candidate?.dispose(); if (mounted === candidate) mounted = null; };
  });
  $effect(() => {
    latest = $state.snapshot(props.snapshot);
    const version = ++revision;
    if (mounted) {
      try {
        if (!presentation.package.release.manifest.snapshotSchemas.includes(latest.schema)) throw Error('unsupported_snapshot_schema');
        mounted.update(semanticInput(latest, version, presentation.theme));
      } catch (error) { fail(error); }
    }
  });
</script>
<div class="external-semantic" bind:this={target}></div>
<style>
  .external-semantic { width: 100%; height: 100%; min-height: 20rem; }
</style>
