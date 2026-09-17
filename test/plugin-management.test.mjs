import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sessionProviders, readySessionProviders, sessionProviderIcon } from '../src/lib/app/session-providers.ts';

test('desktop bundle and host validators exclude the retired executable protocols', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(config.bundle.resources).some(path => path.includes('pi-sdk-host')), false);
  const contracts = await readFile(new URL('../src-tauri/src/plugin_contract.rs', import.meta.url), 'utf8');
  assert.doesNotMatch(contracts, /include_str!\([^\n]*(?:agent-runtime-protocol|plugin-view-protocol|plugin-session-binding)/);
});

test('retired Agent views have no IPC or rendering seam', async () => {
  for (const file of ['src/lib/api.ts','src-tauri/src/lib.rs','src/lib/ui-kit/contract.ts','src/lib/ui-kit/kits/shadcn.ts','src/lib/ui-kit/kits/material3.ts']) {
    const source = await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source, /get_plugin_views|invoke_plugin_view_action|get_plugin_view_snapshots|PluginView/);
  }
});

test('session creation discovers capability contributions and ignores legacy agents', () => {
  const metadata = {displayName:'External session',operations:[{capability:{id:'aibo.session.open'}}]};
  assert.deepEqual(sessionProviders({contributions:[
    {id:'external.session',kind:'capabilityProvider',scope:'session',metadata},
    {id:'external.workspace',kind:'capabilityProvider',scope:'workspace',metadata},
    {id:'external.old',kind:'agent',scope:'session',metadata},
  ]}),[{id:'external.session',displayName:'External session'}]);
  assert.deepEqual(sessionProviders({}),[]);
});

test('wheel discovers ready releases and follows install, enable, dependency readiness and removal', () => {
  const icon = { path: 'M2 2L22 22Z' };
  const contribution = { id: 'external.agent', kind: 'capabilityProvider', scope: 'session', metadata: {
    displayName: 'External Agent', icon, operations: [{capability: {id: 'aibo.session.open'}}],
  } };
  const installation = { id: 'release-1', installed: true, enabled: true, runnable: true, contributions: [contribution] };
  const choices = readySessionProviders([installation]);
  assert.equal(choices.length, 1);
  assert.deepEqual(choices[0].icon, icon);
  assert.equal(choices[0].installationId, 'release-1');
  assert.equal(choices[0].contributionId, contribution.id);
  for (const patch of [{installed: false}, {enabled: false}, {runnable: false}, {activationIssues: ['incompatible']}, {packageDependencies: {unavailableContributions: [contribution.id]}}]) {
    assert.deepEqual(readySessionProviders([{...installation, ...patch}]), []);
  }
  assert.deepEqual(readySessionProviders([]), []);
  const multiple = readySessionProviders(Array.from({length: 8}, (_, i) => ({...installation, id: `release-${i}`})));
  assert.equal(new Set(multiple.map(choice => choice.id)).size, 8);
  assert.deepEqual(sessionProviderIcon([{...installation, enabled: false}], {agent: contribution.id, pluginInstallationId: installation.id}), icon);
  assert.equal(sessionProviderIcon([installation], {agent: contribution.id, pluginInstallationId: 'other-release'}), undefined);
  const missingIcon = {...installation, contributions: [{...contribution, metadata: {...contribution.metadata, icon: undefined}}]};
  assert.equal(readySessionProviders([missingIcon])[0].icon, undefined);
});

test('external sessions use the unified production session controller after the C transition', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.match(app, /const listSessions: typeof listAllSessions = listAllSessions/);
  const controller = await readFile(new URL('../src/lib/app/message-controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /sendAgentPrompt/);
  assert.match(controller, /cancelAgentTurn/);
  assert.doesNotMatch(controller, /session\.agent === 'pi'/);
});

test('management center owns plugin administration while plugin sessions stay in the main workbench', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  const titlebar = await readFile(new URL('../src/lib/components/app/WindowTitlebar.svelte', import.meta.url), 'utf8');
  const settings = await readFile(new URL('../src/lib/components/app/SettingsPanel.svelte', import.meta.url), 'utf8');
  const management = await readFile(new URL('../src/lib/ui-kit/kits/shadcn/ManagementCenter.svelte', import.meta.url), 'utf8');
  const manager = await readFile(new URL('../src/lib/components/app/PluginManagerPanel.svelte', import.meta.url), 'utf8');

  for (const callback of [
    'installAgentPlugin',
    'setAgentPluginEnabled',
    'uninstallAgentPlugin',
    'createAgentSession',
    'sendAgentPrompt',
    'cancelAgentTurn',
    'resumeAgentSession',
    'closeAgentSession',
  ]) {
    assert.match(app, new RegExp(`\\b${callback}\\b`), `${callback} must be wired through App`);
  }
  assert.doesNotMatch(app, /pluginViews|invokePluginViewAction|getPluginViews/);
  assert.match(app, /onOpenManagement=\{\(\) => openManagementCenter\('appearance'\)\}/);
  assert.doesNotMatch(app, /<PluginWorkspacePanel/);
  assert.match(app, /<PluginManagerPanel/);
  assert.match(titlebar, /打开管理中心/);
  assert.doesNotMatch(titlebar, /打开 Agent 诊断|data-host-navigation="plugins"/);
  assert.match(settings, /<ManagementCenter/);
  assert.match(management, /label: '外观'.*label: '扩展'.*label: '运行状态'/s);
  assert.match(app, /catch \(error\) \{ pluginError = toErrorMessage\(error\); \}/);
  assert.match(app, /finally \{ pluginBusy = false; \}/);
  assert.match(app, /settingsOpen = false;/, 'creating an extension session returns to the main workbench');
  assert.match(app, /await createPluginSession\(choice\.installationId, choice\.contributionId, workspaceId\);\s*errorMessage = pluginError;/, 'a successful extension session clears any stale creation error');
  assert.match(manager, /!installation\.installed \|\| !installation\.enabled/, 'uninstalled plugins cannot create sessions');
  assert.match(manager, /installation\.sessionProviders as provider/);
  assert.match(manager, /!installation\.runnable/, 'plugins with missing required dependencies cannot create sessions');
  assert.match(manager, /dependency\.required && !dependency\.available \? 'alert'/, 'missing required dependencies must be explicit');
  assert.match(manager, /onclick=\{\(\) => onUninstall\(installation\.id\)\}/, 'installed plugins can be uninstalled');
  assert.match(manager, /aria-busy=\{busy\}/);
});
