<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import { Button, Card, CardHeader, CardTitle, Icon } from '$lib/ui-kit';
  import type { WorkspaceFileDiff } from '$lib/types';

  type DiffLineKind = 'added' | 'removed' | 'hunk' | 'meta' | 'context';

  type DiffLine = {
    kind: DiffLineKind;
    text: string;
    marker: string;
    oldLine: number | null;
    newLine: number | null;
  };

  type WorkspaceFileDiffPreviewProps = {
    fileDiff: WorkspaceFileDiff | null;
    fileDiffLoading: boolean;
    fileDiffError: string | null;
    selectedPath: string | null;
    selectedStaged: boolean;
    contextLabel?: string | null;
    onClose: () => void;
  };

  let {
    fileDiff,
    fileDiffLoading,
    fileDiffError,
    selectedPath,
    selectedStaged,
    contextLabel = null,
    onClose,
  }: WorkspaceFileDiffPreviewProps = $props();

  const DIFF_PAGE_SIZE = 2_000;
  let visibleLineCount = $state(DIFF_PAGE_SIZE);
  let previousFileDiff: WorkspaceFileDiff | null = null;
  let previousSelectedPath: string | null = null;
  let previousSelectedStaged = false;

  function diffLines(diff: string): DiffLine[] {
    let oldLine = 0;
    let newLine = 0;
    const lines = diff.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();

    return lines.map((text): DiffLine => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        return { kind: 'hunk', text, marker: ' ', oldLine: null, newLine: null };
      }

      if (
        text.startsWith('diff ') ||
        text.startsWith('index ') ||
        text.startsWith('--- ') ||
        text.startsWith('+++ ') ||
        text.startsWith('Binary files') ||
        text.startsWith('\\ No newline')
      ) {
        return { kind: 'meta', text, marker: ' ', oldLine: null, newLine: null };
      }

      if (text.startsWith('+')) {
        newLine += 1;
        return { kind: 'added', text: text.slice(1), marker: '+', oldLine: null, newLine };
      }

      if (text.startsWith('-')) {
        oldLine += 1;
        return { kind: 'removed', text: text.slice(1), marker: '−', oldLine, newLine: null };
      }

      const context = text.startsWith(' ') ? text.slice(1) : text;
      oldLine += 1;
      newLine += 1;
      return { kind: 'context', text: context, marker: ' ', oldLine, newLine };
    });
  }

  $effect(() => {
    const currentFileDiff = fileDiff;
    const currentSelectedPath = selectedPath;
    const currentSelectedStaged = selectedStaged;
    if (
      currentFileDiff !== previousFileDiff ||
      currentSelectedPath !== previousSelectedPath ||
      currentSelectedStaged !== previousSelectedStaged
    ) {
      previousFileDiff = currentFileDiff;
      previousSelectedPath = currentSelectedPath;
      previousSelectedStaged = currentSelectedStaged;
      visibleLineCount = DIFF_PAGE_SIZE;
    }
  });

  const parsedDiffLines = $derived(fileDiff?.available ? diffLines(fileDiff.diff) : []);
  const visibleDiffLines = $derived(parsedDiffLines.slice(0, visibleLineCount));
  const hasMoreLines = $derived(visibleDiffLines.length < parsedDiffLines.length);
  const title = $derived(fileDiff?.path ?? selectedPath ?? $t('diff.loadingFile'));
  const stateLabel = $derived(contextLabel ?? (
    fileDiff ? (fileDiff.staged ? $t('diff.index') : $t('scope.workspace')) : selectedStaged ? $t('diff.index') : $t('scope.workspace')
  ));
</script>

<Card
  as="section"
  class="workspace-file-diff-preview"
  data-ui-component="workspace-file-diff-preview"
  aria-label={$t('diff.preview')}
  aria-busy={fileDiffLoading}
>
  <CardHeader class="workspace-file-diff-preview-header">
    <div class="workspace-file-diff-preview-heading">
      <div class="workspace-file-diff-preview-title-copy">
        <CardTitle>{title}</CardTitle>
        <small>{stateLabel}{fileDiff?.truncated ? $t('diff.truncatedSuffix') : ''}</small>
      </div>
    </div>
    <Button variant="ghost" size="icon" type="button" aria-label={$t('diff.closePreview')} title={$t('common.close')} onclick={onClose}>
      <Icon name="close" size={14} />
    </Button>
  </CardHeader>

  <div class="workspace-file-diff-preview-content">
    {#if fileDiffLoading}
      <div class="workspace-file-diff-message">{$t('diff.loading')}</div>
    {:else if fileDiffError}
      <div class="workspace-file-diff-message" role="alert">{fileDiffError}</div>
    {:else if fileDiff?.available}
      <div class="workspace-file-diff-lines" role="list" aria-label={$t('diff.contentLabel', { path: fileDiff.path })}>
        {#each visibleDiffLines as line, index (`${index}:${line.kind}:${line.text}`)}
          <div class={`workspace-file-diff-line workspace-file-diff-line-${line.kind}`} role="listitem">
            <span class="workspace-file-diff-line-number" aria-hidden="true">{line.oldLine ?? ''}</span>
            <span class="workspace-file-diff-line-number" aria-hidden="true">{line.newLine ?? ''}</span>
            <span class="workspace-file-diff-line-marker" aria-hidden="true">{line.marker}</span>
            <code>{line.text || ' '}</code>
          </div>
        {/each}
        {#if hasMoreLines}
          <div class="workspace-file-diff-load-more">
            <span>{$t('diff.lines', { visible: visibleDiffLines.length, total: parsedDiffLines.length })}</span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onclick={() => (visibleLineCount += DIFF_PAGE_SIZE)}
            >{$t('common.more')}</Button>
          </div>
        {:else if fileDiff.truncated}
          <div class="workspace-file-diff-truncated">{$t('diff.truncated')}</div>
        {/if}
      </div>
    {:else}
      <div class="workspace-file-diff-message">{fileDiff?.reason ?? $t('diff.empty')}</div>
    {/if}
  </div>
</Card>
