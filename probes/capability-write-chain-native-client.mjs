import * as api from '../src/lib/api';
const check = (value, message) => { if (!value) throw Error(message); };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const call = (workspaceId, id, mode = 'normal') => api.invokeCapability({ scope: { kind: 'workspace', id: workspaceId }, capability: 'dev.aibo.write-parent.run', version: '1.0.0', requestId: id, input: { value: id, mode } });
async function decisions(child) {
  await post('/__write_approval', { marker: 'dev.aibo.write-parent.run', decision: '允许本次执行' });
  await post('/__write_approval', { marker: 'dev.aibo.write-leaf.run', decision: child });
}
async function install(directory) { const plugin = await api.installAgentPlugin(directory); await api.setAgentPluginEnabled(plugin.id, true); return plugin; }
try {
  const config = await (await fetch('/__write_config')).json(); let saved = config.saved;
  if (config.stage === 0) {
    const workspace = await api.addWorkspace(config.workspacePath); await api.setWorkspaceTrust(workspace.id, true);
    const leaf = await install(config.leafPath); const parent = await install(config.packagePath); const alternate = await install(config.alternatePath);
    const scope = { kind: 'workspace', id: workspace.id };
    await api.bindCapabilityProvider(scope, 'dev.aibo.write-parent.run', '1.0.0', { installationId: parent.id, contributionId: 'dev.aibo.write-parent.worker' });
    await api.bindCapabilityProvider(scope, 'dev.aibo.write-leaf.run', '1.0.0', { installationId: alternate.id, contributionId: 'dev.aibo.write-leaf.worker' });
    saved = { workspaceId: workspace.id, parentId: parent.id, leafId: leaf.id, alternateId: alternate.id };
    await decisions('取消');
    const denied = await call(workspace.id, 'native-child-denied'); check(denied.output.trace.includes('error:approval_rejected'), 'parent handles child rejection');
    const denial = await (await fetch('/__write_effect')).json(); check(!denial.leafStarted && denial.content === '', 'denied child never started');
    await decisions('允许本次执行');
    const once = await call(workspace.id, 'native-chain'); saved.invocationId = once.invocationId;
    check(once.output.caller === 'main' && once.output.permissions.includes('workspace.write'), 'original caller and permissions');
    const chain = JSON.parse(once.output.chain); check(chain.length === 2 && chain[1].installationId === leaf.id, 'pinned child release');
    check((await call(workspace.id, 'native-chain')).invocationId === once.invocationId, 'whole-chain durable replay');
    await decisions('允许本次执行');
    const pending = call(workspace.id, 'native-cancel', 'slow').catch(error => error);
    const until = Date.now() + 10000;
    while (!(await (await fetch('/__write_effect')).json()).content.includes('native-cancel')) {
      if (Date.now() > until) throw Error('child write did not start'); await new Promise(resolve => setTimeout(resolve, 30));
    }
    const active = (await api.listWorkspaceWriteRuns(workspace.id)).find(row => row.parentWriteRunId && row.status === 'running');
    check(active && await api.cancelWorkspaceWrite(workspace.id, active.id), 'independent history cancels the child run');
    check((await pending).code === 'outcome_unknown', 'child unknown forces root unknown');
    const rows = await api.listWorkspaceWriteRuns(workspace.id);
    check(rows.length === 6 && rows.filter(row => row.status === 'rejected').length === 1 && rows.filter(row => row.status === 'completed').length === 3 && rows.filter(row => row.status === 'outcome_unknown').length === 2, 'root and child settlements');
    check(rows.every(row => row.rootWriteRunId && (row.parentWriteRunId ? rows.some(root => root.id === row.rootWriteRunId && !root.parentWriteRunId) : row.rootWriteRunId === row.id)), 'durable lineage');
    await api.setWorkspaceTrust(workspace.id, false);
    for (const id of [parent.id, leaf.id, alternate.id]) {await api.setAgentPluginEnabled(id, false); await api.uninstallAgentPlugin(id);}
    await post('/__write_report', { ok: true, saved, separateNativeApprovals: true, childDenialPreventedExecution: true, pinnedDependency: true, durableLineage: true, childCancellationPropagatedUnknown: true, independentHistory: true });
  } else {
    check((await call(saved.workspaceId, 'native-chain')).invocationId === saved.invocationId, 'restart replay after uninstall');
    check((await call(saved.workspaceId, 'native-child-denied')).output.trace.includes('error:approval_rejected'), 'child rejection survives restart');
    check((await call(saved.workspaceId, 'native-cancel', 'slow').catch(error => error)).code === 'outcome_unknown', 'unknown survives restart');
    check((await api.listWorkspaceWriteRuns(saved.workspaceId)).length === 6, 'no new root or child runs');
    await post('/__write_report', { ok: true, saved, actualRestart: true, chainReplayAfterUninstall: true, historyAfterTrustRevocation: true });
  }
} catch (error) { await post('/__write_report', { ok: false, error: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }); }
