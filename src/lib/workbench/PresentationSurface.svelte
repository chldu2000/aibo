<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Card } from '$lib/ui-kit';
  import type { PresentationProps } from './types';
  import { SveltePresentationAdapter, createSveltePresentationAdapter } from './svelte-adapter';
  import { createPresentationController, type Renderer } from '../app/presentation-controller';
  import { resolvePresentationAdapter } from './presentation-adapters';
  import type { PresentationPreference } from '../presentation/renderer-contract';
  import { defaultPresentation, defaultDetailPreference } from './plugins/default-presentation';
  let { snapshot, layout, focusTarget = null, onAction, preference = undefined }: PresentationProps & { preference?: PresentationPreference | null } = $props();
  const implementations = [{ ...defaultDetailPreference, adapter: createSveltePresentationAdapter('numbered') }];
  let target: HTMLDivElement;
  let host = $state<ReturnType<typeof createPresentationController> | null>(null);
  let failure = $state('');
  let fallbackReason = $state<string | null>(null);
  let switching = $state(true);
  let switchTicket = 0;
  const recovery = () => ({ selection: snapshot.view.kind === 'collection' ? snapshot.view.selection : snapshot.view.itemId, detail: snapshot.view.kind === 'detail' ? snapshot.view.itemId : null, focus: focusTarget });
  function renderer(nextLayout: PresentationProps['layout'], requested: PresentationPreference | null = null): Renderer {
    return {
      async preflight(value) { resolvePresentationAdapter(defaultPresentation, value.view, requested, SveltePresentationAdapter, implementations); },
      async mount(value, dispatch, active) {
        const container = target.ownerDocument.createElement('div');
        const selected = resolvePresentationAdapter(defaultPresentation, value.view, requested, SveltePresentationAdapter, implementations);
        container.dataset.presentationMode = selected.choice.kind;
        container.dataset.presentationGeneration = String(value.generation);
        fallbackReason = selected.choice.kind === 'core' ? selected.choice.reason : null;
        const instance = await selected.adapter.mount(container, {
          snapshot: selected.choice.snapshot, layout: nextLayout, focusTarget: value.recovery.focus,
          onAction: action => { dispatch({ schema: 'aibo.presentation-action/experimental-v1', generation: value.generation, action }); },
        });
        if (active()) target.replaceChildren(container);
        return {
          update(next) { instance.update(next.view, next.recovery.focus); },
          async dispose() { await instance.dispose(); container.remove(); },
        };
      },
    };
  }
  onMount(() => {
    const controller = createPresentationController({ view: $state.snapshot(snapshot), recovery: recovery(), fallback: { preflight: value => renderer(layout).preflight(value), mount: (value, dispatch, active) => renderer(layout).mount(value, dispatch, active) }, onAction: action => onAction(action), onError: error => { failure = String(error); } });
    host = controller;
    return () => { void controller.dispose(); };
  });
  $effect(() => {
    const controller = host;
    const nextLayout = layout;
    const requested = preference === undefined ? (snapshot.view.kind === 'detail' ? defaultDetailPreference : null) : preference;
    if (controller) untrack(() => {
      const ticket = ++switchTicket;
      failure = ''; switching = true;
      void controller.switchRenderer(renderer(nextLayout, requested))
        .catch(error => { failure = String(error); })
        .finally(() => { if (ticket === switchTicket) switching = false; });
    });
  });
  $effect(() => {
    if (host) host.update($state.snapshot(snapshot), recovery());
  });
</script>
{#if fallbackReason}<Card><p role="status">专业阅读界面不可用，已使用通用视图。</p></Card>{/if}
{#if failure}<Card><p role="alert">呈现恢复提示：{failure}</p></Card>{/if}
<div bind:this={target} inert={switching} aria-busy={switching}></div>
