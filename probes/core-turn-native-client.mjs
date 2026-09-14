import { invoke } from '@tauri-apps/api/core';
import { restoreTurnChangeSet } from '/src/lib/api.ts';
async function post(url, data) {
  const response = await fetch(url, { method: 'POST', body: JSON.stringify(data) });
  if (!response.ok) throw Error(await response.text());
}
try {
  const { workspacePath, mode } = await (await fetch('/__task_config')).json();
  const workspace = await invoke('add_workspace', { path: workspacePath });
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
  await post('/__hunk_seed', { workspaceId: workspace.id });
  const restore = id => restoreTurnChangeSet('hunk-session', 'hunk-turn', id);
  await post('/__task_approval', { marker: 'core.turn-restore', decision: '取消', kind: 'restore' });
  let denial = false;
  try { await restore('denied'); } catch (error) { denial = error.code === 'approval_rejected'; }
  if (!denial) throw Error('Native denial did not reject restore');
  await post('/__turn_check?denied');
  await post('/__task_approval', { marker: 'core.turn-restore', decision: '允许本次执行', kind: 'restore' });
  const first = restore('restore'); if (restore('restore') !== first) throw Error('Repeated restore click not coalesced');
  const result = await first;
  if (!result.applied || result.restored.length !== 4 || !result.restored.includes('old.txt → new.txt')) throw Error(`Incomplete restore: ${JSON.stringify(result)}`);
  await post('/__turn_check?restored');
  const replay = JSON.stringify(await restore('restore')) === JSON.stringify(result);
  let missingId = false;
  try { await invoke('restore_turn_change_set', { sessionId: 'hunk-session', turnId: 'hunk-turn' }); } catch { missingId = true; }
  if (!replay || !missingId) throw Error('Restore request identity failed');
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: false });
  const writes = await invoke('list_workspace_write_runs', { workspaceId: workspace.id });
  const completed = writes.find(row => row.requestId === 'restore');
  if (writes.length !== 2 || completed?.operation !== 'core.turn-restore' || completed.status !== 'completed' || completed.approvalOutcome !== 'approved' || completed.callerWindow !== 'main') throw Error('Restore history missing');
  const legacy = await invoke('list_restore_operations', { sessionId: 'hunk-session', turnId: 'hunk-turn' });
  const messages = await invoke('read_session_history', { workspaceId: workspace.id, sessionId: 'hunk-session' });
  if (legacy.length !== 1 || legacy[0].schema !== 'aibo.restore-operation/v1' || legacy[0].status !== 'completed' || legacy[0].restored.length !== 4 || !messages.items.some(item => item.content.includes('已恢复本轮 Agent 变更'))) throw Error('Legacy restore audit or saved system message missing');
  await post('/__task_report', { ok: true, mode, denial, replay, missingId, history: true, legacyAudit: true, renameRestored: true, readableAfterTrustRevocation: true });
} catch (error) { await post('/__task_report', { ok: false, error: error.stack ?? JSON.stringify(error) }); }
