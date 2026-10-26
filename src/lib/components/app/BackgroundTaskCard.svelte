<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import { Button, Badge, Card, CardContent, CardHeader, CardTitle } from '$lib/ui-kit';
  import { type BackgroundTask } from '../../../../packages/presentation-workbench/background-tasks.js';
  let { task, onRead }: { task: BackgroundTask; onRead?: () => void } = $props();
  // Plugins with full output send it separately and keep `activity` short; older history stored the whole output in `activity`.
  const fullOutput = $derived(task.output ?? task.activity);
  const outputLines = $derived(fullOutput.trimEnd().split('\n'));
  const preview = $derived(task.output !== undefined || (outputLines.length === 1 && fullOutput.length <= 160)
    ? task.activity : outputLines.filter(line => line.trim()).at(-1) ?? '');
  const foldOutput = $derived(fullOutput.trimEnd() !== preview.trimEnd());
</script>

<Card as="article" aria-label={$t('background.accessibility', { name: task.name })}>
  <CardHeader>
    <CardTitle>{$t('background.title', { name: task.name })}</CardTitle>
    <Badge variant={task.status === 'failed' ? 'destructive' : task.status === 'unknown' ? 'warning' : 'outline'}>{$t(`background.status.${task.status}`)}</Badge>
  </CardHeader>
  <CardContent>
    {#if onRead}<Button variant="ghost" onclick={onRead}>{$t('background.readOutput')}</Button>{/if}
    {#if task.outputTruncated}<p>{$t('background.outputTruncated')}</p>{/if}
    {#if task.command}<pre class="tool-output">{task.command}</pre>{/if}
    {#if foldOutput}
      <details class="activity">
        <summary>{$t('background.activity', { count: outputLines.length })}{#if preview}<span class="preview">{preview}</span>{/if}</summary>
        <pre class="tool-output">{fullOutput}</pre>
      </details>
    {:else if preview}<pre class="tool-output">{preview}</pre>{/if}
    <details>
      <summary>{$t('background.details')}</summary>
      <p>{$t('background.id', { id: task.id })}</p>
      {#if task.exitCode != null}<p>{$t('background.exitCode', { code: task.exitCode })}</p>{/if}
      {#if task.outputPath}<pre class="tool-output">{$t('background.output', { path: task.outputPath })}</pre>{/if}
    </details>
  </CardContent>
</Card>

<style>
  .tool-output { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%; }
  p { overflow-wrap: anywhere; }
  .activity > summary { min-width: 0; }
  .activity[open] .preview { display: none; }
  .preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
  .activity .tool-output { max-height: 24rem; overflow: auto; }
</style>
