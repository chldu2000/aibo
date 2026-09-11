<script lang="ts">
  import { tick } from 'svelte';
  import type { PresentationProps } from '../../presentation-props';
  import { actionMessage } from '../../../presentation/actions';
  let { snapshot, layout, onAction, focusTarget = null }: PresentationProps = $props();
  let root: HTMLElement;
  let previousKind: string | null = null;
  let previouslyInteractive: boolean | null = null;
  const loading = $derived(snapshot.state.status === 'loading');
  const inspect = $derived(snapshot.actions.find(action => (action.id === 'inspect' || action.id === 'open-diff')));
  function act(id: (typeof snapshot.actions)[number]['id'], item: string | null = null) {
    if (loading) return;
    onAction(actionMessage(snapshot, id, item));
  }
  $effect(() => {
    const kind = snapshot.view.kind;
    const target = focusTarget;
    const interactive = snapshot.actions.some(action => (action.id === 'inspect' || action.id === 'open-diff') && action.enabled);
    if ((kind !== previousKind && (previousKind !== null || kind !== 'collection' || target)) || (previouslyInteractive === false && interactive && target)) {
      void tick().then(() => {
        if (kind !== 'collection') root?.querySelector<HTMLElement>('h2')?.focus();
        else {
          const button = Array.from(root?.querySelectorAll<HTMLButtonElement>('[data-item]') ?? []).find(button => button.dataset.item === target);
          (button ?? root?.querySelector<HTMLElement>('h2'))?.focus();
        }
      });
    }
    previousKind = kind;
    previouslyInteractive = interactive;
  });
</script>
<section bind:this={root} class="semantic-view" aria-label={snapshot.contribution.title} aria-busy={loading}>
  <header>
    <div><p class="eyebrow">插件视图</p><h2 tabindex="-1">{snapshot.contribution.title}</h2></div>
    <nav aria-label="视图操作">
      {#each snapshot.actions.filter(action => action.id !== 'inspect' && action.id !== 'open-diff') as action (action.id)}
        <button type="button" disabled={!action.enabled || loading} onclick={() => act(action.id)}>{action.label}</button>
      {/each}
    </nav>
  </header>
  {#if snapshot.state.message}
    <p role={snapshot.state.status === 'error' ? 'alert' : 'status'}>{snapshot.state.message}</p>
  {/if}
  {#if snapshot.view.kind === 'collection'}
    <p class="summary">{snapshot.view.page.total} 项 · 已显示 {snapshot.view.items.length ? snapshot.view.page.offset + 1 : 0}–{snapshot.view.page.offset + snapshot.view.items.length}{snapshot.view.page.truncated ? ' · 部分结果，已达到列表上限' : ''}</p>
    <div class="contents">
      {#if layout === 'central'}
        <table>
          <caption>{snapshot.contribution.title}</caption>
          <thead><tr>{#each snapshot.view.properties as property}<th scope="col">{property.label}</th>{/each}<th scope="col">操作</th></tr></thead>
          <tbody>{#each snapshot.view.items as item (item.id)}
            <tr aria-current={snapshot.view.selection === item.id ? 'true' : undefined}>
              {#each snapshot.view.properties as property}<td>{item.values[property.key]}</td>{/each}
              <td><button type="button" data-item={item.id} aria-label={`${inspect?.label ?? '查看差异'} ${item.values[snapshot.view.properties[0]?.key ?? ''] ?? item.id}`} disabled={loading || !inspect?.enabled} onclick={() => act(inspect?.id ?? 'inspect', item.id)}>{inspect?.label ?? '查看差异'}</button></td>
            </tr>
          {/each}</tbody>
        </table>
      {:else}
        <ul aria-label={snapshot.contribution.title}>
          {#each snapshot.view.items as item (item.id)}
            <li><button class="file" type="button" data-item={item.id} aria-label={`${inspect?.label ?? '查看差异'} ${item.values[snapshot.view.properties[0]?.key ?? ''] ?? item.id}`} aria-current={snapshot.view.selection === item.id ? 'true' : undefined} disabled={loading || !inspect?.enabled} onclick={() => act(inspect?.id ?? 'inspect', item.id)}>
              {#each snapshot.view.properties as property}<span><span class="label">{property.label}</span> {item.values[property.key]}</span>{/each}
            </button></li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <dl>{#each snapshot.view.properties as property}<div><dt>{property.label}</dt><dd>{property.value}</dd></div>{/each}</dl>
    {#if snapshot.view.truncated}<p role="status">内容已截断，剩余内容未加载。</p>{/if}
    <textarea class="diff-content" readonly rows="16" aria-label={snapshot.view.kind === "detail" ? "文件差异内容" : "视图内容"} value={snapshot.view.content}></textarea>
  {/if}
</section>
<style>
  .semantic-view { display: flex; flex-direction: column; gap: 1rem; height: 100%; min-height: 0; padding: 1.25rem; border: 1px solid var(--border); border-radius: var(--semantic-radius); background: var(--card); color: var(--foreground); overflow: auto; }
  header { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font-size: 1.125rem; font-weight: 650; }
  .eyebrow, .summary, .label, dt { color: var(--muted-foreground); font-size: 0.8rem; }
  p { margin: 0; }
  nav { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  button { border: 1px solid var(--border); border-radius: var(--semantic-radius); padding: 0.5rem 0.75rem; background: var(--secondary); color: var(--foreground); font: inherit; cursor: pointer; }
  button:hover { background: var(--accent); }
  button:disabled { opacity: 0.5; cursor: default; }
  :is(button, h2, .diff-content):focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; }
  .contents { overflow: auto; min-height: 0; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem; }
  caption { text-align: left; color: var(--muted-foreground); padding-bottom: 0.75rem; }
  th, td { padding: 0.75rem; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .file { display: flex; flex-direction: column; gap: 0.25rem; width: 100%; text-align: left; overflow-wrap: anywhere; }
  dl { margin: 0; display: flex; gap: 1rem; flex-wrap: wrap; }
  dd { margin: 0; overflow-wrap: anywhere; font-size: 0.875rem; }
  .diff-content { border: 1px solid var(--border); color: var(--foreground); width: 100%; resize: vertical; overflow: auto; min-height: 6rem; white-space: pre; font-family: monospace; font-size: 0.8125rem; padding: 1rem; background: var(--muted); border-radius: var(--semantic-radius); }
</style>
