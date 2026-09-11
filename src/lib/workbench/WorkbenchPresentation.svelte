<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import { Button, Card } from '$lib/ui-kit';
  import { preflightDefaultPresentation } from './plugins/default-presentation';
  import { createPresentationController, type Renderer } from '../app/presentation-controller';
  import type { WorkbenchSnapshot, WorkbenchAction } from '../presentation/workbench-contract';
  let { snapshot, windowId, children, suspended = false }: {
    snapshot: WorkbenchSnapshot;
    windowId: string;
    suspended?: boolean;
    children: Snippet<[(id: string, callback: (...args: any[]) => any) => (...args: any[]) => any]>;
  } = $props();
  let target: HTMLDivElement;
  let host = $state<ReturnType<typeof createPresentationController<WorkbenchSnapshot, WorkbenchAction>> | null>(null);
  let failure = $state('');
  let switching = $state(false);
  let switchTicket = 0;
  let instance = $state<{ generation: number; layout: string; guard: (id: string, callback: (...args: any[]) => any) => (...args: any[]) => any } | null>(null);
  const storageKey = $derived(`aibo.workbench-presentation.v1.${encodeURIComponent(windowId)}`);
  let focus = $state<string | null>(null);
  let allowedActions = new Set<string>();
  function rememberFocus(event?: FocusEvent) {
    const element = (event?.target ?? target?.ownerDocument.activeElement) as HTMLElement | null;
    if (element && target.contains(element)) focus = element.dataset.presentationFocus ?? element.getAttribute('aria-label') ?? element.id ?? null;
  }
  function restoreFocus() {
    if (!focus || suspended) return;
    const element = [...target.querySelectorAll<HTMLElement>('[data-presentation-focus], [aria-label], [id]')]
      .find(item => (item.dataset.presentationFocus ?? item.getAttribute('aria-label') ?? item.id) === focus);
    (element ?? target.querySelector<HTMLElement>('textarea:not(:disabled),button:not(:disabled)'))?.focus();
  }
  const recovery = () => ({ selection: snapshot.sessionId, detail: snapshot.navigation, focus });
  function renderer(layout: string, failMount = false): Renderer<WorkbenchSnapshot, WorkbenchAction> {
    return {
      async preflight(value) { JSON.stringify(value); preflightDefaultPresentation(layout); },
      async mount(value, dispatch, active) {
        if (failMount) throw Error('测试呈现挂载失败');
        if (!active()) throw Error('presentation_superseded');
        const owner = value.generation;
        allowedActions = new Set();
        const guard = (id: string, callback: (...args: any[]) => any) => {
          allowedActions.add(id);
          // Capture the context visible when this callback is rendered. A late control
          // from another session is rejected even within the same renderer instance.
          const context = { workspaceId: snapshot.workspaceId, sessionId: snapshot.sessionId };
          return (...args: any[]) => {
            if (!dispatch({ schema: 'aibo.presentation-action/experimental-v1', generation: owner, action: { id, ...context } })) return;
            return callback(...args);
          };
        };
        instance = { generation: owner, layout, guard };
        await tick();
        if (!active()) {
          if (instance?.generation === owner) instance = null;
          throw Error('presentation_superseded');
        }
        restoreFocus();
        try { localStorage.setItem(storageKey, layout); } catch { /* Memory-only navigation remains usable. */ }
        return {
          update() {},
          async dispose() { if (instance?.generation === owner) instance = null; await tick(); },
        };
      },
    };
  }
  async function switchLayout(layout: string, failMount = false, recover = false) {
    if (!host || (switching && !recover)) return;
    const ticket = ++switchTicket;
    rememberFocus();
    switching = true; failure = '';
    host.update($state.snapshot(snapshot), recovery());
    try { await host.switchRenderer(renderer(layout, failMount)); }
    catch (error) { if (ticket === switchTicket) failure = String(error); }
    finally {
      if (ticket === switchTicket) {
        switching = false;
        await tick();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (ticket === switchTicket) restoreFocus();
      }
    }
  }
  function restoreDefault() { return switchLayout('standard', false, true); }
  function handleRecoveryKey(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'Backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void restoreDefault();
    }
  }
  onMount(() => {
    // Capture phase keeps this host command independent of renderer key handlers.
    window.addEventListener('keydown', handleRecoveryKey, true);
    host = createPresentationController<WorkbenchSnapshot, WorkbenchAction>({
      view: $state.snapshot(snapshot), recovery: recovery(), fallback: renderer('standard'),
      validateAction: (current, action) => Boolean(!suspended && action && allowedActions.has(action.id) && action.workspaceId === current.workspaceId && action.sessionId === current.sessionId),
      onAction() {}, onError: error => { failure = String(error); },
    });
    let layout = 'standard';
    try { layout = localStorage.getItem(storageKey) === 'focus' ? 'focus' : 'standard'; } catch {}
    void switchLayout(layout);
    const controller = host;
    return () => { window.removeEventListener('keydown', handleRecoveryKey, true); void controller.dispose(); };
  });
  $effect(() => { if (host) host.update($state.snapshot(snapshot), untrack(recovery)); });
  // Local diagnostics use the same lifecycle path; no remote renderer code is loaded.
  export function switchPresentation(layout: string, failMount = false) { return switchLayout(layout, failMount); }
</script>
<div class="presentation-controls">
  <Button variant="ghost" onclick={() => switchLayout(instance?.layout === 'focus' ? 'standard' : 'focus')} disabled={switching} aria-label="切换工作台呈现">{instance?.layout === 'focus' ? '恢复标准工作台' : '专注会话'}</Button>
  <Button variant="ghost" onclick={restoreDefault} aria-label="恢复默认呈现" aria-keyshortcuts="Control+Shift+Backspace Meta+Shift+Backspace">恢复默认呈现</Button>
  {#if failure}<Card><p role="alert">呈现错误：{failure}</p></Card>{/if}
</div>
<div bind:this={target} onfocusin={rememberFocus} class="workbench-presentation" data-presentation-focus-target={focus} data-presentation-layout={instance?.layout} data-presentation-generation={instance?.generation} inert={switching || suspended} aria-busy={switching} style:display={suspended ? 'none' : 'flex'}>
  {#if instance}{#key instance.generation}{@render children(instance.guard)}{/key}{/if}
</div>
<style>
  .presentation-controls { display: flex; flex-wrap: wrap; align-self: flex-end; flex-shrink: 0; order: 1; }
  .workbench-presentation { order: 2; display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .workbench-presentation[data-presentation-layout='focus'] :global(.workspace-grid) { grid-template-columns: minmax(0, 1fr); }
  .workbench-presentation[data-presentation-layout='focus'] :global(.workspace-grid > :not(.timeline):not(.plugin-workspace)) { display: none; }
</style>
