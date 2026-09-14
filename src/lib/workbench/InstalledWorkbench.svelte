<script lang="ts">
  import { Button, Card } from '$lib/ui-kit';
  import PresentationSurface from './PresentationSurface.svelte';
  import type { InstalledWorkbenchState } from '../app/installed-workbench-controller';
  import type { ActionMessage } from '../presentation/contract';
  let { title, state, onAction, onReload, onToggleLayout, onToggleReading, onClose }: {
    title: string;
    state: InstalledWorkbenchState;
    onAction: (message: ActionMessage) => void;
    onReload: () => void;
    onToggleLayout: () => void;
    onToggleReading: () => void;
    onClose: () => void;
  } = $props();
</script>
<section class="installed-workbench" aria-label={title}>
  <div class="controls">
    <Button variant="outline" onclick={onToggleLayout}>切换布局</Button>
    {#if state.snapshot?.view.kind === 'detail'}<Button variant="outline" onclick={onToggleReading}>{state.enhanced ? '使用通用阅读' : '使用带行号阅读'}</Button>{/if}
    <Button variant="ghost" onclick={onClose}>关闭插件视图</Button>
  </div>
  {#if state.snapshot}
    {#if state.error}<Card><p role="alert">{state.error}</p></Card>{/if}
    <PresentationSurface preference={state.enhanced ? undefined : null} snapshot={state.snapshot} layout={state.layout} focusTarget={state.focusTarget} {onAction} />
  {:else if state.error}
    <Card><p role="alert">此工具暂不可用：{state.error}</p><Button variant="outline" onclick={onReload}>重新加载</Button></Card>
  {:else}<Card><p role="status">正在读取…</p></Card>{/if}
</section>
<style>
  .installed-workbench { display: flex; flex-direction: column; gap: 1rem; height: 100%; min-height: 0; overflow: auto; }
  .controls { display: flex; gap: 0.5rem; flex-wrap: wrap; }
</style>
