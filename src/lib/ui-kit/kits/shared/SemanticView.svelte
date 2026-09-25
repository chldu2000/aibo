<script lang="ts">
  import { tick } from 'svelte';
  import type { PresentationProps } from '../../presentation-props';
  import { actionMessage } from '../../../presentation/actions';
  let { snapshot, layout, onAction, focusTarget = null, detailPresentation = 'plain' }: PresentationProps = $props();
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
    {#if detailPresentation === 'numbered' && snapshot.view.kind === 'detail'}
      <div class="numbered-content" role="textbox" aria-readonly="true" aria-multiline="true" tabindex="0" aria-label="带行号的文本内容">{#each snapshot.view.content.split('\n') as line, index}<span class="text-line"><span class="line-number" aria-hidden="true">{index + 1}</span><span>{line}</span></span>{/each}</div>
    {:else}
    <textarea class="diff-content" readonly rows="16" aria-label={snapshot.view.kind === "detail" ? "文件差异内容" : "视图内容"} value={snapshot.view.content}></textarea>
    {/if}
  {/if}
</section>
