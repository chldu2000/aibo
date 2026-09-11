import { invoke } from '@tauri-apps/api/core';
import { applyGitHunkAction } from '/src/lib/api.ts';
async function post(url, data) {
  const response = await fetch(url, { method: 'POST', body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text());
}
try {
  const { workspacePath } = await (await fetch('/__task_config')).json();
  const workspace = await invoke('add_workspace', { path: workspacePath });
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
  await post('/__hunk_seed', { workspaceId: workspace.id });
  const apply = (action, requestId) => applyGitHunkAction('hunk-session', 'hunk-turn', 'file.txt', 0, action, requestId);
  await post('/__task_approval', { marker: 'git.hunk', decision: '取消', kind: 'git' });
  let denial = false;
  try { await apply('stage', 'denied'); } catch (error) { denial = error.code === 'approval_rejected'; }
  if (!denial) throw Error('Native denial did not reject the hunk');
  await post('/__hunk_check', { phase: 'denied' });
  let reverted;
  for (const action of ['stage', 'unstage', 'revert']) {
    await post('/__task_approval', { marker: 'git.hunk', decision: '允许本次执行', kind: 'git' });
    const first = apply(action, action);
    if (apply(action, action) !== first) throw Error('Repeated hunk click was not coalesced');
    const result = await first;
    if (!result.applied) throw Error(`${action}: ${result.message}`);
    await post('/__hunk_check', { phase: action });
    if (action === 'revert') reverted = result;
  }
  const replay = JSON.stringify(await apply('revert', 'revert')) === JSON.stringify(reverted);
  let missingId = false, changedInput = false;
  try { await invoke('apply_git_hunk_action', { sessionId: 'hunk-session', turnId: 'hunk-turn', path: 'file.txt', hunkIndex: 0, action: 'stage' }); } catch { missingId = true; }
  try { await apply('stage', 'revert'); } catch { changedInput = true; }
  if (!replay || !missingId || !changedInput) throw Error('Native hunk request identity failed');
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: false });
  const rows = await invoke('list_workspace_write_runs', { workspaceId: workspace.id });
  if (rows.length !== 4 || rows.some(row => row.operation !== 'git.hunk' || row.callerWindow !== 'main' || row.snapshot.input.turnId !== 'hunk-turn')) throw Error('Incomplete hunk history');
  if (rows.filter(row => row.status === 'completed' && row.approvalOutcome === 'approved' && row.result?.output.applied).length !== 3) throw Error('Hunk settlement was not persisted');
  await post('/__task_report', { ok: true, denial, replay, missingId, changedInput, history: true, readableAfterTrustRevocation: true });
} catch (error) { await post('/__task_report', { ok: false, error: error.stack ?? JSON.stringify(error) }); }
