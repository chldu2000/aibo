import { invoke } from '@tauri-apps/api/core';
import { applyGitFileAction } from '/src/lib/api.ts';
async function post(url, data) {
  const response = await fetch(url, { method: 'POST', body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text());
}
try {
  const { workspacePath } = await (await fetch('/__task_config')).json();
  const workspace = await invoke('add_workspace', { path: workspacePath });
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
  await post('/__hunk_seed', { workspaceId: workspace.id });
  const apply = (action, requestId) => applyGitFileAction('hunk-session', 'file.txt', action, 'hunk-turn', requestId);
  await post('/__task_approval', { marker: 'git.file-revert', decision: '取消', kind: 'git' });
  let denial = false;
  try { await apply('revert', 'denied'); } catch (error) { denial = error.code === 'approval_rejected'; }
  if (!denial) throw Error('Native denial did not reject the file restore');
  await post('/__hunk_check', { phase: 'denied' });
  await post('/__task_approval', { marker: 'git.index', decision: '允许本次执行', kind: 'git' });
  if (!(await apply('stage', 'stage')).applied) throw Error('Could not stage original changes');
  await post('/__hunk_check', { phase: 'stage' });
  await post('/__task_approval', { marker: 'git.file-revert', decision: '允许本次执行', kind: 'git' });
  const first = apply('revert', 'revert');
  if (first !== apply('revert', 'revert')) throw Error('Duplicate pending restore was not coalesced');
  const restored = await first;
  if (!restored.applied) throw Error(restored.message);
  await post('/__hunk_check', { phase: 'revert' });
  const replay = JSON.stringify(await apply('revert', 'revert')) === JSON.stringify(restored);
  let changedInput = false;
  try { await apply('stage', 'revert'); } catch { changedInput = true; }
  if (!replay || !changedInput) throw Error('File restore request identity failed');
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: false });
  const rows = await invoke('list_workspace_write_runs', { workspaceId: workspace.id });
  if (rows.length !== 3 || rows.some(row => row.callerWindow !== 'main' || row.snapshot.input.turnId !== 'hunk-turn')) throw Error('Incomplete file restore history');
  const restore = rows.find(row => row.requestId === 'revert');
  if (restore?.operation !== 'git.file-revert' || restore.status !== 'completed' || restore.approvalOutcome !== 'approved' || !restore.result?.output.applied) throw Error('File restore settlement was not persisted');
  await post('/__task_report', { ok: true, denial, replay, changedInput, history: true, stagedBaselineRestored: true, readableAfterTrustRevocation: true });
} catch (error) { await post('/__task_report', { ok: false, error: error.stack ?? JSON.stringify(error) }); }
