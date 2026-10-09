<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import { Badge, Card, CardContent, CardHeader, CardTitle } from '$lib/ui-kit';
  import { type BackgroundTask } from '../../../../packages/presentation-workbench/background-tasks.js';
  let { task }: { task: BackgroundTask } = $props();
</script>

<Card as="article" aria-label={$t('background.accessibility', { name: task.name })}>
  <CardHeader>
    <CardTitle>{$t('background.title', { name: task.name })}</CardTitle>
    <Badge variant={task.status === 'failed' ? 'destructive' : task.status === 'unknown' ? 'warning' : 'outline'}>{$t(`background.status.${task.status}`)}</Badge>
  </CardHeader>
  <CardContent>
    {#if task.command}<pre class="tool-output">{task.command}</pre>{/if}
    {#if task.activity}<pre class="tool-output">{task.activity}</pre>{/if}
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
</style>
