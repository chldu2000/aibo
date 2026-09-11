import { invoke } from '@tauri-apps/api/core';
const check = (value, message) => { if (!value) throw Error(message); };
const report = value => fetch('/__chain_report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
try {
  const config = await (await fetch('/__chain_config')).json();
  let saved = config.saved;
  if (config.stage === 0) {
    const workspace = await invoke('add_workspace', { path: config.workspacePath });
    await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
    const child = await invoke('install_agent_plugin', { path: config.childPath });
    await invoke('set_agent_plugin_enabled', { id: child.id, enabled: true });
    const parent = await invoke('install_agent_plugin', { path: config.parentPath });
    await invoke('set_agent_plugin_enabled', { id: parent.id, enabled: true });
    saved = { workspaceId: workspace.id, parentId: parent.id, childId: child.id };
    await invoke('bind_capability_provider', { binding: { scope: { kind: 'workspace', id: workspace.id }, capability: 'dev.aibo.chain-parent.echo', version: '1.0.0', installationId: parent.id, contributionId: 'dev.aibo.chain-parent.read' } });
  }
  const call = input => invoke('invoke_capability', { request: { scope: { kind: 'workspace', id: saved.workspaceId }, capability: 'dev.aibo.chain-parent.echo', version: '1.0.0', requestId: `chain-${config.stage}`, input } });
  const response = await call({ value: 'NATIVE_CHAIN_OK' });
  const output = JSON.parse(response.output.value);
  check(output.value === 'NATIVE_CHAIN_OK', 'real child process output');
  check(output.caller.kind === 'window' && output.caller.id === 'main', 'original native caller');
  check(output.chain.length === 2 && output.chain[0].installationId === saved.parentId && output.chain[1].installationId === saved.childId, 'pinned parent and child releases');
  check(output.permissions.length === 1 && output.permissions[0] === 'workspace.read', 'read permissions inherited');
  check(response.output.workspacePath === config.workspacePath || response.output.workspacePath === `/private${config.workspacePath}`, 'host-owned workspace path');
  check((await call({ value: 'forged', mode: 'stale' }).catch(error => error)).code === 'permission_denied', 'stale generation refused');
  if (config.stage === 1) {
    await invoke('set_agent_plugin_enabled', { id: saved.childId, enabled: false });
    check((await call({ value: 'disabled' }).catch(error => error)).code === 'provider_unavailable', 'disabled dependency blocks new calls');
  }
  check((await invoke('list_sessions', { workspaceId: saved.workspaceId })).length === 0, 'no Agent sessions');
  await report({ ok: true, stage: config.stage, saved, evidence: { realPluginToPluginCall: true, originalCaller: true, pinnedDependency: true, inheritedScopeAndPermissions: true, staleGenerationRejected: true, noAgentSession: true, ...(config.stage === 1 ? { actualAppRestart: true, dependencyDisableEnforced: true } : {}) } });
} catch (error) { await report({ ok: false, error: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }); }
