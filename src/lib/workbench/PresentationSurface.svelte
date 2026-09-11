<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Card } from '$lib/ui-kit';
  import type { PresentationProps } from './types';
  import { SveltePresentationAdapter } from './svelte-adapter';
  import { createPresentationController, type Renderer } from '../app/presentation-controller';
  import { assertSnapshot } from '../presentation/validation';
  let { snapshot, layout, focusTarget = null, onAction }: PresentationProps = $props();
  let target: HTMLDivElement;
  let host = $state<ReturnType<typeof createPresentationController> | null>(null);
  let failure = $state('');
  let switching = $state(true);
  let switchTicket = 0;
  const recovery = () => ({ selection: snapshot.view.kind === 'collection' ? snapshot.view.selection : snapshot.view.itemId, detail: snapshot.view.kind === 'detail' ? snapshot.view.itemId : null, focus: focusTarget });
  function renderer(nextLayout: PresentationProps['layout']): Renderer {
    return {
      async preflight(value) { assertSnapshot(value.view); },
      async mount(value, dispatch, active) {
        const container = target.ownerDocument.createElement('div');
        const instance = await SveltePresentationAdapter.mount(container, {
          snapshot: value.view, layout: nextLayout, focusTarget: value.recovery.focus,
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
    const controller = createPresentationController({ view: $state.snapshot(snapshot), recovery: recovery(), fallback: renderer('central'), onAction: action => onAction(action), onError: error => { failure = String(error); } });
    host = controller;
    return () => { void controller.dispose(); };
  });
  $effect(() => {
    const controller = host;
    const nextLayout = layout;
    if (controller) untrack(() => {
      const ticket = ++switchTicket;
      failure = ''; switching = true;
      void controller.switchRenderer(renderer(nextLayout))
        .catch(error => { failure = String(error); })
        .finally(() => { if (ticket === switchTicket) switching = false; });
    });
  });
  $effect(() => {
    if (host) host.update($state.snapshot(snapshot), recovery());
  });
</script>
{#if failure}<Card><p role="alert">呈现恢复提示：{failure}</p></Card>{/if}
<div bind:this={target} inert={switching} aria-busy={switching}></div>
