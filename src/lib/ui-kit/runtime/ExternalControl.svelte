<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import type { ExternalPresentation } from '../external-presentation';
  import type { PresentationControlScope } from '../control-context';
  import type { UiAgentStatusMarkProps, UiModelMatrixProps } from '../contract';
  import { controlInput, modelSelections, type PresentationControl } from '../../presentation-runtime/controls';
  import { preparePresentationSandbox, type MountedSandbox } from '../../presentation-runtime/sandbox';
  let { control, props, presentation, scope, children }: {
    control: PresentationControl;
    props: UiAgentStatusMarkProps | UiModelMatrixProps;
    presentation: ExternalPresentation;
    scope: PresentationControlScope;
    children: Snippet;
  } = $props();
  let target: HTMLSpanElement;
  let inherited = $state(true), failed = $state(false);
  let mounted: MountedSandbox | null = null;
  let revision = 0;
  const input = $derived(controlInput(control, props, scope.context(), presentation.theme));
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
        if (scope.suspended() || kind !== 'ModelMatrix' || intent.event !== 'click') return;
        const context = scope.context();
        if (intent.context.workspaceId !== context.workspaceId || intent.context.sessionId !== context.sessionId) return;
        const matrix = props as UiModelMatrixProps;
        const action = modelSelections(matrix).find(action => action.token === intent.id);
        if (action) void Promise.resolve().then(() => matrix.onSelect(action.model, action.reasoningEffort)).catch(fail);
      }, fail, abort.signal, { allowInheritance: true, onInheritanceChange: value => { inherited = value; }, onRecover: registration.recover, decorative: kind === 'AgentStatusMark' }).then(instance => {
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
<span class="external-control" class:status-mark={control === 'AgentStatusMark'} role={control === 'AgentStatusMark' ? 'img' : undefined} aria-label={control === 'AgentStatusMark' ? (props as UiAgentStatusMarkProps).label : undefined} hidden={inherited || failed} bind:this={target}></span>
<style>
  .external-control { display: block; width: 100%; height: 250px; }
  .external-control.status-mark { display: inline-block; width: 20px; height: 20px; pointer-events: none; }
  .external-control[hidden] { display: none; }
</style>
