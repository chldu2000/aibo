import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sessionProviders } from '../src/lib/app/session-providers.ts';

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

test('external sessions use the unified production session controller after the C transition', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.match(app, /const listSessions: typeof listAllSessions = listAllSessions/);
  const controller = await readFile(new URL('../src/lib/app/message-controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /sendAgentPrompt/);
  assert.match(controller, /cancelAgentTurn/);
  assert.doesNotMatch(controller, /session\.agent === 'pi'/);
});

test('App plugin controls forward every lifecycle callback and surface recoverable failures', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/lib/components/app/PluginWorkspacePanel.svelte', import.meta.url), 'utf8');
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
  assert.match(app, /onOpenPlugins=\{openPluginPanel\}/);
  assert.match(app, /catch \(error\) \{ pluginError = toErrorMessage\(error\); \}/);
  assert.match(app, /finally \{ pluginBusy = false; \}/);
  assert.match(app, /onCancel=\{hostGuard\('onCancel', \(\) => pluginSessionOperation\(cancelAgentTurn\)\)\}/);
  assert.match(app, /onResume=\{hostGuard\('onResume', \(\) => pluginSessionOperation\(resumeAgentSession\)\)\}/);
  assert.match(app, /onCloseSession=\{hostGuard\('onCloseSession', \(\) => pluginSessionOperation\(closeAgentSession\)\)\}/);

  assert.match(panel, /role="alert"/, 'plugin errors must be announced');
  assert.match(panel, /aria-label="插件消息"/, 'plugin timeline must remain readable');
  assert.match(panel, /const resumable = \$derived\(selectedSession\?\.state === 'interrupted' \|\| selectedSession\?\.state === 'failed'\)/);
  assert.match(panel, /disabled=\{busy \|\| !resumable\}/, 'closed or idle sessions must not offer resume');
  assert.match(manager, /!installation\.installed \|\| !installation\.enabled/, 'uninstalled plugins cannot create sessions');
  assert.match(manager, /installation\.sessionProviders as provider/);
  assert.match(manager, /!installation\.runnable/, 'plugins with missing required dependencies cannot create sessions');
  assert.match(manager, /dependency\.required && !dependency\.available \? 'alert'/, 'missing required dependencies must be explicit');
  assert.match(manager, /onclick=\{\(\) => onUninstall\(installation\.id\)\}/, 'installed plugins can be uninstalled');
  assert.match(manager, /aria-busy=\{busy\}/);
});
