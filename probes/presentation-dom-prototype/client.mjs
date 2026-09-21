// Runs entirely inside the untrusted document. Deliberately callable without a gesture.
export function connect(render) {
  let snapshot, serial = 0, editSequence = 0;
  const post = data => {
    if (window.p0Tauri) return window.__TAURI_INTERNALS__.invoke('p0_post', { generation: window.p0Generation, packet: data }).catch(error => { window.p0LastError = String(error); });
    else if (window.p0NativeTransport) window.webkit.messageHandlers.p0.postMessage(data);
    else parent.postMessage(data, '*');
  };
  function request(operation, value, overrides = {}) {
    const action = snapshot.data.actions.find(item => item.operation === operation);
    post({ type: 'intent', generation: snapshot.generation, requestId: `request-${++serial}`, intent: {
      id: action?.token ?? 'invented', event: action?.event ?? 'click', context: snapshot.context,
      ...(value === undefined ? {} : { value }), ...(operation === 'draft' ? { editSequence: ++editSequence } : {}),
    }, ...overrides });
  }
  function receive(data) {
    if (data.type === 'update') {
      snapshot = data.snapshot;
      editSequence = Math.max(editSequence, snapshot.acceptedEdits);
      render(snapshot, request);
      if (window.p0Tauri) post({ type: "update-received", revision: snapshot.context.revision, visibility: document.visibilityState });
      requestAnimationFrame(() => post({ type: 'rendered', generation: snapshot.generation, revision: snapshot.context.revision }));
    }
    if (data.type === 'fault') { post({ type: 'loop-starting' }); setTimeout(() => { while (true) {} }, 20); }
    if (data.type === 'attack') {
      request('send', undefined, { isTrusted: true, userGesture: true });
      post({ type: 'confirm', isTrusted: true });
      post({ type: 'invoke', command: 'send_agent_prompt' });
      try { parent.p0.confirm(true); } catch { /* isolation result reported below */ }
    }
    if (data.type === 'edit') request('draft', data.value);
    if (data.type === 'ipc-audit') void audit();
    if (data.type === 'allocate') {
      window.p0Memory = new Uint8Array(64 * 1024 * 1024); window.p0Memory.fill(19);
      post({ type: 'allocated', bytes: window.p0Memory.length });
    }
    if (data.type === 'flood') {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      void Promise.allSettled(Array.from({ length: 2000 }, () => invoke('p0_post', { generation: window.p0Generation, packet: { type: 'flood-item' } })))
        .then(results => setTimeout(() => post({ type: 'flood-result', fulfilled: results.filter(item => item.status === 'fulfilled').length,
          rejected: results.filter(item => item.status === 'rejected').length }), 1200));
    }
    if (data.type === 'oversize') {
      void window.__TAURI_INTERNALS__.invoke('p0_post', { generation: window.p0Generation, packet: { value: 'x'.repeat(128 * 1024) } })
        .then(() => post({ type: 'oversize-result', accepted: true }), error => post({ type: 'oversize-result', accepted: false, error: String(error) }));
    }
  }
  async function audit() {
    const invoke = window.__TAURI_INTERNALS__.invoke, results = [];
    for (const [command, args] of [
      ['list_workspaces', {}], ['get_presentation_selection', {}],
      ['resolve_agent_approval', { sessionId: 'p0-invalid', requestId: 'p0-invalid', decision: 'accept' }],
      ['p0_mount', { framework: 'react', x: 0, y: 0, width: 100, height: 100 }],
      ['p0_deliver', { generation: window.p0Generation, packet: { type: 'attack' } }],
      ['p0_inspect', {}],
      ['plugin:window|is_visible', { label: 'main' }],
      ['plugin:event|emit', { event: 'p0-message', payload: { forged: true } }],
      ['p0_post', { generation: window.p0Generation - 1, packet: { type: 'ready' } }],
    ]) {
      try { const value = await invoke(command, args); results.push({ command, accepted: true, value }); }
      catch (error) { results.push({ command, accepted: false, error: String(error) }); }
    }
    const violations = [];
    const listener = event => violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    window.addEventListener('securitypolicyviolation', listener);
    let network;
    try { await fetch('/__p0_forbidden_read'); network = 'allowed'; } catch { network = 'rejected'; }
    const storageLeak = localStorage.getItem('p0-host-marker');
    setTimeout(() => { window.removeEventListener('securitypolicyviolation', listener); post({ type: 'audit-result', results, network, violations, storageLeak }); }, 100);
  }
  window.addEventListener('message', event => { if (event.source === parent) receive(event.data); });
  window.p0Receive = receive;
  window.p0Request = request;
  const checks = { parentAccess: false, tauri: Boolean(window.__TAURI_INTERNALS__), storage: false };
  try { checks.parentAccess = parent !== window && Boolean(parent.document); } catch {}
  try { localStorage.setItem('p0-only', '1'); checks.storage = true; localStorage.removeItem('p0-only'); } catch {}
  post({ type: 'ready', checks });
}
