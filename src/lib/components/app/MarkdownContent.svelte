<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Badge, Button } from '$lib/ui-kit';
  import {parseMarkdown,displayMarkdown, type InlineSegment, type MarkdownBlock} from '../../../../packages/presentation-workbench/markdown.js';
  import {highlightCode, type CodeSegment} from '../../../../packages/presentation-workbench/code-highlight.js';
  let { content = '' }: { content?: string } = $props();
  let copiedBlockIndex = $state<number | null>(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
  const blocks = $derived(parseMarkdown(displayMarkdown(content)));
  onDestroy(() => { if (copyResetTimer) clearTimeout(copyResetTimer); });

  async function copyCode(value: string, index: number): Promise<void> {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      copiedBlockIndex = index;
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => { copiedBlockIndex = null; copyResetTimer = undefined; }, 1600);
    } catch { copiedBlockIndex = null; }
  }
</script>

{#snippet inline(segments: InlineSegment[])}
  {#each segments as segment}
    {#if segment.kind === 'code'}<code>{segment.value}</code>
    {:else if segment.kind === 'strong'}<strong>{@render inline(segment.children ?? [])}</strong>
    {:else if segment.kind === 'em'}<em>{@render inline(segment.children ?? [])}</em>
    {:else if segment.kind === 'del'}<del>{@render inline(segment.children ?? [])}</del>
    {:else if segment.kind === 'link'}<a href={segment.href} target="_blank" rel="noreferrer">{@render inline(segment.children ?? [])}</a>
    {:else}{segment.value}{/if}
  {/each}
{/snippet}

{#snippet highlighted(segments: CodeSegment[])}
  {#each segments as segment}{#if segment.children}<span class={segment.className}>{@render highlighted(segment.children)}</span>{:else}{segment.value}{/if}{/each}
{/snippet}

{#snippet listItems(block: Extract<MarkdownBlock, {kind: 'list'}>)}
  {#each block.items as item}
    <li class:markdown-task={item.checked !== null}>
      {#if item.checked !== null}<span class="markdown-task-check" role="img" aria-label={item.checked ? '已完成' : '未完成'}>{item.checked ? '☑' : '☐'}</span>{/if}
      <div class="markdown-list-content">{@render renderBlocks(item.blocks)}</div>
    </li>
  {/each}
{/snippet}

{#snippet renderBlocks(values: MarkdownBlock[])}
  {#each values as block}
    {#if block.kind === 'code'}
      <div class="markdown-code-block">
        <div class="markdown-code-toolbar">
          {#if block.language}<Badge variant="outline">{block.language}</Badge>{:else}<span></span>{/if}
          <Button variant="ghost" size="sm" type="button" onclick={() => void copyCode(block.lines.join('\n'), block.index)}>
            {copiedBlockIndex === block.index ? '已复制' : '复制'}
          </Button>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll long code.) -->
        <pre class="markdown-code" tabindex="0" aria-label="代码块"><code>{@render highlighted(highlightCode(block.lines.join('\n'), block.language))}</code></pre>
      </div>
    {:else if block.kind === 'heading'}
      <svelte:element this={`h${block.level}`} class={`markdown-heading markdown-heading-${block.level}`}>{@render inline(block.segments)}</svelte:element>
    {:else if block.kind === 'list'}
      {#if block.ordered}<ol class="markdown-list" start={block.start}>{@render listItems(block)}</ol>
      {:else}<ul class="markdown-list">{@render listItems(block)}</ul>{/if}
    {:else if block.kind === 'quote'}
      <blockquote class="markdown-quote">{@render renderBlocks(block.blocks)}</blockquote>
    {:else if block.kind === 'rule'}
      <hr class="markdown-rule" />
    {:else if block.kind === 'table'}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users must be able to scroll wide tables.) -->
      <div class="markdown-table-scroll" role="region" tabindex="0" aria-label="表格，可横向滚动">
        <table class="markdown-table">
          <thead><tr>{#each block.header as cell, column}<th scope="col" class={`markdown-align-${block.align[column] ?? 'left'}`}>{@render inline(cell)}</th>{/each}</tr></thead>
          <tbody>{#each block.rows as row}<tr>{#each row as cell, column}<td class={`markdown-align-${block.align[column] ?? 'left'}`}>{@render inline(cell)}</td>{/each}</tr>{/each}</tbody>
        </table>
      </div>
    {:else}<p>{@render inline(block.segments)}</p>{/if}
  {/each}
{/snippet}

<div class="markdown-content">{@render renderBlocks(blocks)}</div>
