<script lang="ts">
  import { pluginViewProps, type UiPluginViewProps, type UiPluginViewNode, type UiPluginViewInteraction } from '../../plugin-view';

  let { document, sessionId = '', disabled = false, onAction, interaction }: UiPluginViewProps = $props();
  let local = $state<UiPluginViewInteraction>({ fields: {}, expanded: {} });
  const state = $derived(interaction ?? local);
  const supported = new Set(['stack', 'row', 'grid', 'panel', 'toolbar', 'text', 'markdown', 'badge', 'list', 'item', 'tree', 'timeline', 'code', 'diff', 'form-field', 'button', 'empty-state']);
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const key = (id: string) => JSON.stringify([sessionId, document.viewId, id]);
  const fieldValue = (node: UiPluginViewNode, props: Record<string, unknown>) => state.fields[key(node.id)] ?? props.value;
  function update(node: UiPluginViewNode, value: string | boolean) { state.fields[key(node.id)] = value; }
  function act(actionId: string) {
    if (disabled || !document.actions.some((action) => action.id === actionId)) return;
    const input: Record<string, unknown> = {};
    function collect(node: UiPluginViewNode) {
      const props = pluginViewProps(document, node);
      if (node.type === 'form-field' && typeof props.fieldId === 'string') {
        Object.defineProperty(input, props.fieldId, { value: fieldValue(node, props) ?? null, enumerable: true });
      }
      node.children.forEach(collect);
    }
    collect(document.root);
    void onAction(actionId, input);
  }
</script>

{#snippet children(node: UiPluginViewNode)}
  {#each node.children as child (child.id)}{@render renderNode(child)}{/each}
{/snippet}

{#snippet renderNode(node: UiPluginViewNode)}
  {@const p = pluginViewProps(document, node)}
  {@const label = text(p.label) || text(p.title)}
  {#if !supported.has(node.type)}
    <p role="status">Unsupported plugin component: {node.type}</p>
  {:else if node.type === 'button'}
    <button disabled={disabled || p.disabled === true || !document.actions.some((action) => action.id === p.actionId)} onclick={() => act(text(p.actionId))}>{label || text(p.text) || 'Action'}</button>
  {:else if node.type === 'form-field'}
    <label class="field">
      <span>{label || text(p.fieldId)}</span>
      {#if p.control === 'textarea'}
        <textarea disabled={disabled || p.disabled === true} required={p.required === true} placeholder={text(p.placeholder)} value={String(fieldValue(node, p) ?? '')} oninput={(event) => update(node, event.currentTarget.value)}></textarea>
      {:else if p.control === 'toggle'}
        <input type="checkbox" disabled={disabled || p.disabled === true} checked={fieldValue(node, p) === true} onchange={(event) => update(node, event.currentTarget.checked)} />
      {:else if p.control === 'select'}
        <select disabled={disabled || p.disabled === true} required={p.required === true} value={String(fieldValue(node, p) ?? '')} onchange={(event) => update(node, event.currentTarget.value)}>
          {#each (Array.isArray(p.options) ? p.options as {value: string; label: string}[] : []) as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
        </select>
      {:else}
        <input type="text" disabled={disabled || p.disabled === true} required={p.required === true} placeholder={text(p.placeholder)} value={String(fieldValue(node, p) ?? '')} oninput={(event) => update(node, event.currentTarget.value)} />
      {/if}
    </label>
  {:else if node.type === 'code' || node.type === 'diff'}
    <figure><figcaption>{text(p.path) || label || text(p.language)}</figcaption><pre><code>{text(node.type === 'diff' ? p.unifiedDiff : p.content)}</code></pre></figure>
  {:else if node.type === 'markdown'}
    <div class="prose" aria-label={label || 'Markdown (plain text)'}>{text(p.markdown)}</div>
  {:else if node.type === 'text' || node.type === 'badge' || node.type === 'empty-state'}
    <div class={node.type} data-emphasis={text(p.emphasis)} data-tone={text(p.tone)}>{text(p.text) || label || text(p.emptyText)}</div>
  {:else if p.collapsible === true || node.type === 'tree'}
    <details open={state.expanded[key(node.id)] ?? p.expanded !== false} ontoggle={(event) => { state.expanded[key(node.id)] = event.currentTarget.open; }}>
      <summary>{label || text(p.text) || 'Items'}</summary>
      <div class="stack">{@render children(node)}</div>
    </details>
  {:else}
    <div class={node.type} data-gap={text(p.gap)} data-density={text(p.density)} data-direction={text(p.direction)} data-align={text(p.align)} data-justify={text(p.justify)} data-columns={String(p.columns ?? 1)}>
      {#if label}<strong>{label}</strong>{/if}
      {#if node.type === 'item' && p.text}<span>{text(p.text)}</span>{/if}
      {@render children(node)}
      {#if node.children.length === 0 && p.emptyText}<span>{text(p.emptyText)}</span>{/if}
    </div>
  {/if}
{/snippet}

<section aria-label={document.title} class="view">{@render renderNode(document.root)}</section>

<style>
  .view { color: var(--plugin-ink); font: inherit; min-width: 0; overflow-wrap: anywhere; }
  .stack, .panel, .list, .timeline, .item, .field { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
  .row, .toolbar, [data-direction='horizontal'] { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  .grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(1, minmax(0, 1fr)); }
  [data-columns='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-columns='3'] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  [data-columns='4'] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  [data-gap='none'] { gap: 0; } [data-gap='xs'] { gap: 0.25rem; } [data-gap='sm'] { gap: 0.5rem; } [data-gap='md'] { gap: 0.75rem; } [data-gap='lg'] { gap: 1.25rem; }
  [data-align='start'] { align-items: flex-start; } [data-align='center'] { align-items: center; } [data-align='end'] { align-items: flex-end; } [data-align='stretch'] { align-items: stretch; }
  [data-justify='start'] { justify-content: flex-start; } [data-justify='center'] { justify-content: center; } [data-justify='end'] { justify-content: flex-end; } [data-justify='between'] { justify-content: space-between; }
  .panel, details { padding: 1rem; background: var(--plugin-panel); border: 1px solid var(--plugin-line); border-radius: var(--plugin-radius); }
  [data-density='compact'] { gap: 0.25rem; }
  .badge { width: fit-content; border: 1px solid var(--plugin-line); border-radius: var(--plugin-radius); padding: 0.125rem 0.5rem; font-size: 0.8rem; }
  [data-emphasis='muted'], .empty-state { opacity: 0.7; } [data-emphasis='strong'] { font-weight: 600; }
  [data-tone='danger'] { color: var(--destructive); } [data-tone='info'] { color: var(--plugin-accent); }
  .prose, .text { white-space: pre-wrap; }
  figure { margin: 0; min-width: 0; } pre { overflow: auto; padding: 0.75rem; border: 1px solid var(--plugin-line); border-radius: var(--plugin-radius); } code { font-family: monospace; }
  button, input, textarea, select { font: inherit; border: 1px solid var(--plugin-line); border-radius: var(--plugin-radius); padding: 0.5rem 0.75rem; }
  button { color: var(--plugin-on-accent); background: var(--plugin-accent); cursor: pointer; }
  input, textarea, select { color: var(--plugin-ink); background: var(--plugin-panel); min-width: 0; max-width: 100%; }
  textarea { min-height: 5rem; resize: vertical; } input[type='checkbox'] { align-self: flex-start; }
  :disabled { opacity: 0.5; cursor: not-allowed; } :focus-visible { outline: 2px solid var(--plugin-focus); outline-offset: 2px; }
  summary { cursor: pointer; margin-bottom: 0.5rem; }
  @media (max-width: 600px) { .grid { grid-template-columns: minmax(0, 1fr); } }
</style>
