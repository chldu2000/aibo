<script lang="ts">
  import { t } from '$lib/i18n/runtime';
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
    <div><p class="eyebrow">{$t('semantic.pluginView')}</p><h2 tabindex="-1">{snapshot.contribution.title}</h2></div>
    <nav aria-label={$t('semantic.actions')}>
      {#each snapshot.actions.filter(action => action.id !== 'inspect' && action.id !== 'open-diff') as action (action.id)}
        <button type="button" disabled={!action.enabled || loading} onclick={() => act(action.id)}>{action.label}</button>
      {/each}
    </nav>
  </header>
  {#if snapshot.state.message}
    <p role={snapshot.state.status === 'error' ? 'alert' : 'status'}>{snapshot.state.message}</p>
  {/if}
  {#if snapshot.view.kind === 'collection'}
    <p class="summary">{$t('semantic.items', { total: snapshot.view.page.total, start: snapshot.view.items.length ? snapshot.view.page.offset + 1 : 0, end: snapshot.view.page.offset + snapshot.view.items.length, truncated: snapshot.view.page.truncated ? $t('semantic.listLimit') : '' })}</p>
    <div class="contents">
      {#if layout === 'central'}
        <table>
          <caption>{snapshot.contribution.title}</caption>
          <thead><tr>{#each snapshot.view.properties as property}<th scope="col">{property.label}</th>{/each}<th scope="col">{$t('semantic.actionColumn')}</th></tr></thead>
          <tbody>{#each snapshot.view.items as item (item.id)}
            <tr aria-current={snapshot.view.selection === item.id ? 'true' : undefined}>
              {#each snapshot.view.properties as property}<td>{item.values[property.key]}</td>{/each}
              <td><button type="button" data-item={item.id} aria-label={`${inspect?.label ?? $t('semantic.inspect')} ${item.values[snapshot.view.properties[0]?.key ?? ''] ?? item.id}`} disabled={loading || !inspect?.enabled} onclick={() => act(inspect?.id ?? 'inspect', item.id)}>{inspect?.label ?? $t('semantic.inspect')}</button></td>
            </tr>
          {/each}</tbody>
        </table>
      {:else}
        <ul aria-label={snapshot.contribution.title}>
          {#each snapshot.view.items as item (item.id)}
            <li><button class="file" type="button" data-item={item.id} aria-label={`${inspect?.label ?? $t('semantic.inspect')} ${item.values[snapshot.view.properties[0]?.key ?? ''] ?? item.id}`} aria-current={snapshot.view.selection === item.id ? 'true' : undefined} disabled={loading || !inspect?.enabled} onclick={() => act(inspect?.id ?? 'inspect', item.id)}>
              {#each snapshot.view.properties as property}<span><span class="label">{property.label}</span> {item.values[property.key]}</span>{/each}
            </button></li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <dl>{#each snapshot.view.properties as property}<div><dt>{property.label}</dt><dd>{property.value}</dd></div>{/each}</dl>
    {#if snapshot.view.truncated}<p role="status">{$t('semantic.truncated')}</p>{/if}
    {#if detailPresentation === 'numbered' && snapshot.view.kind === 'detail'}
      <div class="numbered-content" role="textbox" aria-readonly="true" aria-multiline="true" tabindex="0" aria-label={$t('semantic.numberedContent')}>{#each snapshot.view.content.split('\n') as line, index}<span class="text-line"><span class="line-number" aria-hidden="true">{index + 1}</span><span>{line}</span></span>{/each}</div>
    {:else}
    <textarea class="diff-content" readonly rows="16" aria-label={snapshot.view.kind === "detail" ? $t('semantic.diffContent') : $t('semantic.viewContent')} value={snapshot.view.content}></textarea>
    {/if}
  {/if}
</section>
