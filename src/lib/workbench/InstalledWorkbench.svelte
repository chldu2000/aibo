<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button, Card } from '$lib/ui-kit';
  import PresentationSurface from './PresentationSurface.svelte';
  import { createInstalledController, type InstalledContribution, type InstalledPort, type InstalledScope } from '../presentation/installed-controller';
  import { createViewStateStore, type ViewStateStore } from '../app/view-state-storage';
  import { actionMessage } from '../presentation/actions';
  import type { Snapshot, ActionMessage } from '../presentation/contract';
  let { workspaceId, contribution, invocationScope = {kind:"workspace", id:workspaceId}, port, onClose, stateStore = createViewStateStore() }: { workspaceId: string; invocationScope?: InstalledScope; contribution: InstalledContribution; port: InstalledPort; onClose: () => void; stateStore?: ViewStateStore } = $props();
  let snapshot = $state<Snapshot | null>(null);
  let error = $state('');
  let layout = $state<'central' | 'sidebar'>('central');
  let focusTarget = $state<string | null>(null);
  let offset = 0;
  let restoring = false;
  let ticket = 0;
  const scope = () => ({ workspaceId: invocationScope.kind === "application" ? "application" : invocationScope.id, contributionId: `${contribution.contributionId}.${contribution.installationId}` });
  function save() {
    if (!restoring && snapshot && ['ready', 'empty'].includes(snapshot.state.status)) stateStore.write(scope(), { selection: focusTarget, detail: snapshot.view.kind === 'detail' ? snapshot.view.itemId : null, offset, layout });
  }
  const controller = createInstalledController(untrack(() => port), (value, message) => {
    snapshot = value; error = message;
    if (value?.view.kind === 'collection' && value.state.status !== 'loading') {
      offset = value.view.page.offset;
      if (!value.view.items.some(item => item.id === focusTarget)) focusTarget = null;
      value.view.selection = focusTarget;
    }
    save();
  });
  async function restore() {
    const currentTicket = ++ticket, remembered = stateStore.read(scope());
    restoring = true; layout = remembered.layout; focusTarget = remembered.selection;
    await controller.open(workspaceId, contribution, invocationScope);
    const current = () => snapshot;
    while (currentTicket === ticket) {
      const value = current();
      if (!value || value.state.status !== 'ready' || value.view.kind !== 'collection' || value.view.page.offset >= remembered.offset || !value.actions.some(action => action.id === 'next' && action.enabled)) break;
      await controller.act(actionMessage(value, 'next'));
    }
    if (currentTicket !== ticket) return;
    const value = current();
    if (value?.view.kind === 'collection') {
      focusTarget = value.view.items.some(item => item.id === remembered.selection) ? remembered.selection : null;
      value.view.selection = focusTarget;
      if (focusTarget && remembered.detail === focusTarget) await controller.act(actionMessage(value, value.actions.find(action => action.intent === 'inspect')?.id ?? 'inspect', focusTarget));
    }
    if (currentTicket === ticket) { restoring = false; save(); }
  }
  $effect(() => { workspaceId; contribution; invocationScope; untrack(() => { void restore(); }); });
  onMount(() => () => { ++ticket; controller.dispose(); });
  function act(message: ActionMessage) {
    if (restoring) return;
    if (message.actionId === 'inspect' || message.actionId === 'open-diff') focusTarget = message.itemId;
    void controller.act(message);
  }
</script>
<section class="installed-workbench" aria-label={contribution.title}>
  <div class="controls">
    <Button variant="outline" onclick={() => { layout = layout === 'central' ? 'sidebar' : 'central'; save(); }}>切换布局</Button>
    <Button variant="ghost" onclick={onClose}>关闭插件视图</Button>
  </div>
  {#if snapshot}
    <PresentationSurface {snapshot} {layout} {focusTarget} onAction={act} />
  {:else if error}
    <Card><p role="alert">此工具暂不可用：{error}</p><Button variant="outline" onclick={restore}>重新加载</Button></Card>
  {:else}<Card><p role="status">正在读取…</p></Card>{/if}
</section>
<style>
  .installed-workbench { display: flex; flex-direction: column; gap: 1rem; height: 100%; min-height: 0; overflow: auto; }
  .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; }
</style>
