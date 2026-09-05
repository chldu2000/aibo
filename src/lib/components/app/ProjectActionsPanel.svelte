<script lang="ts">
  import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from '$lib/ui-kit';
  import type { ProjectAction, ProjectActionKind, ProjectActionRun, Workspace } from '$lib/types';

  type ProjectActionsPanelProps = {
    workspace: Pick<Workspace, 'id' | 'trust'> | null;
    desktop: boolean;
    projectActions: ProjectAction[];
    projectActionRuns: ProjectActionRun[];
    busy: boolean;
    onSaveProjectAction: (input: { workspaceId: string; actionId?: string | null; name: string; kind: ProjectActionKind; program: string; args: string[]; cwd?: string | null; enabled?: boolean }) => Promise<void>;
    onDeleteProjectAction: (actionId: string) => Promise<void>;
    onRunProjectAction: (actionId: string) => Promise<void>;
  };

  let {
    workspace,
    desktop,
    projectActions,
    projectActionRuns,
    busy,
    onSaveProjectAction,
    onDeleteProjectAction,
    onRunProjectAction,
  }: ProjectActionsPanelProps = $props();

  let actionEditorOpen = $state(false);
  let editingActionId = $state<string | null>(null);
  let actionName = $state('');
  let actionKind = $state<ProjectActionKind>('test');
  let actionProgram = $state('pnpm');
  let actionArgs = $state('test');
  let actionCwd = $state('.');
  let actionSaving = $state(false);
  let runningActionId = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  function editAction(action?: ProjectAction): void {
    editingActionId = action?.id ?? null;
    actionName = action?.name ?? '';
    actionKind = action?.kind ?? 'test';
    actionProgram = action?.program ?? 'pnpm';
    actionArgs = action?.args.join('\n') ?? 'test';
    actionCwd = action?.cwd ?? '.';
    actionError = null;
    actionEditorOpen = true;
  }

  function parseActionArgs(value: string): string[] {
    const input = value.trim();
    if (!input) return [];
    if (input.startsWith('[')) {
      const parsed: unknown = JSON.parse(input);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('参数 JSON 必须是字符串数组');
      }
      return parsed;
    }
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }

  async function saveAction(): Promise<void> {
    if (!desktop || !workspace || !actionName.trim() || !actionProgram.trim()) return;
    actionSaving = true;
    actionError = null;
    try {
      let args: string[];
      try {
        args = parseActionArgs(actionArgs);
      } catch (error) {
        actionError = error instanceof Error ? error.message : '参数格式无效';
        return;
      }
      await onSaveProjectAction({
        workspaceId: workspace.id,
        actionId: editingActionId,
        name: actionName.trim(),
        kind: actionKind,
        program: actionProgram.trim(),
        args,
        cwd: actionCwd.trim() || '.',
        enabled: true,
      });
      actionEditorOpen = false;
    } finally {
      actionSaving = false;
    }
  }

  async function runAction(actionId: string): Promise<void> {
    runningActionId = actionId;
    try { await onRunProjectAction(actionId); } finally { runningActionId = null; }
  }
</script>

{#if workspace}
  <Card class="project-actions-card">
    <CardHeader class="thread-card-heading">
      <CardTitle>工程动作</CardTitle>
      <div class="project-action-heading-actions">
        {#if !desktop}<Badge variant="secondary">桌面模式可用</Badge>{:else if workspace.trust !== 'trusted'}<Badge variant="warning">需信任工作区</Badge>{/if}
        <Button variant="ghost" size="sm" type="button" onclick={() => editAction()} disabled={busy || !desktop}>添加</Button>
      </div>
    </CardHeader>
    <CardContent class="thread-card-content">
      {#if projectActions.length === 0 && !actionEditorOpen}
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
                <Button variant="ghost" size="sm" type="button" onclick={() => void runAction(action.id)} disabled={busy || !desktop || runningActionId !== null || workspace.trust !== 'trusted'}>{runningActionId === action.id ? '运行中…' : '运行'}</Button>
                <Button variant="ghost" size="sm" type="button" onclick={() => editAction(action)} disabled={busy || !desktop || runningActionId !== null}>编辑</Button>
                <Button variant="ghost" size="sm" type="button" onclick={() => void onDeleteProjectAction(action.id)} disabled={busy || !desktop || runningActionId !== null}>删除</Button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#if actionEditorOpen}
        <form class="project-action-editor" onsubmit={(event) => { event.preventDefault(); void saveAction(); }}>
          <Input bind:value={actionName} placeholder="动作名称，如 Test" aria-label="动作名称" maxlength="80" />
          <div class="project-action-editor-row">
            <select bind:value={actionKind} aria-label="动作类型">
              <option value="test">Test</option><option value="lint">Lint</option><option value="build">Build</option><option value="custom">Custom</option>
            </select>
            <Input bind:value={actionProgram} placeholder="程序，如 pnpm" aria-label="动作程序" maxlength="255" />
          </div>
          <Textarea bind:value={actionArgs} rows="3" placeholder="参数：每行一个 argv，如 run\ntest；也可填写 JSON 数组" aria-label="动作参数"></Textarea>
          <Input bind:value={actionCwd} placeholder="工作目录，相对工作区" aria-label="动作工作目录" />
          {#if actionError}<p class="profile-warning">{actionError}</p>{/if}
          <div class="project-action-editor-actions">
            <Button variant="ghost" size="sm" type="button" onclick={() => (actionEditorOpen = false)} disabled={actionSaving}>取消</Button>
            <Button size="sm" type="submit" disabled={actionSaving || !actionName.trim() || !actionProgram.trim()}>{actionSaving ? '保存中…' : '保存动作'}</Button>
          </div>
        </form>
      {/if}
      {#if projectActionRuns.length > 0}
        <div class="project-action-run-list" aria-label="最近工程动作运行结果">
          {#each projectActionRuns.slice(0, 5) as run (run.id)}
            <div class="project-action-run" role="status">
              <small>{projectActions.find((action) => action.id === run.actionId)?.name ?? '工程动作'} · {run.status === 'completed' ? '成功' : run.status === 'timed_out' ? '超时' : '失败'}{run.exitCode === null ? '' : ` · 退出码 ${run.exitCode}`}</small>
              <pre>{run.output || '没有输出'}</pre>
              {#if run.artifactId}<small class="project-action-artifact">输出已保存为任务工件</small>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </CardContent>
  </Card>
{/if}
