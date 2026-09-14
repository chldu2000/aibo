<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button, Card } from '$lib/ui-kit';
  import PresentationSurface from './PresentationSurface.svelte';
  import { createGitController, type GitPort } from '../presentation/git-controller';
  import { createViewStateStore, type ViewStateStore } from '../app/view-state-storage';
  import { actionMessage } from '../presentation/actions';
  import type { Snapshot, ActionMessage } from '../presentation/contract';
  let { workspaceId, port, onClose, stateStore = createViewStateStore() }: { workspaceId: string; port: GitPort; onClose: () => void; stateStore?: ViewStateStore } = $props();
  let snapshot = $state<Snapshot | null>(null);
  let collection = $state<Snapshot | null>(null);
  let layout = $state<'sidebar' | 'central'>('central');
  let focusTarget = $state<string | null>(null);
  let restoring = false;
  let navigationTicket = 0;
  const scope = (id: string) => ({ workspaceId: id, contributionId: 'dev.aibo.git.changes' });
  function save() {
    if (restoring || !snapshot || snapshot.context.workspaceId !== workspaceId || !['ready', 'empty'].includes(snapshot.state.status)) return;
    stateStore.write(scope(workspaceId), {
      selection: focusTarget,
      detail: snapshot.view.kind === 'detail' ? snapshot.view.itemId : null,
      offset: collection?.view.kind === 'collection' ? collection.view.page.offset : 0,
      layout,
    });
  }
  const controller = createGitController(untrack(() => port), value => {
    snapshot = value;
    if (!value) collection = null;
    else if (value.view.kind === 'collection' && value.state.status !== 'loading') {
      value.view.selection = value.view.items.some(item => item.id === focusTarget) ? focusTarget : null;
      collection = value;
    }
    save();
  });
  onMount(() => () => { ++navigationTicket; controller.dispose(); });
  async function restore(id: string) {
    const ticket = ++navigationTicket;
    const remembered = stateStore.read(scope(id));
    restoring = true;
    layout = remembered.layout;
    focusTarget = remembered.selection;
    await controller.open(id);
    const current = () => snapshot;
    while (ticket === navigationTicket) {
      const value = current();
      if (!value || value.state.status !== 'ready' || value.view.kind !== 'collection' || value.view.page.offset >= remembered.offset || !value.actions.some(action => action.id === 'next' && action.enabled)) break;
      await controller.act(actionMessage(value, 'next'));
    }
    if (ticket !== navigationTicket) return;
    const value = current();
    if (value?.view.kind === 'collection' && ['ready', 'empty'].includes(value.state.status)) {
      const valid = value.view.items.some(item => item.id === remembered.selection);
      focusTarget = valid ? remembered.selection : null;
      value.view.selection = focusTarget;
      if (valid && remembered.detail === focusTarget && focusTarget) await controller.act(actionMessage(value, 'open-diff', focusTarget));
    }
    if (ticket !== navigationTicket) return;
    restoring = false;
    save();
  }
  $effect(() => { const id = workspaceId; untrack(() => { void restore(id); }); });
  function toggleLayout() { layout = layout === 'central' ? 'sidebar' : 'central'; save(); }

  function action(message: ActionMessage) {
    if (restoring) return;
    if (message.actionId === 'open-diff') focusTarget = message.itemId;
    if (message.actionId === 'refresh') void restore(workspaceId);
    else void controller.act(message);
  }
</script>
<div class="semantic-workbench">
  <div class="controls">
    <Button variant="outline" onclick={toggleLayout}>{layout === 'central' ? '切换侧栏布局' : '切换中央布局'}</Button>
    <Button variant="ghost" onclick={onClose}>关闭工作区工具</Button>
  </div>
  <div class="content" class:sidebar={layout === 'sidebar'}>
    {#if snapshot}
      {#if layout === 'sidebar' && collection && snapshot.view.kind === 'detail'}
        <PresentationSurface snapshot={{ ...collection, actions: collection.actions.map(item => ({ ...item, enabled: false })) }} {layout} {focusTarget} onAction={action} />
        <PresentationSurface {snapshot} layout="central" {focusTarget} onAction={action} />
      {:else}
        <PresentationSurface {snapshot} {layout} {focusTarget} onAction={action} />
        {#if layout === 'sidebar'}<Card><p>选择变更文件，查看工作区或暂存区的差异。</p></Card>{/if}
      {/if}
    {:else}<Card><p role="status">正在读取工作区变更…</p></Card>{/if}
  </div>
</div>
<style>
  .semantic-workbench { display: flex; flex-direction: column; gap: 1rem; height: 100%; min-height: 0; }
  .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .content { display: grid; min-height: 0; flex: 1; }
  .sidebar { grid-template-columns: minmax(16rem, 24rem) minmax(0, 1fr); gap: 1rem; }
  @media (max-width: 700px) { .sidebar { grid-template-columns: minmax(0, 1fr); } }
</style>
