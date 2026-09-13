/* Trusted drawing bridge. Package JavaScript executes only in a terminable Worker. */
(() => {
  'use strict';
  let port, worker, workerUrl, sequence = 0, current, timer, heartbeat, pongDeadline, assets = {}, themeKeys = [], disposed = false;
  const root = document.getElementById('root');
  let editSequence = 0, acceptedEdits = 0, localInputActions = [], allowInheritance = false;
  const edits = new Map();
  const tags = new Set('div section main aside header footer nav article h1 h2 h3 p span strong em pre code ul ol li button input textarea label select option table thead tbody tr th td details summary hr img svg path circle rect line polyline polygon g'.split(' '));
  const attributes = new Set('id role title aria-label aria-labelledby aria-describedby aria-expanded aria-selected aria-pressed aria-live aria-atomic aria-hidden aria-current aria-disabled placeholder type value disabled readonly checked selected multiple name for tabindex rows cols open alt width height viewBox d fill stroke stroke-width stroke-linecap stroke-linejoin cx cy r x y x1 x2 y1 y2 points'.split(' '));
  const eventNames = new Set(['click', 'input', 'change', 'keydown']);
  const send = message => { if (!disposed) port?.postMessage(message); };
  function stop() {
    clearTimeout(timer); clearTimeout(pongDeadline); clearInterval(heartbeat); worker?.terminate(); worker = null;
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = null;
  }
  function fail(message) { stop(); send({ type: 'failure', message: String(message).slice(0, 512) }); }
  function render(tree, context) {
    let count = 0; const keys = new Set();
    const prior = document.activeElement;
    const focus = prior?.dataset.presentationKey;
    const selection = prior instanceof HTMLInputElement || prior instanceof HTMLTextAreaElement
      ? [prior.selectionStart, prior.selectionEnd] : null;
    const scroll = new Map([...root.querySelectorAll('[data-presentation-key]')].map(element => [element.dataset.presentationKey, [element.scrollLeft, element.scrollTop]]));
    const windowScroll = [scrollX, scrollY];
    function node(value, depth) {
      if (++count > 10000 || depth > 64 || !value || !tags.has(value.tag) || typeof value.key !== 'string' || value.key.length > 256 || keys.has(value.key)) throw Error('invalid_presentation_tree');
      keys.add(value.key);
      const element = ['svg','path','circle','rect','line','polyline','polygon','g'].includes(value.tag)
        ? document.createElementNS('http://www.w3.org/2000/svg', value.tag) : document.createElement(value.tag);
      if (value.resource !== undefined) {
        if (value.tag !== 'img' || typeof value.resource !== 'string' || !assets[value.resource]?.startsWith('data:image/')) throw Error('invalid_presentation_image');
        element.src = assets[value.resource];
      }
      element.dataset.presentationKey = value.key;
      if (value.text !== undefined) {
        if (typeof value.text !== 'string' || value.text.length > 1024 * 1024) throw Error('invalid_presentation_text');
        element.textContent = value.text;
      }
      if (value.className !== undefined) {
        if (typeof value.className !== 'string' || value.className.length > 1024) throw Error('invalid_presentation_class');
        element.setAttribute('class', value.className);
      }
      if (value.attrs) for (const [name, attribute] of Object.entries(value.attrs)) {
        if (!attributes.has(name) || (typeof attribute !== 'boolean' && typeof attribute !== 'string') || String(attribute).length > 65536) throw Error('invalid_presentation_attribute');
        if (name === 'type' && !['text', 'search', 'password', 'number', 'checkbox', 'radio', 'button', 'range'].includes(attribute)) throw Error('invalid_presentation_input');
        if (typeof attribute === 'boolean') { if (attribute) element.setAttribute(name, ''); }
        else element.setAttribute(name, attribute);
        if (name === 'value' && 'value' in element) element.value = String(attribute);
      }
      if (value.events) for (const [event, id] of Object.entries(value.events)) {
        if (!eventNames.has(event) || typeof id !== 'string' || !id || id.length > 256) throw Error('invalid_presentation_event');
        element.addEventListener(event, e => {
          if (!e.isTrusted) return;
          if (event === 'click') e.stopPropagation();
          let edited;
          if (event === 'input' && localInputActions.includes(id) && 'value' in element) {
            edited = ++editSequence;
            edits.set(value.key, { sequence: edited, value: element.value });
          }
          send({ type: 'intent', intent: { id, event, context,
            ...(edited ? { editSequence: edited } : {}),
            ...('value' in element ? { value: String(element.value).slice(0, 1024 * 1024) } : {}),
            ...(event === 'keydown' ? { key: e.key } : {}) } });
        });
      }
      if (value.localEvents) for (const [event, id] of Object.entries(value.localEvents)) {
        if (!eventNames.has(event) || typeof id !== 'string' || !id || id.length > 256 || value.events?.[event]) throw Error('invalid_local_presentation_event');
        element.addEventListener(event, e => {
          if (!e.isTrusted) return;
          e.stopPropagation();
          update(current, acceptedEdits, { id, event,
            ...('value' in element ? { value: String(element.value).slice(0, 1024 * 1024) } : {}),
            ...(event === 'keydown' ? { key: e.key } : {}) });
        });
      }
      const edit = edits.get(value.key);
      if (edit && 'value' in element) {
        if (edit.sequence > acceptedEdits) element.value = edit.value;
        else edits.delete(value.key);
      }
      if (value.children !== undefined) {
        if (!Array.isArray(value.children)) throw Error('invalid_presentation_children');
        for (const child of value.children) element.append(node(child, depth + 1));
      }
      return element;
    }
    const next = node(tree, 0);
    root.replaceChildren(next);
    for (const element of root.querySelectorAll('[data-presentation-key]')) {
      const position = scroll.get(element.dataset.presentationKey);
      if (position) { element.scrollLeft = position[0]; element.scrollTop = position[1]; }
      if (element.dataset.presentationKey === focus) {
        element.focus({ preventScroll: true });
        if (selection && typeof element.setSelectionRange === 'function') {
          try { element.setSelectionRange(...selection); } catch { /* Numeric inputs lack selection. */ }
        }
      }
    }
    window.scrollTo(...windowScroll);
  }
  function update(input, acknowledged = 0, local = undefined) {
    if (current && (current.context.workspaceId !== input.context.workspaceId || current.context.sessionId !== input.context.sessionId)) edits.clear();
    acceptedEdits = acknowledged;
    current = input; const ticket = ++sequence;
    for (const name of themeKeys) document.documentElement.style.removeProperty(name);
    themeKeys = Object.keys(input.theme);
    for (const [name, value] of Object.entries(input.theme)) document.documentElement.style.setProperty(name, value);
    clearTimeout(timer);
    timer = setTimeout(() => fail('presentation_render_timeout'), 3000);
    worker.postMessage({ ticket, input, local });
  }
  function start(packet) {
    assets = packet.assets;
    localInputActions = packet.localInputActions;
    allowInheritance = packet.allowInheritance;
    const style = document.createElement('style');
    style.textContent = 'html,body{margin:0;min-height:100%;}*{box-sizing:border-box;}' + packet.css;
    document.head.append(style);
    // Worker blob inherits this document's CSP: no network, imports or eval.
    const source = packet.source + '\n;self.onmessage = async ({data}) => { if(data.ping) { self.postMessage({pong:true}); return; } try { if(data.local) await self.aiboPresentation.handle(data.local,data.input); const tree = await self.aiboPresentation.render(data.input); self.postMessage({ticket:data.ticket,tree}); } catch(error) { self.postMessage({ticket:data.ticket,error:String(error)}); } };';
    workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(workerUrl);
    worker.onerror = () => fail('presentation_worker_failed');
    heartbeat = setInterval(() => {
      if (!worker || pongDeadline) return;
      worker.postMessage({ ping: true });
      pongDeadline = setTimeout(() => fail('presentation_worker_unresponsive'), 3000);
    }, 1000);
    let messages = 0, bucket = Date.now();
    worker.onmessage = ({ data }) => {
      if (Date.now() - bucket > 1000) { bucket = Date.now(); messages = 0; }
      if (++messages > 120) { fail('presentation_message_limit'); return; }
      if (data?.pong) { clearTimeout(pongDeadline); pongDeadline = null; return; }
      if (!data || data.ticket !== sequence) return;
      clearTimeout(timer);
      if (data.error) { fail(data.error); return; }
      if (data.tree === null && allowInheritance) {
        root.replaceChildren(); send({ type: 'inherit', revision: current.context.revision }); return;
      }
      try { render(data.tree, current.context); send({ type: 'rendered', revision: current.context.revision }); }
      catch (error) { fail(error); }
    };
    update(packet.input);
  }
  function initialize(event) {
    if (event.source !== parent || event.data?.type !== 'aibo-presentation-connect' || event.ports.length !== 1 || port) return;
    window.removeEventListener('message', initialize);
    port = event.ports[0];
    port.onmessage = ({ data }) => {
      if (disposed) return;
      try {
        if (data.type === 'start' && !worker) start(data);
        else if (data.type === 'update' && worker) update(data.input, data.acceptedEdits);
        else if (data.type === 'dispose') { stop(); root.replaceChildren(); disposed = true; port.close(); }
      } catch (error) { fail(error); }
    };
    port.start(); send({ type: 'connected' });
  }
  window.addEventListener('message', initialize);
  window.addEventListener('keydown', event => {
    if (event.isTrusted && (event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Backspace') {
      event.preventDefault(); event.stopImmediatePropagation(); send({ type: 'recovery' });
    }
  }, true);
})();
