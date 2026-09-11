import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'svelte/compiler';

test('workbench callbacks and writable bindings cross the generation gate', async () => {
  const source = await readFile('src/App.svelte', 'utf8');
  const tree = parse(source, { modern: true });
  let guarded = 0;
  let hostCallbacks = 0;
  const hostComponents = new Set(['WindowTitlebar', 'SettingsPanel', 'DiagnosticsPanel', 'PluginWorkspacePanel', 'ExecutionHistoryPanel', 'SessionHistoryPanel']);
  const foundHost = new Set();
  let hostApprovalRegion = false;
  function visit(node, inside = false) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'RegularElement' && node.attributes?.some(attribute => attribute.name === 'aria-label' && attribute.value?.[0]?.data === '宿主审批')) {
      assert.equal(inside, false, 'approvals must remain outside replaceable presentation');
      hostApprovalRegion = true;
    }
    if (node.type === 'Component' && hostComponents.has(node.name)) {
      assert.equal(inside, false, `${node.name} must survive renderer disposal`);
      foundHost.add(node.name);
      for (const attribute of node.attributes) {
        if (!/^on[A-Z]/.test(attribute.name) || !attribute.value?.expression) continue;
        const expression = attribute.value.expression;
        if (node.name === 'PluginWorkspacePanel') {
          assert.equal(expression.type, 'CallExpression');
          assert.equal(expression.callee.name, 'hostGuard', 'host plugin actions retain context checks');
        } else {
          assert.notEqual(expression.callee?.name, 'guard', 'host controls cannot depend on renderer generation');
        }
        hostCallbacks++;
      }
    }
    if (node.type === 'SnippetBlock' && node.expression?.name === 'children') inside = true;
    if (inside && node.type === 'Attribute' && /^on[A-Z]/.test(node.name) && node.value?.expression) {
      assert.equal(node.value.expression.type, 'CallExpression', node.name);
      assert.equal(node.value.expression.callee.name, 'guard', node.name);
      guarded++;
    }
    if (inside && node.type === 'BindDirective' && node.name !== 'this') {
      assert.equal(node.expression.type, 'SequenceExpression');
      assert.equal(node.expression.expressions[1].callee.name, 'guard');
      guarded++;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, inside));
      else if (value && typeof value === 'object') visit(value, inside);
    }
  }
  visit(tree.fragment);
  assert.equal(hostApprovalRegion, true);
  assert.deepEqual(foundHost, hostComponents);
  const timeline = await readFile('src/lib/components/app/TimelinePanel.svelte', 'utf8');
  assert.doesNotMatch(timeline, /onResolveApproval|availableDecisions/, 'presentation cannot own approval controls');
  assert.ok(guarded + hostCallbacks >= 100, 'all workbench and independent host callbacks must be covered');
  assert.match(source, /listenToAgentEvents/);
  const shell = await readFile('src/lib/workbench/WorkbenchPresentation.svelte', 'utf8');
  assert.doesNotMatch(shell, /listenToAgentEvents|sendAgentPrompt|resumeAgentSession|cancelAgentTurn|pluginInstallationId/);
});

test('generic host routing checks plugin binding and keeps native compatibility outside the entrypoint', async () => {
  const source = await readFile('src-tauri/src/lib.rs', 'utf8');
  for (const method of ['send_agent_prompt', 'cancel_agent_turn', 'resume_agent_session', 'close_agent_session']) {
    const code = source.slice(source.indexOf(`async fn ${method}(`)).split('#[tauri::command]')[0];
    assert.match(code, /plugin_installation_id/);
    assert.match(code, /compatibility::/);
    assert.doesNotMatch(code, /session_agent\(|\.agent\s*==|"codex"|"pi"/);
  }
  const create = source.slice(source.indexOf('async fn create_agent_session(')).split('#[tauri::command]')[0];
  assert.match(create, /requested_profile/);
  assert.match(create, /create_with_profile/);
  assert.doesNotMatch(create, /create_codex_session|create_pi_session/);
  const app = await readFile('src/App.svelte', 'utf8');
  assert.doesNotMatch(app, /\b(?:sendCodexPrompt|sendPiPrompt|abortCodexTurn|abortPiTurn|setPiModel|setPiThinkingLevel|sessionModelBackend)\b/);
});

test('independent persisted session history never activates an Agent runtime', async () => {
  const [host, service] = await Promise.all([
    readFile('src-tauri/src/lib.rs', 'utf8'), readFile('src-tauri/src/session_history.rs', 'utf8'),
  ]);
  const command = host.slice(host.indexOf('async fn read_session_history(')).split('#[tauri::command]')[0];
  assert.match(command, /session_history::read\(&state\.db/);
  assert.doesNotMatch(command, /state\.(?!db\b)\w+/, 'the recovery command may only access the database port');
  assert.doesNotMatch(service, /use tauri|PluginHost|PiManager|CodexManager|invoke_capability|resume_session/, 'persisted reads must not depend on a live runtime');
});
