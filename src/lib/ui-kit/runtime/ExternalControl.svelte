<script lang="ts" generics="Name extends PresentationControl">
  import { untrack, type Snippet } from 'svelte';
  import type { ExternalPresentation } from '../external-presentation';
  import type { PresentationControlScope } from '../control-context';
  import { controlInput, decorativeLabel, isDecorativeControl, resolveControlIntent, type ControlProps, type PresentationControl } from '../../presentation-runtime/controls';
  import { preparePresentationSandbox, type MountedSandbox } from '../../presentation-runtime/sandbox';
  let { control, props, presentation, scope, children }: {
    control: Name;
    props: ControlProps[Name];
    presentation: ExternalPresentation;
    scope: PresentationControlScope;
    children: Snippet;
  } = $props();
  let target: HTMLSpanElement;
  let inherited = $state(true), failed = $state(false);
  let mounted: MountedSandbox | null = null;
  let revision = 0;
  const input = $derived(controlInput(control, props, scope.context(), presentation.theme));
  const label = $derived(decorativeLabel(control, props));
  function fail() { mounted?.dispose(); mounted = null; inherited = true; failed = true; }
  $effect(() => {
    const registration = presentation;
    const kind = control;
    const abort = new AbortController();
    let candidate: MountedSandbox | null = null;
    failed = false; inherited = true;
    untrack(() => {
      const version = ++revision;
      const initial = $state.snapshot(input);
      void preparePresentationSandbox(target, registration.package, { ...initial, context: { ...initial.context, revision: version } }, intent => {
        if (scope.suspended()) return;
        const context = scope.context();
        if (intent.context.workspaceId !== context.workspaceId || intent.context.sessionId !== context.sessionId) return;
        // Resolve against the current props: a stale token or a disabled option does nothing.
        const run = resolveControlIntent(kind, props, intent);
        if (run) void Promise.resolve().then(run).catch(fail);
      }, fail, abort.signal, { allowInheritance: true, onInheritanceChange: value => { inherited = value; }, onRecover: registration.recover, decorative: isDecorativeControl(kind) }).then(instance => {
        if (abort.signal.aborted) { instance.dispose(); return; }
        candidate = instance; mounted = instance; instance.activate();
        if (revision > version) { const next = $state.snapshot(input); instance.update({ ...next, context: { ...next.context, revision } }); }
      }).catch(() => { if (!abort.signal.aborted) fail(); });
    });
    return () => { abort.abort(); candidate?.dispose(); if (mounted === candidate) mounted = null; };
  });
  $effect(() => {
    const next = $state.snapshot(input);
    const version = ++revision;
    if (mounted && !failed) mounted.update({ ...next, context: { ...next.context, revision: version } });
  });
</script>
{#if inherited || failed}{@render children()}{/if}
<span class="external-control" class:status-mark={isDecorativeControl(control)} role={isDecorativeControl(control) ? 'img' : undefined} aria-label={label ?? undefined} hidden={inherited || failed} bind:this={target}></span>
<style>
  .external-control { display: block; width: 100%; height: 250px; }
  .external-control.status-mark { display: inline-block; width: 20px; height: 20px; pointer-events: none; }
  .external-control[hidden] { display: none; }
</style>
