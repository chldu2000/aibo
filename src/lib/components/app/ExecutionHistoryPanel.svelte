<script lang="ts">
  import { translateMessage } from '../../../../packages/i18n/index.js';
  import { locale, t } from '$lib/i18n/runtime';
  import { formatDateTime } from '../../../../packages/i18n/index.js';
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from '$lib/ui-kit';
  import { canStopExecution, executionActive, executionStatus, executionOutput, type ExecutionHistoryState } from '$lib/app/execution-history-controller';
  let { workspaces, workspaceId, windowId, state, desktop, onSelectWorkspace, onStop, onOlder, onNewer, onLatest }: {
    workspaces: { id: string; label: string }[]; workspaceId: string | null; windowId: string;
    state: ExecutionHistoryState; desktop: boolean; onSelectWorkspace: (id: string) => void;
    onStop: (key: string) => void;
    onOlder: () => void; onNewer: () => void; onLatest: () => void;
  } = $props();
</script>

<section aria-label={$t('history.execution')} data-ui-component="execution-history" class="execution-history">
  <nav aria-label={$t('history.executionWorkspaces')} class="history-workspaces">
    {#each workspaces as workspace (workspace.id)}
      <Button variant={workspace.id === workspaceId ? 'secondary' : 'ghost'} aria-pressed={workspace.id === workspaceId} onclick={() => onSelectWorkspace(workspace.id)}>{workspace.label}</Button>
    {/each}
  </nav>
  <p>{$t('history.executionDescription')}</p>
  {#if !desktop}<p role="status">{$t('history.executionDesktop')}</p>
  {:else if !workspaceId}<p role="status">{$t('history.addWorkspace')}</p>
  {:else if state.loading}<p role="status">{$t('history.loadingExecutions')}</p>
  {/if}
  {#each state.errors as error}<p role="alert">{translateMessage($locale, error)}</p>{/each}
  {#if desktop && workspaceId && !state.loading && !state.entries.length && !state.errors.length}<p role="status">{$t('history.noExecutions')}</p>{/if}
  <nav aria-label={$t('history.executionPages')} class="history-workspaces">
    <Button variant="outline" onclick={onLatest} disabled={!desktop || !workspaceId}>{$t('history.latestRecords')}</Button>
    <Button variant="outline" onclick={onNewer} disabled={!desktop || !state.hasNewer}>{$t('history.newerPage')}</Button>
    <span role="status">{$t('history.page', { page: state.page })}</span>
    <Button variant="outline" onclick={onOlder} disabled={!desktop || state.loading || !state.hasOlder}>{$t('history.olderPage')}</Button>
  </nav>
  <div class="history-entries">
    {#each state.entries as entry (entry.key)}
      <Card as="article" aria-label={`${entry.kind === 'git' ? $t('history.workspaceWrite') : $t('history.projectTask')} · ${translateMessage($locale, entry.title)}`}>
        <CardHeader>
          <CardTitle>{entry.kind === 'git' ? $t('history.workspaceWrite') : $t('history.projectTask')} · {translateMessage($locale, entry.title)}</CardTitle>
          <Badge variant={entry.status === 'outcome_unknown' || entry.status === 'failed' ? 'warning' : 'outline'}>{executionStatus(entry, $locale)}</Badge>
        </CardHeader>
        <CardContent>
          <p>{$t('history.started')}<time datetime={entry.startedAt}>{formatDateTime($locale, entry.startedAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>{#if entry.completedAt}{$t('history.finished')}<time datetime={entry.completedAt}>{formatDateTime($locale, entry.completedAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>{/if}</p>
          <details><summary>{$t('history.executionDetails')}</summary>
          {#if entry.caller}<p>{$t('history.caller', { window: entry.caller })}</p>{/if}
          {#if entry.input}<Textarea aria-label={$t('history.inputLabel', { title: entry.title })} value={entry.input} readonly rows={3} />{/if}
          {#if entry.output}<Textarea aria-label={$t('history.outputLabel', { title: entry.title })} value={executionOutput(entry,$locale)} readonly rows={6} />{/if}
          </details>
          {#if canStopExecution(entry, windowId)}
            <Button variant="outline" disabled={!desktop || state.stopping.includes(entry.key)} onclick={() => onStop(entry.key)} aria-label={$t('history.stopLabel', { title: entry.title })}>{state.stopping.includes(entry.key) ? $t('history.stopping') : $t('history.stop')}</Button>
          {:else if executionActive(entry) && entry.kind === 'git' && entry.caller !== windowId}
            <p>{$t('history.stopInOrigin')}</p>
          {/if}
        </CardContent>
      </Card>
    {/each}
  </div>
</section>

<style>
  .execution-history { display: flex; flex-direction: column; gap: 12px; padding: 16px; min-height: 0; overflow: auto; }
  .history-workspaces { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .history-entries { display: grid; gap: 12px; }
</style>
