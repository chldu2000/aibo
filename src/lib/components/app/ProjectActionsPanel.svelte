<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from '$lib/ui-kit';
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
      <CardTitle>工程动作</CardTitle>
      <div class="project-action-heading-actions">
        {#if !desktop}<Badge variant="secondary">桌面模式可用</Badge>{:else if workspace.trust !== 'trusted'}<Badge variant="warning">需信任工作区</Badge>{/if}
        <Button variant="ghost" size="sm" type="button" onclick={() => onEditProjectAction(null)} disabled={busy || !desktop || editor.saving}>添加</Button>
      </div>
    </CardHeader>
    <CardContent class="thread-card-content">
      {#if projectActions.length === 0 && !editor.open}
        <p class="thread-empty">注册 Test、Lint 或 Build 后，可在工作区内受控运行。</p>
      {:else}
        <div class="thread-list" aria-label="工程动作列表">
          {#each projectActions as action (action.id)}
            <div class="thread-item changeset-file project-action-item">
              <div class="thread-copy">
                <strong>{action.name}</strong>
                <small>{action.program} {action.args.join(' ')} · cwd {action.cwd}</small>
              </div>
              <div class="project-action-buttons">
                <Button variant="ghost" size="sm" type="button" onclick={() => void onRunProjectAction(action.id)} disabled={busy || !desktop || runningActionId !== null || editor.saving || !action.enabled || workspace.trust !== 'trusted'}>{runningActionId === action.id ? '运行中…' : '运行'}</Button>
                <Button variant="ghost" size="sm" type="button" onclick={() => onEditProjectAction(action.id)} disabled={busy || !desktop || runningActionId !== null || editor.saving}>编辑</Button>
                <Button variant="ghost" size="sm" type="button" onclick={() => void onDeleteProjectAction(action.id)} disabled={busy || !desktop || runningActionId !== null || editor.saving}>删除</Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#if editor.open}
        <form class="project-action-editor" onsubmit={(event) => { event.preventDefault(); void onSaveProjectEditor(); }}>
          <Input disabled={editor.saving} bind:value={() => editor.name, (value) => onProjectField('name', value)} placeholder="动作名称，如 Test" aria-label="动作名称" maxlength="80" />
          <div class="project-action-editor-row">
            <select disabled={editor.saving} bind:value={() => editor.kind, (value) => onProjectField('kind', value)} aria-label="动作类型">
              <option value="test">Test</option><option value="lint">Lint</option><option value="build">Build</option><option value="custom">Custom</option>
            </select>
            <Input disabled={editor.saving} bind:value={() => editor.program, (value) => onProjectField('program', value)} placeholder="程序，如 pnpm" aria-label="动作程序" maxlength="255" />
          </div>
          <Textarea disabled={editor.saving} bind:value={() => editor.args, (value) => onProjectField('args', value)} rows="3" placeholder="参数：每行一个 argv，如 run\ntest；也可填写 JSON 数组" aria-label="动作参数"></Textarea>
          <Input disabled={editor.saving} bind:value={() => editor.cwd, (value) => onProjectField('cwd', value)} placeholder="工作目录，相对工作区" aria-label="动作工作目录" />
          {#if editor.error}<p class="profile-warning">{editor.error}</p>{/if}
          <div class="project-action-editor-actions">
            <Button variant="ghost" size="sm" type="button" onclick={onCloseProjectEditor} disabled={editor.saving}>取消</Button>
            <Button size="sm" type="submit" disabled={editor.saving || !editor.name.trim() || !editor.program.trim()}>{editor.saving ? '保存中…' : '保存动作'}</Button>
          </div>
        </form>
      {/if}
      {#if projectActionRuns.length > 0}
        <div class="project-action-run-list" aria-label="最近工程动作运行结果">
          {#each projectActionRuns.slice(0, 5) as run (run.id)}
            <div class="project-action-run" role="status">
              <small>{run.actionName ?? projectActions.find((action) => action.id === run.actionId)?.name ?? '工程动作'} · {run.status === 'awaiting_approval' ? '等待宿主批准' : run.status === 'rejected' ? '未执行' : run.status === 'running' ? '执行中' : run.status === 'outcome_unknown' ? '结果未知，请核对实际更改后再操作' : run.status === 'completed' ? '成功' : run.status === 'timed_out' ? '超时' : '失败'}{run.exitCode === null ? '' : ` · 退出码 ${run.exitCode}`}</small>
              {#if run.status === 'running' || run.status === 'awaiting_approval'}
                <Button variant="ghost" size="sm" type="button" onclick={() => void onCancelProjectAction(run.id)} disabled={!desktop} aria-label={`停止 ${run.actionName ?? '工程动作'}`}>停止</Button>
              {/if}
              <pre>{run.output || '没有输出'}</pre>
              {#if run.artifactId}<small class="project-action-artifact">输出已保存为任务工件</small>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>
{/if}
