<script lang="ts">
  import { Button } from '$lib/ui-kit';
  import type { NodeRuntimeState } from '$lib/app/node-runtime-controller';
  let { state, desktop, onDetect, onChoose, onAutomatic, onDownload }: {
    state: NodeRuntimeState; desktop: boolean;
    onDetect: () => void; onChoose: () => void; onAutomatic: () => void; onDownload: () => void;
  } = $props();
  const source = { system: '本机 Node', manual: '手动选择', managed: 'Aibo 专用 Node' };
</script>
<section class="settings-section" aria-labelledby="node-runtime-title" aria-busy={state.pending !== null}>
  <div class="settings-section-heading"><div><h2 id="node-runtime-title">Node 运行时</h2><p>自动查找本机兼容版本；缺失时可下载 Aibo 专用运行时，或选择已有的 Node 文件。</p></div></div>
  {#if state.value?.selected}
    <p><strong>{source[state.value.selected.source]} · {state.value.selected.version}</strong></p>
    <p class="runtime-path">{state.value.selected.path}</p>
  {:else if state.value}<p role="status">没有可用的 Node，依赖它的插件暂时无法运行。</p>{/if}
  {#if state.value?.manualPath}<p class="runtime-path">指定文件：{state.value.manualPath}</p>{/if}
  {#if state.value}
    <p>宿主要求 Node {state.value.hostRequirement}；插件会另行检查自身的版本要求。</p>
    {#each state.value.issues as issue}<p class="runtime-path">{issue}</p>{/each}
  {/if}
  <div class="runtime-buttons">
    <Button variant="outline" size="sm" disabled={!desktop || state.pending !== null} onclick={onDetect}>重新检测 Node</Button>
    <Button variant="outline" size="sm" disabled={!desktop || state.pending !== null} onclick={onChoose}>选择 Node 文件…</Button>
    <Button variant="outline" size="sm" disabled={!desktop || state.pending !== null || !state.value?.downloadSupported} onclick={onDownload}>下载 Aibo 专用 Node{state.value ? ` ${state.value.downloadVersion}` : ''}</Button>
    {#if state.value?.manualPath || state.error}<Button variant="ghost" size="sm" disabled={!desktop || state.pending !== null} onclick={onAutomatic}>恢复自动查找</Button>{/if}
  </div>
  <p>专用运行时仅供 Aibo 使用，不修改系统 PATH；正在运行的插件进程保持不变。</p>
  {#if !desktop}<p>请在桌面应用中管理运行时。</p>
  {:else if state.pending}<p role="status">{state.pending === 'download' ? '正在下载并校验 Node，请稍候…' : state.pending === 'select' ? '正在选择并检查 Node…' : '正在检测 Node…'}</p>{/if}
  {#if state.error}<p role="alert">{state.error}</p>{/if}
  {#if state.notice}<p role="status">{state.notice}</p>{/if}
</section>
<style>
  .runtime-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
  .runtime-path { overflow-wrap: anywhere; }
</style>
