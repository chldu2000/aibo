<script lang="ts">
  import { t } from '$lib/i18n/runtime';
  import { Select, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from '$lib/ui-kit';
  import type { ProjectAction, ProjectActionRun, Workspace } from '$lib/types';

  type ProjectActionsPanelProps = {
    workspace: Pick<Workspace, 'id' | 'trust'> | null;
    desktop: boolean;
    projectActions: ProjectAction[];
    projectActionRuns: ProjectActionRun[];
    busy: boolean;
    editor: import('../../../../packages/plugin-protocol/src/presentation-inspector').PresentationProjectEditor;
    runningActionId: string | null;
    onEditProjectAction: (id: string | null) => void;
    onProjectField: (field: import('$lib/app/project-editor-controller').ProjectEditorField, value: string) => void;
    onSaveProjectEditor: () => Promise<void>;
    onCloseProjectEditor: () => void;
    onDeleteProjectAction: (actionId: string) => Promise<void>;
    onRunProjectAction: (actionId: string) => Promise<void>;
    onCancelProjectAction: (runId: string) => Promise<void>;
  };

  let {
    workspace,
    desktop,
    projectActions,
    projectActionRuns,
    busy,
    editor, runningActionId, onEditProjectAction, onProjectField, onSaveProjectEditor, onCloseProjectEditor,
    onDeleteProjectAction,
    onRunProjectAction,
    onCancelProjectAction,
  }: ProjectActionsPanelProps = $props();

</script>

{#if workspace}
  <Card class="project-actions-card">
    <CardHeader class="thread-card-heading">
      <CardTitle>{$t('project.title')}</CardTitle>
      <div class="project-action-heading-actions">
        {#if !desktop}<Badge variant="secondary">{$t('project.desktop')}</Badge>{:else if workspace.trust !== 'trusted'}<Badge variant="warning">{$t('project.trustRequired')}</Badge>{/if}
        <Button variant="ghost" size="sm" type="button" onclick={() => onEditProjectAction(null)} disabled={busy || !desktop || editor.saving}>{$t('common.add')}</Button>
      </div>
    </CardHeader>
    <CardContent class="thread-card-content">
      {#if projectActions.length === 0 && !editor.open}
        <p class="thread-empty">{$t('project.empty')}</p>
      {:else}
        <div class="thread-list" aria-label={$t('project.list')}>
          {#each projectActions as action (action.id)}
            <div class="thread-item changeset-file project-action-item">
              <div class="thread-copy">
                <strong>{action.name}</strong>
                <small>{action.program} {action.args.join(' ')} · cwd {action.cwd}</small>
              </div>
              <div class="project-action-buttons">
                <Button variant="ghost" size="sm" type="button" onclick={() => void onRunProjectAction(action.id)} disabled={busy || !desktop || runningActionId !== null || editor.saving || !action.enabled || workspace.trust !== 'trusted'}>{runningActionId === action.id ? $t('project.running') : $t('project.run')}</Button>
                <Button variant="ghost" size="sm" type="button" onclick={() => onEditProjectAction(action.id)} disabled={busy || !desktop || runningActionId !== null || editor.saving}>{$t('common.edit')}</Button>
                <Button variant="ghost" size="sm" type="button" onclick={() => void onDeleteProjectAction(action.id)} disabled={busy || !desktop || runningActionId !== null || editor.saving}>{$t('common.delete')}</Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#if editor.open}
        <form class="project-action-editor" onsubmit={(event) => { event.preventDefault(); void onSaveProjectEditor(); }}>
          <Input disabled={editor.saving} bind:value={() => editor.name, (value) => onProjectField('name', value)} placeholder={$t('project.namePlaceholder')} aria-label={$t('project.name')} maxlength="80" />
          <div class="project-action-editor-row">
            <Select disabled={editor.saving} value={editor.kind} onSelect={value => onProjectField('kind', value)} aria-label={$t('project.kind')}
              options={[{value:'test',label:$t('external.test')},{value:'lint',label:$t('external.lint')},{value:'build',label:$t('external.build')},{value:'custom',label:$t('external.custom')}]} />
            <Input disabled={editor.saving} bind:value={() => editor.program, (value) => onProjectField('program', value)} placeholder={$t('project.programPlaceholder')} aria-label={$t('project.program')} maxlength="255" />
          </div>
          <Textarea disabled={editor.saving} bind:value={() => editor.args, (value) => onProjectField('args', value)} rows="3" placeholder={$t('project.argsPlaceholder')} aria-label={$t('project.args')}></Textarea>
          <Input disabled={editor.saving} bind:value={() => editor.cwd, (value) => onProjectField('cwd', value)} placeholder={$t('project.cwdPlaceholder')} aria-label={$t('project.cwd')} />
          {#if editor.error}<p class="profile-warning">{editor.error}</p>{/if}
          <div class="project-action-editor-actions">
            <Button variant="ghost" size="sm" type="button" onclick={onCloseProjectEditor} disabled={editor.saving}>{$t('common.cancel')}</Button>
            <Button size="sm" type="submit" disabled={editor.saving || !editor.name.trim() || !editor.program.trim()}>{editor.saving ? $t('project.saving') : $t('project.save')}</Button>
          </div>
        </form>
      {/if}
      {#if projectActionRuns.length > 0}
        <div class="project-action-run-list" aria-label={$t('project.recent')}>
          {#each projectActionRuns.slice(0, 5) as run (run.id)}
            <div class="project-action-run" role="status">
              <small>{run.actionName ?? projectActions.find((action) => action.id === run.actionId)?.name ?? $t('project.title')} · {run.status === 'awaiting_approval' ? $t('project.awaitingApproval') : run.status === 'rejected' ? $t('project.rejected') : run.status === 'running' ? $t('project.inProgress') : run.status === 'outcome_unknown' ? $t('project.unknownOutcome') : run.status === 'completed' ? $t('project.success') : run.status === 'timed_out' ? $t('project.timeout') : $t('project.failed')}{run.exitCode === null ? '' : $t('project.exitCode', { code: run.exitCode })}</small>
              {#if run.status === 'running' || run.status === 'awaiting_approval'}
                <Button variant="ghost" size="sm" type="button" onclick={() => void onCancelProjectAction(run.id)} disabled={!desktop} aria-label={$t('history.stopLabel', { title: run.actionName ?? $t('project.title') })}>{$t('history.stop')}</Button>
              {/if}
              <pre>{run.output || $t('project.noOutput')}</pre>
              {#if run.artifactId}<small class="project-action-artifact">{$t('project.artifactSaved')}</small>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>
{/if}
