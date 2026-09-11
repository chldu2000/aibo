import '/src/app.css';
import { invoke } from '@tauri-apps/api/core';
import { mount, unmount, tick } from 'svelte';
import { setUiKit } from '/src/lib/ui-kit/registry.ts';
import Panel from '/src/lib/components/app/ExecutionHistoryPanel.svelte';
import { createExecutionHistoryController } from '/src/lib/app/execution-history-controller.ts';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { const value = await read(); if (value) return value; await pause(30); }
  throw Error(label);
}
const report = data => fetch('/__task_report', { method: 'POST', body: JSON.stringify(data) });
try {
  const { workspacePath } = await (await fetch('/__task_config')).json();
  const workspace = await invoke('add_workspace', { path: workspacePath });
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
  await fetch('/__task_approval', { method: 'POST', body: JSON.stringify({ marker: 'git.index-all', decision: '取消', kind: 'git' }) });
  let gitDenied = false;
  try { await invoke('apply_workspace_git_action', { workspaceId: workspace.id, action: 'stage_all', requestId: 'native-git-denied' }); }
  catch (error) { gitDenied = error.code === 'approval_rejected'; }
  const deniedWrites = await invoke('list_workspace_write_runs', { workspaceId: workspace.id });
  if (!gitDenied || deniedWrites.length !== 1 || deniedWrites[0].status !== 'rejected' || deniedWrites[0].approvalOutcome !== 'denied') throw Error('Native Git denial was not persisted');
  // The outer runner also checks the real index before approving the next request.
  await fetch('/__git_denial_check');
  await fetch('/__task_approval', { method: 'POST', body: JSON.stringify({ marker: 'git.index-all', decision: '允许本次执行', kind: 'git' }) });
  const staged = await invoke('apply_workspace_git_action', { workspaceId: workspace.id, action: 'stage_all', requestId: 'native-stage' });
  if (!staged.applied) throw Error('Native Git staging failed');
  const stagedAgain = await invoke('apply_workspace_git_action', { workspaceId: workspace.id, action: 'stage_all', requestId: 'native-stage' });
  if (JSON.stringify(stagedAgain) !== JSON.stringify(staged)) throw Error('Duplicate native request changed its result');
  let changedInputRejected = false, missingIdRejected = false;
  try { await invoke('apply_workspace_git_action', { workspaceId: workspace.id, action: 'unstage_all', requestId: 'native-stage' }); } catch { changedInputRejected = true; }
  try { await invoke('apply_workspace_git_action', { workspaceId: workspace.id, action: 'stage_all' }); } catch { missingIdRejected = true; }
  if (!changedInputRejected || !missingIdRejected) throw Error('Native write request identity was not enforced');

  const writeRuns = await invoke('list_workspace_write_runs', { workspaceId: workspace.id });
  const writeRun = writeRuns.find(run => run.requestId === 'native-stage');
  if (writeRuns.length !== 2 || writeRun?.requestId !== 'native-stage' || writeRun?.callerWindow !== 'main') throw Error('Native duplicate created a new run or lost host caller identity');
  if (!writeRun || writeRun.schema !== 'aibo.workspace-write-run/v2' || writeRun.approvalOutcome !== 'approved' || !writeRun.approvalDecidedAt || writeRun.status !== 'completed' || writeRun.snapshot.input.action !== 'stage_all' || !writeRun.result?.output.applied || !writeRun.completedAt) throw Error('Native write history does not match the completed operation');

  await fetch('/__task_approval', { method: 'POST', body: JSON.stringify({ marker: 'git.commit', decision: '允许本次执行', kind: 'git' }) });
  const gitExecution = invoke('commit_workspace_changes', { workspaceId: workspace.id, message: 'Native history fixture\n\nCo-authored-by: Codex <codex@openai.com>', requestId: 'native-cancel-commit' }).then(value => ({value}), error => ({error}));
  await until(async () => (await (await fetch('/__task_started')).json()).includes('git-before'), 'Git hook start');
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: false });
  let gitState, gitStop;
  const gitHistory = createExecutionHistoryController({
    readTasks: workspaceId => invoke('list_project_action_runs', { workspaceId }),
    readWrites: workspaceId => invoke('list_workspace_write_runs', { workspaceId }),
    cancelTask: () => { throw Error('unexpected task stop'); },
    cancelWrite: async (workspaceId, runId) => { gitStop = await invoke('cancel_workspace_write', { workspaceId, runId }); return gitStop; },
    publish: state => { gitState = state; },
  });
  gitHistory.open(workspace.id, 'main'); await gitHistory.refresh();
  const gitPanel = mount(Panel, { target: document.getElementById('probe'), props: {
    workspaces: [{id:workspace.id,label:'Native Git'}], workspaceId:workspace.id, windowId:'main', state:gitState, desktop:true,
    onSelectWorkspace:()=>{}, onRefresh:()=>gitHistory.refresh(), onStop:key=>gitHistory.stop(key), onClose:()=>{},
  } });
  await tick();
  const gitButton = document.querySelector('button[aria-label="停止 提交"]');
  if (!gitButton || gitButton.disabled) throw Error('Git stop must remain available after trust revocation');
  gitButton.click();
  const gitOutcome = await gitExecution;
  if (!gitStop || gitOutcome.error?.code !== 'outcome_unknown' || !gitOutcome.error.message.includes('GIT_BEFORE_CANCEL')) throw Error('Git cancellation lost uncertain effects or output');
  await gitHistory.refresh();
  const gitRecord = gitState.entries.find(entry => entry.kind === 'git' && entry.title === '提交');
  if (gitRecord?.status !== 'outcome_unknown' || !gitRecord.stopRequested) throw Error('Git history lost cancellation settlement');
  await unmount(gitPanel); gitHistory.close();
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });

  const deniedAction = await invoke('save_project_action', { workspaceId: workspace.id, name: 'Deny task', kind: 'test', program: '/bin/sh', args: ['-c', 'touch denied-effect'], enabled: true });
  await fetch('/__task_approval', { method: 'POST', body: JSON.stringify({ marker: 'Deny task', decision: '取消' }) });
  const denied = await invoke('run_project_action', { workspaceId: workspace.id, actionId: deniedAction.id, sessionId: null, requestId: 'native-denied' });
  if (denied.status !== 'rejected' || !denied.output.includes('denied')) throw Error('Native denial must reject without execution');
  const results = [];
  for (const kit of ['shadcn', 'material3']) {
    setUiKit(kit); document.body.dataset.uiKit = kit;
    const action = await invoke('save_project_action', { workspaceId: workspace.id, name: `Cancel ${kit}`, kind: 'test', program: '/bin/sh', args: ['-c', `printf BEFORE_CANCEL; touch ${kit}-before; (sleep 2; touch ${kit}-after) & wait`], enabled: true });
    await fetch('/__task_approval', { method: 'POST', body: JSON.stringify({ marker: `Cancel ${kit}`, decision: '允许本次执行' }) });
    const execution = invoke('run_project_action', { workspaceId: workspace.id, actionId: action.id, sessionId: null, requestId: `native-${kit}` }).then(value => ({ value }), error => ({ error }));
    await until(async () => (await (await fetch('/__task_started')).json()).includes(`${kit}-before`), 'process start');
    const runs = await invoke('list_project_action_runs', { workspaceId: workspace.id });
    const running = runs.find(run => run.actionId === action.id && run.status === 'running');
    if (!running) throw Error('running task must be observable');
    await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: false });
    let cancelled, cancelError;
    let historyState;
    const historyController = createExecutionHistoryController({
      readTasks: workspaceId => invoke('list_project_action_runs', { workspaceId, limit: 20 }),
      readWrites: workspaceId => invoke('list_workspace_write_runs', { workspaceId, limit: 20 }),
      cancelTask: async (workspaceId, runId) => { try { cancelled = await invoke('cancel_project_action', { workspaceId, runId }); return cancelled; } catch (error) { cancelError = error; throw error; } },
      cancelWrite: (workspaceId, runId) => invoke('cancel_workspace_write', { workspaceId, runId }),
      publish: state => { historyState = state; },
    });
    historyController.open(workspace.id, 'main'); await historyController.refresh();
    const panel = mount(Panel, { target: document.getElementById('probe'), props: {
      workspaces: [{ id: workspace.id, label: 'Native fixture' }], workspaceId: workspace.id, windowId: 'main', desktop: true, state: historyState,
      onSelectWorkspace: () => {}, onRefresh: () => historyController.refresh(), onStop: key => historyController.stop(key), onClose: () => {},
    } });
    await tick();
    const button = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === `停止 Cancel ${kit}`);
    if (!button || button.disabled) throw Error('accessible stop button must remain usable after trust revocation');
    button.click();
    const outcome = await execution;
    if (outcome.error) throw Error(JSON.stringify(outcome.error));
    if (cancelError || !cancelled) throw Error('native cancel request failed');
    if (outcome.value.status !== 'outcome_unknown' || !outcome.value.output.includes('BEFORE_CANCEL')) throw Error('partial output and uncertain effects must be retained');
    const history = await invoke('list_project_action_runs', { workspaceId: workspace.id });
    if (!history.some(run => run.id === running.id && run.status === 'outcome_unknown')) throw Error('settlement missing from history');
    results.push({ kit, runId: running.id, status: outcome.value.status, stopButton: true, history: true, surface: 'host-history' });
    await unmount(panel); historyController.close();
    await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
  }
  await pause(2200);
  await report({ ok: true, results, denialPreventedExecution: true, gitDenialPreventedExecution: true, gitCancellation: true, workspaceWriteHistory: true, duplicateWriteReused: true, writeRunId: writeRun.id });
} catch (error) { await report({ ok: false, error: String(error) }); }
