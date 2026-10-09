<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { onMount, tick } from 'svelte';
  import { Button, Icon } from '$lib/ui-kit';
  import type { FilePreviewState } from '$lib/app/file-preview-controller';
  import { highlightCode, type CodeSegment } from '../../../../packages/presentation-workbench/code-highlight.js';
  let {state,onClose,onReadLine,onCopyPath}: {state:FilePreviewState;onClose:()=>void;onReadLine:(line:number)=>void;onCopyPath:()=>void} = $props();
  let panel: HTMLElement;
  let heading: HTMLHeadingElement;
  const preview = $derived(state.preview);
  const name = $derived((preview?.path ?? state.path ?? '').split(/[/\\]/).pop() ?? $t('composer.file'));
  const language = $derived(({tsx:'typescript',jsx:'javascript',vue:'xml',svelte:'xml',md:'markdown',yml:'yaml',rs:'rust',py:'python',sh:'bash'} as Record<string,string>)[name.split('.').pop() ?? ''] ?? name.split('.').pop() ?? '');
  function highlightedLines(content:string,language:string) {
    const lines: {value:string;className:string}[][] = [[]];
    function visit(segments:CodeSegment[],classes:string[] = []) {
      for (const segment of segments) {
        const next = segment.className ? [...classes,segment.className] : classes;
        if (segment.children) visit(segment.children,next);
        else (segment.value ?? '').split('\n').forEach((value,index) => {
          if (index) lines.push([]);
          lines.at(-1)!.push({value,className:next.join(' ')});
        });
      }
    }
    visit(highlightCode(content,language)); return lines;
  }
  const lines = $derived(preview ? highlightedLines(preview.content,language) : []);
  onMount(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading?.focus();
    return () => { void tick().then(() => { if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus({preventScroll:true}); }); };
  });
  $effect(() => {
    const current = preview;
    let cancelled = false;
    if (current) void tick().then(() => { if (!cancelled) panel?.querySelector('[aria-current="true"]')?.scrollIntoView({block:'center'}); });
    return () => { cancelled = true; };
  });
</script>

<aside bind:this={panel} class="file-preview-panel" aria-label={$t('file.preview')} aria-busy={state.loading}>
  <header class="file-preview-header">
    <Icon name="file" size={16}/>
    <h2 bind:this={heading} tabindex="-1">{name}</h2>
    <Button variant="ghost" size="icon" aria-label={$t('file.closePreview')} onclick={onClose}><Icon name="close" size={16}/></Button>
  </header>
  <div class="file-preview-toolbar">
    <span class="file-preview-path" title={preview?.path ?? state.path ?? ''}>{preview?.path ?? state.path}</span>
    <Button variant="ghost" size="sm" onclick={onCopyPath}>{$t('file.copyPath')}</Button>
  </div>
  {#if state.loading}<p role="status">{$t('file.loading')}</p>{/if}
  {#if state.error}<p role="alert">{translateMessage($locale,state.error)}</p><Button variant="outline" onclick={() => onReadLine(state.line ?? 1)}>{$t('common.retry')}</Button>{/if}
  {#if preview}
    <div class="file-preview-toolbar">
      <span>{$t('file.lines', { start: preview.startLine, end: preview.startLine + lines.length - 1, read: preview.truncated ? $t('file.readPrefix') : '', total: preview.totalLines })}</span>
      <Button variant="ghost" size="sm" disabled={preview.startLine === 1} onclick={() => onReadLine(Math.max(1,preview.startLine - 300))}>{$t('file.previous')}</Button>
      <Button variant="ghost" size="sm" disabled={preview.startLine + lines.length > preview.totalLines} onclick={() => onReadLine(Math.min(preview.totalLines,preview.startLine + lines.length + 100))}>{$t('file.next')}</Button>
    </div>
    {#if preview.truncated}<p role="status">{$t('file.truncated')}</p>{/if}
    <div class="markdown-content file-preview-content">
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users scroll the file independently.) -->
      <pre tabindex="0" aria-label={$t('file.content')}><code>{#each lines as line,index}<span class="file-preview-line" aria-current={preview.startLine + index === preview.targetLine ? 'true' : undefined} data-line={preview.startLine + index}><span class="file-preview-line-number" aria-hidden="true">{preview.startLine + index}</span><span>{#each line as token}<span class={token.className}>{token.value}</span>{/each}</span></span>{/each}</code></pre>
    </div>
  {/if}
</aside>
