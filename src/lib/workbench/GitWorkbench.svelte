<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button, Card, SemanticView } from '$lib/ui-kit';
  import { createGitController, type GitPort } from '../presentation/git-controller';
  import type { Snapshot, ActionMessage } from '../presentation/contract';
  let { workspaceId, port, onClose }: { workspaceId: string; port: GitPort; onClose: () => void } = $props();
  let snapshot = $state<Snapshot | null>(null);
  let collection = $state<Snapshot | null>(null);
  let layout = $state<'sidebar' | 'central'>('central');
  let focusTarget = $state<string | null>(null);
  const controller = createGitController(untrack(() => port), value => {
    snapshot = value;
    if (!value) collection = null;
    else if (value.view.kind === 'collection' && value.state.status !== 'loading') {
      value.view.selection = value.view.items.some(item => item.id === focusTarget) ? focusTarget : null;
      collection = value;
    }
  });
  onMount(() => () => controller.dispose());
  $effect(() => { void controller.open(workspaceId); });
  function action(message: ActionMessage) {
    if (message.actionId === 'open-diff') focusTarget = message.itemId;
    if (message.actionId === 'refresh') void controller.refresh();
    else void controller.act(message);
  }
</script>
<div class="semantic-workbench">
  <div class="controls">
    <Button variant="outline" onclick={() => layout = layout === 'central' ? 'sidebar' : 'central'}>{layout === 'central' ? '切换侧栏布局' : '切换中央布局'}</Button>
    <Button variant="ghost" onclick={onClose}>关闭工作区工具</Button>
  </div>
  <div class="content" class:sidebar={layout === 'sidebar'}>
    {#if snapshot}
      {#if layout === 'sidebar' && collection && snapshot.view.kind === 'detail'}
        <SemanticView snapshot={{ ...collection, actions: collection.actions.map(item => ({ ...item, enabled: false })) }} {layout} {focusTarget} onAction={action} />
        <SemanticView {snapshot} layout="central" {focusTarget} onAction={action} />
      {:else}
        <SemanticView {snapshot} {layout} {focusTarget} onAction={action} />
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
