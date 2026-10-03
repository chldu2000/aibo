<script lang="ts">
  import { Badge, Card, CardContent, CardHeader, CardTitle } from '$lib/ui-kit';
  import { backgroundTaskLabels, type BackgroundTask } from '../../../../packages/presentation-workbench/background-tasks.js';
  let { task }: { task: BackgroundTask } = $props();
</script>

<Card as="article" aria-label={`后台任务：${task.name}`}>
  <CardHeader>
    <CardTitle>后台任务 · {task.name}</CardTitle>
    <Badge variant={task.status === 'failed' ? 'destructive' : task.status === 'unknown' ? 'warning' : 'outline'}>{backgroundTaskLabels[task.status]}</Badge>
  </CardHeader>
  <CardContent>
    {#if task.command}<pre class="tool-output">{task.command}</pre>{/if}
    {#if task.activity}<pre class="tool-output">{task.activity}</pre>{/if}
    <details>
      <summary>任务详情</summary>
      <p>任务 ID：{task.id}</p>
      {#if task.exitCode != null}<p>退出码：{task.exitCode}</p>{/if}
      {#if task.outputPath}<pre class="tool-output">输出文件：{task.outputPath}</pre>{/if}
    </details>
  </CardContent>
</Card>

<style>
  .tool-output { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%; }
  p { overflow-wrap: anywhere; }
</style>
