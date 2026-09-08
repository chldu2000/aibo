import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { pluginViewProps } from '../src/lib/ui-kit/plugin-view.ts';

test('plugin view bindings resolve escaped pointers without inherited/prototype access', () => {
  const node = { id: 'message', type: 'text', props: { text: 'fallback' }, children: [] };
  const document = { data: { 'a/b': { '~value': 'bound' } }, bindings: [{ nodeId: 'message', property: 'text', dataPath: '/a~1b/~0value' }] };
  assert.equal(pluginViewProps(document, node).text, 'bound');
  for (const dataPath of ['/constructor/name', '/__proto__/polluted', '/missing']) {
    document.bindings[0].dataPath = dataPath;
    assert.equal(pluginViewProps(document, node).text, 'fallback');
  }
  document.bindings = [{ nodeId: 'message', property: 'style', dataPath: '/a~1b/~0value' }];
  assert.equal(pluginViewProps(document, node).style, undefined);
  assert.equal(node.props.text, 'fallback');
});

test('plugin renderer remains a complete skin seam with no executable content sink', async () => {
  const source = await readFile(new URL('../src/lib/ui-kit/kits/shared/PluginView.svelte', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\{@html|\beval\s*\(|new Function|<svelte:element|\{\.\.\.p\}/);
  for (const skin of ['shadcn', 'material3']) {
    const adapter = await readFile(new URL(`../src/lib/ui-kit/kits/${skin}.ts`, import.meta.url), 'utf8');
    assert.match(adapter, /PluginView/);
  }
  const proxy = await readFile(new URL('../src/lib/ui-kit/runtime/PluginView.svelte', import.meta.url), 'utf8');
  assert.match(proxy, /\$activeUiKit\.PluginView/);
  const contract = await readFile(new URL('../src/lib/ui-kit/contract.ts', import.meta.url), 'utf8');
  assert.match(contract, /PluginView: Component<UiPluginViewProps>/);
});

test('external sessions stay outside legacy provider controllers during the B transition', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.match(app, /const listSessions: typeof listAllSessions[\s\S]*?filter\(\(session\) => session\.agent === 'codex' \|\| session\.agent === 'pi'\)/);
  assert.match(app, /pluginViewSessionId === pluginSessionId \? pluginViews : \[\]/, 'stale views must not display under a different session');
  assert.match(app, /if \(disposed\) return;/, 'disposed polling scopes must ignore late responses');
  assert.match(app, /Promise\.allSettled/, 'unavailable views must not prevent loading stored timeline history');
});

test('App plugin controls forward every lifecycle callback and surface recoverable failures', async () => {
  const app = await readFile(new URL('../src/App.svelte', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/lib/components/app/PluginWorkspacePanel.svelte', import.meta.url), 'utf8');
  const manager = await readFile(new URL('../src/lib/components/app/PluginManagerPanel.svelte', import.meta.url), 'utf8');

  for (const callback of [
    'installAgentPlugin',
    'setAgentPluginEnabled',
    'createAgentSession',
    'sendAgentPrompt',
    'cancelAgentTurn',
    'resumeAgentSession',
    'closeAgentSession',
    'getPluginViews',
  ]) {
    assert.match(app, new RegExp(`\\b${callback}\\b`), `${callback} must be wired through App`);
  }
  assert.match(app, /onOpenPlugins=\{openPluginPanel\}/);
  assert.match(app, /catch \(error\) \{ pluginError = toErrorMessage\(error\); \}/);
  assert.match(app, /finally \{ pluginBusy = false; \}/);
  assert.match(app, /onCancel=\{\(\) => pluginSessionOperation\(cancelAgentTurn\)\}/);
  assert.match(app, /onResume=\{\(\) => pluginSessionOperation\(resumeAgentSession\)\}/);
  assert.match(app, /onCloseSession=\{\(\) => pluginSessionOperation\(closeAgentSession\)\}/);

  assert.match(panel, /role="alert"/, 'plugin errors must be announced');
  assert.match(panel, /aria-label="插件消息"/, 'plugin timeline must remain readable');
  assert.match(panel, /const resumable = \$derived\(selectedSession\?\.state === 'interrupted' \|\| selectedSession\?\.state === 'failed'\)/);
  assert.match(panel, /disabled=\{busy \|\| !resumable\}/, 'closed or idle sessions must not offer resume');
  assert.match(panel, /views as view \(view\.viewId\)/);
  assert.match(manager, /disabled=\{busy \|\| !installation\.enabled\}/, 'disabled plugins cannot create sessions');
  assert.match(manager, /aria-busy=\{busy\}/);
});
