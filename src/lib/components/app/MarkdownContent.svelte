<script lang="ts">
  import { Badge, Button } from '$lib/ui-kit';
  type InlineSegment = { kind: 'text' | 'code' | 'strong' | 'link'; value: string; href?: string };
  type MarkdownBlock =
    | { kind: 'paragraph' | 'heading' | 'list'; lines: string[]; level?: number }
    | { kind: 'code'; lines: string[]; language: string };

  let { content = '' }: { content?: string } = $props();
  let copiedBlockIndex = $state<number | null>(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

  function parseMarkdown(value: string): MarkdownBlock[] {
    const lines = value.replace(/\r\n?/g, '\n').split('\n');
    const blocks: MarkdownBlock[] = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        index += 1;
        continue;
      }
      const fence = line.match(/^\s*```([^`]*)\s*$/);
      if (fence) {
        const code: string[] = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push({ kind: 'code', lines: code, language: fence[1].trim() });
        continue;
      }
      const heading = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        blocks.push({ kind: 'heading', lines: [heading[2]], level: heading[1].length });
        index += 1;
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        const list: string[] = [];
        while (index < lines.length && (/^\s*[-*+]\s+/.test(lines[index]) || /^\s*\d+[.)]\s+/.test(lines[index]))) {
          list.push(lines[index].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''));
          index += 1;
        }
        blocks.push({ kind: 'list', lines: list });
        continue;
      }
      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() !== '' && !/^\s*```/.test(lines[index]) && !/^\s*#{1,3}\s+/.test(lines[index]) && !/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[index])) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ kind: 'paragraph', lines: [paragraph.join('\n')] });
    }
    return blocks;
  }

  function inlineSegments(value: string): InlineSegment[] {
    const segments: InlineSegment[] = [];
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[([^\]\n]+)\]\(([^)\n]+)\))/g;
    let last = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (start > last) segments.push({ kind: 'text', value: value.slice(last, start) });
      const token = match[0];
      if (token.startsWith('`')) segments.push({ kind: 'code', value: token.slice(1, -1) });
      else if (token.startsWith('**') || token.startsWith('__')) segments.push({ kind: 'strong', value: token.slice(2, -2) });
      else if (match[2] && match[3] && SAFE_LINK.test(match[3])) segments.push({ kind: 'link', value: match[2], href: match[3] });
      else segments.push({ kind: 'text', value: token });
      last = start + token.length;
    }
    if (last < value.length) segments.push({ kind: 'text', value: value.slice(last) });
    return segments;
  }

  // Attachment references are transport metadata, not conversational prose.
  // Keep them in the durable prompt for adapter replay, but hide the internal
  // block from the rendered bubble.
  const displayContent = $derived(
    content.replace(/\n?\[AIBO_CONTEXT_ATTACHMENTS\][\s\S]*?\[\/AIBO_CONTEXT_ATTACHMENTS\]/g, '').trimEnd(),
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
