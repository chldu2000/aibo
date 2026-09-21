import '/src/app.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { mount } from 'svelte';
import App from '/src/App.svelte';
import { conversation } from './fixture.mjs';
import { createConversationDirectory } from '../../src/lib/presentation-runtime/conversation.ts';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const inbox = [], checks = [], timings = [], frameErrors = [], paintTimeouts = [];
let current, revision = 0, draft = 'P0 shared draft', beats = 0, confirmedWrite = null, controlSecret;
let previousBeat = performance.now(), maxBeatGap = 0;
setInterval(() => { const now = performance.now(); maxBeatGap = Math.max(maxBeatGap, now - previousBeat); previousBeat = now; beats++; }, 100);
const report = value => fetch('/__p0_app_report', { method: 'POST', body: JSON.stringify(value) });
const external = (operation, value = {}) => fetch('/__p0_external', { method: 'POST', headers: { 'x-p0-control': controlSecret }, body: JSON.stringify({ operation, ...value }) }).then(r => r.json());
const append = checks.push.bind(checks);
checks.push = (...items) => { for (const item of items) void external('progress', { step: item.step }); return append(...items); };
async function until(read, label, timeout = 12000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const value = await read(); if (value) return value; await pause(25); }
  throw Error(`timeout: ${label}`);
}
async function delivered(type, data = {}) { return invoke('p0_deliver', { generation: current.generation, packet: { type, ...data } }); }
const directory = createConversationDirectory();
const state = conversation();
function snapshot() {
  revision++; state.draft = draft;
  return { generation: current.generation, context: { workspaceId: state.workspace.id, sessionId: state.session.id, revision }, acceptedEdits: 0,
    data: { conversation: state, actions: directory.project(state) } };
}
async function update() {
  const start = performance.now();
  const value = snapshot(); await delivered('update', { snapshot: value });
  await until(() => inbox.find(item => item.generation === current.generation && item.packet.type === 'update-received' && item.packet.revision === revision), 'document received snapshot');
  try { await until(() => inbox.find(item => item.generation === current.generation && item.packet.type === 'rendered' && item.packet.revision === revision), 'paint acknowledgement', 2000); }
  catch { paintTimeouts.push({generation: current.generation, revision, messages: inbox.slice(-2)}); return null; }
  return performance.now() - start;
}
async function mountView(framework) {
  const start = performance.now();
  current = await invoke('p0_mount', { framework, x: 300, y: 250, width: 700, height: 440 });
  await until(() => inbox.find(item => item.generation === current.generation && item.packet.type === 'ready'), 'ready');
  await update();
  timings.push({ framework, mountMs: performance.now() - start });
  return current;
}
async function nextPacket(type) { return (await until(() => inbox.find(item => item.generation === current.generation && item.packet.type === type), type)).packet; }
async function attempt(command, args = {}) {
  try { return { command, accepted: true, value: await invoke(command, args) }; }
  catch (error) { return { command, accepted: false, error: String(error) }; }
}

window.addEventListener('error', event => frameErrors.push(event.message));
window.p0App = { stats: () => ({ beats, maxBeatGap, current, revision, draft, confirmedWrite }), recover: () => invoke('p0_control', { generation: current.generation, operation: 'dispose' }) };
try {
  const config = await (await fetch('/__p0_app_config')).json();
  controlSecret = config.secret;
  localStorage.setItem('p0-host-marker', 'host-only-memory-marker');
  await listen('p0-message', event => { inbox.push(event.payload); if (inbox.length > 5000) inbox.shift(); });
  const workspace = await invoke('add_workspace', { path: config.workspacePath });
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
  checks.push({ step: 'trusted host access before child', result: await attempt('get_presentation_selection') });
  await getCurrentWindow().setFocus();
  mount(App, { target: document.getElementById('app') });
  await until(() => document.querySelector('button[data-host-navigation="management"]'), 'actual App management');

  // Acquire the real native command's caller before attaching a second WebView.
  // Its result will be checked against the scratch Git index by the outer runner.
  const write = invoke('apply_workspace_git_file_action', { workspaceId: workspace.id, repositoryId: null, path: 'p0-proof.txt', action: 'stage', requestId: 'p0-real-native-approval' })
    .then(value => { confirmedWrite = { accepted: true, value }; }, error => { confirmedWrite = { accepted: false, error: String(error) }; });
  await pause(600);
  await mountView('react');
  checks.push({ step: 'host commands with embedded child', selection: await attempt('get_presentation_selection'), workspaces: await attempt('list_workspaces') });
  await delivered('ipc-audit');
  checks.push({ step: 'untrusted IPC and network isolation', result: await nextPacket('audit-result') });
  let unknownAudit;
  const stopUnknown = await listen('p0-unknown-result', event => { unknownAudit = event.payload; });
  await invoke('p0_control', { generation: current.generation, operation: 'unknown-caller' });
  await until(() => unknownAudit, 'unknown caller audit');
  checks.push({ step: 'unregistered caller rejected', results: unknownAudit });
  await invoke('p0_control', { generation: current.generation, operation: 'close-unknown' }); stopUnknown();
  const processIds = await invoke('p0_inspect');
  checks.push({ step: 'process baseline', processIds, sample: await external('sample', processIds) });

  // Native child ordering, host management and forced suspension are separate checks.
  await invoke('p0_control', { generation: current.generation, operation: 'suspend' });
  const before = inbox.length;
  await delivered('edit', { value: 'must not arrive while suspended' }); await pause(250);
  checks.push({ step: 'native suspension', noNewMessages: inbox.length === before });
  await invoke('p0_control', { generation: current.generation, operation: 'resume' });
  await delivered('allocate'); await nextPacket('allocated');
  checks.push({ step: '64MiB touched allocation', sample: await external('sample', processIds) });

  await delivered('fault'); await nextPacket('loop-starting');
  const beforeLoop = beats; await pause(1500);
  checks.push({ step: 'loop host heartbeat', advanced: beats - beforeLoop, sample: await external('sample', processIds) });
  checks.push({ step: 'native approval during loop', input: await external('approve', { marker: 'p0-proof.txt', ...processIds }) });
  await until(() => confirmedWrite, 'real Git approval result'); await write;
  checks.push({ step: 'real Git approval result', result: confirmedWrite });
  checks.push({ step: 'actual App management during loop', input: await external('management', processIds), bodyContainsManagement: document.body.innerText.includes('管理中心') });
  const recoveryStart = performance.now();
  await invoke('p0_control', { generation: current.generation, operation: 'dispose' });
  await pause(1000);
  checks.push({ step: 'public close after loop', elapsedMs: performance.now() - recoveryStart, sample: await external('sample', processIds),
    hostSelection: await attempt('get_presentation_selection') });
  await pause(4200);
  checks.push({ step: 'closed loop after five seconds', elapsedMs: performance.now() - recoveryStart, sample: await external('sample', processIds) });
  checks.push({ step: 'diagnostic cleanup of closed runaway process', result: await external('crash', processIds) });
  await pause(250);
  document.querySelector('button[aria-label="关闭管理中心"]')?.click();
  await mountView('svelte');
  const svelteIds = await invoke('p0_inspect');
  checks.push({ step: 'Svelte replacement', processIds: svelteIds, draft });

  // Fixed finite fixture and serial updates: do not infer whole-app performance.
  state.timeline = Array.from({ length: 1000 }, (_, i) => ({ id: `m-${i}`, turnId: null, role: 'assistant', toolName: null, entryType: null, content: `Message ${i} ` + 'x'.repeat(950), status: 'completed' }));
  const renderTimes = [];
  for (let i = 0; i < 20; i++) { state.timeline[999].content += '.'; renderTimes.push(await update()); }
  const quantile = (values, p) => values.includes(null) ? null : [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.ceil(values.length*p)-1)];
  checks.push({ step: '1000-message serial stream', samples: renderTimes, p50: quantile(renderTimes,.5), p95: quantile(renderTimes,.95),
    snapshotBytes: new TextEncoder().encode(JSON.stringify(snapshot())).length, sample: await external('sample', svelteIds) });
  await delivered('oversize'); checks.push({ step: 'oversized message', result: await nextPacket('oversize-result') });
  const floodStart = beats;
  await delivered('flood'); const flood = await nextPacket('flood-result');
  checks.push({ step: '2000-message finite flood', result: flood, hostBeats: beats - floodStart, maxBeatGap });

  await getCurrentWindow().setSize(new LogicalSize(1100, 760));
  await invoke('p0_control', { generation: current.generation, operation: 'bounds', x: 280, y: 220, width: 600, height: 390 });
  await update();
  checks.push({ step: 'window and child bounds updated', hostBeats: beats });
  checks.push({ step: 'crash exact experimental content process', result: await external('crash', svelteIds) });
  await pause(750);
  await mountView('react');
  checks.push({ step: 'replacement after process crash', processIds: await invoke('p0_inspect') });
  await invoke('p0_control', { generation: current.generation, operation: 'dispose' });
  const late = await attempt('p0_deliver', { generation: current.generation, packet: { type: 'update' } });
  checks.push({ step: 'disposed generation rejected', result: late });
  await report({ completed: true, checks, timings, beats, maxBeatGap, frameErrors, paintTimeouts,
    scope: 'Actual App and Tauri, opt-in experimental native bridge; real scratch Git stage with native AX approval; framework fixture is not a full workbench' });
} catch (error) { await report({ completed: false, error: String(error), checks, timings, beats, maxBeatGap, confirmedWrite, frameErrors, paintTimeouts, lastMessages: inbox.slice(-10) }); }
