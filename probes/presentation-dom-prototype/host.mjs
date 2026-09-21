import { createConversationDirectory } from '../../src/lib/presentation-runtime/conversation.ts';
import { conversation } from './fixture.mjs';

// PROTOTYPE: simulated side effects only. The production host is not modified.
const native = window.p0Container === 'webview' && window.webkit?.messageHandlers?.p0;
const state = conversation();
const directory = createConversationDirectory();
let frame, generation = 0, revision = 0, active = false, pending = null, suspended = false, edits = 0;
let actions = [], rendered = 0, beats = 0, executed = 0, rejected = 0, framework = null, checks = null;
let started = 0, lastRenderMs = null;
const seen = new Set();
const log = [];
const context = () => ({ workspaceId: state.workspace.id, sessionId: state.session.id, revision });
const metrics = () => ({ generation, revision, active, suspended, framework, rendered, beats, executed, rejected,
  draft: state.draft, pending: pending ? { requestId: pending.requestId, draft: pending.draft, revision: pending.intent.context.revision } : null,
  checks, lastRenderMs, log: log.slice(-30) });
function record(message) { log.push(message); paint(); }
function paint() {
  document.querySelector('#status').textContent = `外观：${framework ?? '未挂载'}；版本：${revision}；宿主心跳：${beats}；模拟发送：${executed}；拒绝：${rejected}`;
  document.querySelector('#draft').textContent = state.draft;
  document.querySelector('#pending').textContent = pending ? `待宿主确认：${pending.draft}` : '无待确认请求';
  document.querySelector('#confirm').disabled = !pending;
  document.querySelector('#log').textContent = log.slice(-12).join('\n');
}
function send(data) {
  if (native) native.postMessage({ type: 'deliver', generation, data });
  else frame?.contentWindow?.postMessage(data, '*');
}
function update() {
  revision++;
  actions = directory.project(state);
  const snapshot = { generation, context: context(), acceptedEdits: edits, data: { conversation: structuredClone(state), actions } };
  send({ type: 'update', snapshot }); paint();
}
function dispose() {
  active = false; pending = null; suspended = false;
  frame?.remove(); frame = null;
  if (native) native.postMessage({ type: 'dispose', generation });
  generation++; record('撤销旧呈现通道；宿主草稿保留');
}
function mount(name) {
  dispose(); framework = name; rendered = 0; edits = 0; checks = null; seen.clear(); started = performance.now();
  if (native) native.postMessage({ type: 'mount', generation, html: window.p0Documents[name].replace('<script>', '<script>window.p0NativeTransport=true;') });
  else {
    frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts');
    frame.title = 'Prototype presentation'; frame.srcdoc = window.p0Documents[name];
    document.querySelector('#surface').replaceChildren(frame);
  }
  record(`准备 ${name}（独立 DOM）`);
}
function reject(reason) { rejected++; record(`拒绝：${reason}`); }
function receive(packet, owner) {
  if (owner !== generation) return reject('旧代际');
  if (!packet || typeof packet !== 'object' || JSON.stringify(packet).length > 65536) return reject('非法/超大消息');
  if (packet.type === 'ready') { checks = packet.checks; update(); return; }
  if (packet.type === 'rendered') {
    if (packet.revision !== revision || packet.generation !== generation) return reject('迟到渲染');
    rendered = packet.revision; if (!active) lastRenderMs = performance.now() - started; active = true; paint(); return;
  }
  if (packet.type === 'loop-starting') return record('插件即将进入死循环');
  if (packet.type !== 'intent') return reject('插件不可确认审批或调用通用 IPC');
  if (!active || suspended || pending) return reject('未激活/挂起/确认中');
  if (packet.generation !== generation) return reject('伪造代际');
  if (typeof packet.requestId !== 'string' || packet.requestId.length > 128 || seen.has(packet.requestId)) return reject('非法/重复请求');
  if (!packet.intent?.context) return reject('缺少上下文');
  const action = directory.resolve(state, context(), packet.intent);
  if (!action || !['draft', 'send'].includes(action.operation)) return reject('动作或上下文不可用');
  seen.add(packet.requestId);
  if (action.operation === 'draft') {
    if (!Number.isSafeInteger(packet.intent.editSequence) || packet.intent.editSequence <= edits || packet.intent.value.length > 16000) return reject('过期编辑/超长输入');
    edits = packet.intent.editSequence; state.draft = packet.intent.value; update(); return;
  }
  // Even a valid token and claimed isTrusted create only a confirmation request.
  pending = { ...structuredClone(packet), draft: state.draft, generation };
  record('插件请求发送；仅宿主可确认，尚未产生副作用');
}
function confirm(trusted) {
  if (!trusted || !pending || suspended) return reject('确认必须来自可信宿主输入');
  const request = pending; pending = null;
  if (request.generation !== generation || request.draft !== state.draft || !directory.resolve(state, context(), request.intent)) return reject('确认对象已失效');
  executed++; record('宿主确认：模拟发送一次（未调用 Agent）'); update();
}
window.addEventListener('message', event => { if (frame && event.source === frame.contentWindow) receive(event.data, generation); });
document.querySelector('#react').onclick = () => mount('react');
document.querySelector('#svelte').onclick = () => mount('svelte');
document.querySelector('#attack').onclick = () => send({ type: 'attack' });
document.querySelector('#confirm').onclick = event => confirm(event.isTrusted);
document.querySelector('#recover').onclick = () => dispose();
document.querySelector('#suspend').onclick = () => { suspended = !suspended; paint(); };
document.querySelector('#loop').onclick = () => send({ type: 'fault' });
setInterval(() => { beats++; paint(); }, 100);
window.p0 = {
  mount, dispose, stats: metrics, receive, update,
  attack: () => send({ type: 'attack' }), fault: () => send({ type: 'fault' }),
  edit: value => send({ type: 'edit', value }),
  suspend: value => { suspended = value; paint(); },
  invalidate: () => { state.busy = true; update(); },
  packet: () => ({ type: 'intent', generation, requestId: `manual-${performance.now()}`, intent: {
    id: actions.find(item => item.operation === 'send')?.token, event: 'click', context: context(),
  } }),
};
paint();
