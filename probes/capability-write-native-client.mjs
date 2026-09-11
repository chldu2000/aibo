import * as api from '../src/lib/api';
const check = (value, message) => { if (!value) throw Error(message); };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const call = (workspaceId, id, mode = 'normal') => api.invokeCapability({ scope: { kind: 'workspace', id: workspaceId }, capability: 'dev.aibo.capability-write.append', version: '1.0.0', requestId: id, input: { value: id, mode } });
try {
  const config = await (await fetch('/__write_config')).json();
  let saved = config.saved;
  if (config.stage === 0) {
    const workspace = await api.addWorkspace(config.workspacePath); await api.setWorkspaceTrust(workspace.id, true);
    const plugin = await api.installAgentPlugin(config.packagePath); await api.setAgentPluginEnabled(plugin.id, true);
    const scope = { kind: 'workspace', id: workspace.id };
    const [provider] = await api.listCapabilityProviders(scope, 'dev.aibo.capability-write.append', '1.0.0');
    await api.bindCapabilityProvider(scope, provider ? 'dev.aibo.capability-write.append' : '', '1.0.0', provider);
    saved = { workspaceId: workspace.id, installationId: plugin.id };
    await post('/__write_approval', { marker: 'native-denied', decision: '取消' });
    check((await call(workspace.id, 'native-denied').catch(error => error)).code === 'approval_rejected', 'native rejection');
    const denial = await (await fetch('/__write_effect')).json(); check(!denial.started && denial.content === '', 'no process start before approval');
    await post('/__write_approval', { marker: 'native-once', decision: '允许本次执行' });
    const once = await call(workspace.id, 'native-once'); saved.invocationId = once.invocationId;
    check(once.output.caller === 'main' && once.output.permissions.includes('workspace.write'), 'host caller and permission');
    check((await call(workspace.id, 'native-once')).invocationId === once.invocationId, 'durable replay');
    await post('/__write_approval', { marker: 'native-cancel', decision: '允许本次执行' });
    const pending = call(workspace.id, 'native-cancel', 'slow').catch(error => error);
    const until = Date.now() + 10000;
    while (!(await (await fetch('/__write_effect')).json()).content.includes('native-cancel')) {
      if (Date.now() > until) throw Error('write did not start');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    await api.setWorkspaceTrust(workspace.id, false);
    // Scope lifecycle invalidation and explicit cancellation both remain host-owned.
    await api.cancelCapability('native-cancel');
    check((await pending).code === 'outcome_unknown', 'partial write is unknown');
    const rows = await api.listWorkspaceWriteRuns(workspace.id);
    check(rows.length === 3 && rows.some(row => row.status === 'rejected') && rows.some(row => row.status === 'completed') && rows.some(row => row.status === 'outcome_unknown'), 'independent write history');
    await api.setAgentPluginEnabled(plugin.id, false); await api.uninstallAgentPlugin(plugin.id);
    await post('/__write_report', { ok: true, saved, nativeDenial: true, approvedWrite: true, durableReplay: true, cancellationAfterTrustRevocation: true, independentHistory: true });
  } else {
    check((await call(saved.workspaceId, 'native-once')).invocationId === saved.invocationId, 'restart replay after uninstall');
    check((await call(saved.workspaceId, 'native-denied').catch(error => error)).code === 'approval_rejected', 'rejection survives restart');
    check((await call(saved.workspaceId, 'native-cancel', 'slow').catch(error => error)).code === 'outcome_unknown', 'unknown survives restart');
    const rows = await api.listWorkspaceWriteRuns(saved.workspaceId); check(rows.length === 3, 'no new executions after restart');
    await post('/__write_report', { ok: true, saved, actualRestart: true, replayAfterUninstall: true, historyAfterTrustRevocation: true });
  }
} catch (error) { await post('/__write_report', { ok: false, error: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }); }
