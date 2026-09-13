<script lang="ts">
  import { Badge, Button } from '$lib/ui-kit';
  import {parseMarkdown,inlineSegments,displayMarkdown} from '../../../../packages/presentation-workbench/markdown.js';
  let { content = '' }: { content?: string } = $props();
  let copiedBlockIndex = $state<number | null>(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  // Attachment references are transport metadata, not conversational prose.
  // Keep them in the durable prompt for adapter replay, but hide the internal
  // block from the rendered bubble.
  const displayContent = $derived(
    displayMarkdown(content),
  );
  const blocks = $derived(parseMarkdown(displayContent));

  async function copyCode(value: string, index: number): Promise<void> {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      copiedBlockIndex = index;
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        copiedBlockIndex = null;
        copyResetTimer = undefined;
      }, 1600);
    } catch {
      copiedBlockIndex = null;
    }
  }
</script>

<div class="markdown-content">
  {#each blocks as block, blockIndex}
    {#if block.kind === 'code'}
      <div class="markdown-code-block">
        <div class="markdown-code-toolbar">
          {#if block.language}<Badge variant="outline">{block.language}</Badge>{:else}<span></span>{/if}
          <Button variant="ghost" size="sm" type="button" onclick={() => void copyCode(block.lines.join('\n'), blockIndex)}>
            {copiedBlockIndex === blockIndex ? '已复制' : '复制'}
          </Button>
        </div>
        <pre class="markdown-code"><code>{block.lines.join('\n')}</code></pre>
      </div>
    {:else if block.kind === 'heading'}
      <h3 class={`markdown-heading markdown-heading-${block.level}`}>{#each inlineSegments(block.lines[0]) as segment}{#if segment.kind === 'code'}<code>{segment.value}</code>{:else if segment.kind === 'strong'}<strong>{segment.value}</strong>{:else if segment.kind === 'link'}<a href={segment.href} target="_blank" rel="noreferrer">{segment.value}</a>{:else}{segment.value}{/if}{/each}</h3>
    {:else if block.kind === 'list'}
      <ul class="markdown-list">
        {#each block.lines as line}<li>{#each inlineSegments(line) as segment}{#if segment.kind === 'code'}<code>{segment.value}</code>{:else if segment.kind === 'strong'}<strong>{segment.value}</strong>{:else if segment.kind === 'link'}<a href={segment.href} target="_blank" rel="noreferrer">{segment.value}</a>{:else}{segment.value}{/if}{/each}</li>{/each}
      </ul>
    {:else}
      <p>{#each inlineSegments(block.lines[0]) as segment}{#if segment.kind === 'code'}<code>{segment.value}</code>{:else if segment.kind === 'strong'}<strong>{segment.value}</strong>{:else if segment.kind === 'link'}<a href={segment.href} target="_blank" rel="noreferrer">{segment.value}</a>{:else}{segment.value}{/if}{/each}</p>
    {/if}
  {/each}
</div>
