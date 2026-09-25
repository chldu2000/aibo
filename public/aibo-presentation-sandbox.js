/* Trusted drawing bridge. Package JavaScript executes only in a terminable Worker. */
(() => {
  'use strict';
  let port, worker, workerUrl, sequence = 0, current, timer, heartbeat, pongDeadline, assets = {}, themeKeys = [], disposed = false;
  const root = document.getElementById('root');
  let editSequence = 0, acceptedEdits = 0, localInputActions = [], allowInheritance = false;
  const edits = new Map();
  const suggestionStates=new Map(), completions=new Map();
  function bindSuggestions(entry,elements,clicks,interactive,context){
    const {element,key,config,expectedValue}=entry,container=elements.get(config.listKey);
    if(!container)throw Error('invalid_presentation_suggestions');
    const allOptions=config.keys.map(key=>clicks.get(key)).filter(option=>option&&!option.element.disabled);
    const categories=(config.categories??[]).map(category=>({...category,element:elements.get(category.key),options:new Set(category.options)}));
    if(allOptions.some(option=>!container.contains(option.element))||categories.some(category=>!(category.element instanceof HTMLButtonElement)||!container.contains(category.element)||interactive.has(category.key)))throw Error('invalid_presentation_suggestions');
    const scope=JSON.stringify([context.workspaceId,context.sessionId,config.listKey,categories.map(category=>category.key)]);
    const signature=JSON.stringify([scope,expectedValue,allOptions.map(option=>option.token)]);
    let state=suggestionStates.get(key);
    if(!state||state.signature!==signature){state={scope,signature,index:0,dismissed:false,category:state?.scope===scope?state.category:0};suggestionStates.set(key,state);}
    let options=[];
    const listbox=container.matches('[role=listbox]')?container:container.querySelector('[role=listbox]')??container;
    listbox.id='aibo-suggestions-'+encodeURIComponent(config.listKey);
    element.setAttribute('aria-controls',listbox.id);element.setAttribute('aria-autocomplete','list');
    function paint(){
      options=allOptions.filter(option=>!categories.length||categories[state.category].options.has(option.key));
      if(state.index>=options.length)state.index=0;
      const visible=!state.dismissed&&(options.length>0||categories.length>0)&&element.value===expectedValue;
      container.hidden=!visible;element.setAttribute('aria-expanded',String(visible));element.removeAttribute('aria-activedescendant');
      categories.forEach((category,index)=>category.element.setAttribute(category.element.getAttribute('role')==='tab'?'aria-selected':'aria-pressed',String(index===state.category)));
      allOptions.forEach(option=>{const index=options.indexOf(option);option.element.hidden=index<0;option.element.id='aibo-option-'+encodeURIComponent(option.key);option.element.setAttribute('aria-selected',String(visible&&index>=0&&index===state.index));if(visible&&index>=0&&index===state.index)element.setAttribute('aria-activedescendant',option.element.id);});
    }
    function complete(){completions.set(key,{value:element.value,workspaceId:context.workspaceId,sessionId:context.sessionId});element.focus({preventScroll:true});}
    allOptions.forEach(option=>{
      option.element.addEventListener('mousedown',event=>{if(event.isTrusted)event.preventDefault();});
      option.element.addEventListener('click',event=>{if(event.isTrusted&&!option.element.disabled)complete();});
    });
    categories.forEach((category,index)=>category.element.addEventListener('click',event=>{
      if(!event.isTrusted)return;state.category=index;state.index=0;state.dismissed=false;paint();element.focus({preventScroll:true});
    }));
    paint();
    element.addEventListener('input',()=>{completions.delete(key);paint();});
    element.addEventListener('keydown',event=>{
      if(!event.isTrusted||event.isComposing||event.altKey||element.disabled||element.readOnly||element.value!==expectedValue)return;
      if((event.metaKey||event.ctrlKey)&&!(config.confirmWithPrimary&&event.key==='Enter'))return;
      if(event.key==='Tab'&&categories.length){event.preventDefault();state.category=(state.category+(event.shiftKey?-1:1)+categories.length)%categories.length;state.index=0;state.dismissed=false;paint();return;}
      if(event.key==='Escape'&&!state.dismissed){event.preventDefault();state.dismissed=true;paint();return;}
      if(!options.length)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();state.index=state.dismissed?0:(state.index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;state.dismissed=false;paint();options[state.index].element.scrollIntoView({block:'nearest'});return;
      }
      if((event.key==='Enter'||event.key==='Tab'&&config.confirmWithTab&&!event.shiftKey)&&!event.repeat&&!state.dismissed){
        event.preventDefault();const option=options[state.index];complete();
        send({type:'intent',intent:{id:option.token,event:'click',context}});
      }
    });
  }
  let splitters = new Map(), drag;
  function endResize() {
    if(drag&&root.hasPointerCapture(drag.pointerId))root.releasePointerCapture(drag.pointerId);
    drag=undefined;
  }
  function resizeInput(binding,value) {
    if(!active||!current||!localInputActions.includes(binding.token)||binding.context.workspaceId!==current.context.workspaceId||binding.context.sessionId!==current.context.sessionId)return;
    send({type:'intent',intent:{id:binding.token,event:'input',context:binding.context,value:String(Math.min(binding.max,Math.max(binding.min,value))),editSequence:++editSequence}});
  }
  root.addEventListener('pointermove',event=>{
    if(!event.isTrusted||!drag||event.pointerId!==drag.pointerId)return;
    const binding=splitters.get(drag.key);
    if(!binding||binding.token!==drag.token||binding.context.workspaceId!==drag.context.workspaceId||binding.context.sessionId!==drag.context.sessionId){endResize();return;}
    resizeInput(binding,drag.value+(event.clientX-drag.x)*drag.direction);
  });
  window.addEventListener('blur',endResize);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(name,()=>{drag=undefined;});
  let active = false, suspended = false, searchRequested = false, pendingState, lastState, stateTimer, restoring = false, renderedContext, mayRestoreFocus = false;
  function timelineViewport() {
    let element=root.querySelector('[data-presentation-key="conversation:timeline"]');
    while(element&&element!==root){
      if(/auto|scroll/.test(getComputedStyle(element).overflowY)&&element.clientHeight>0)return element;
      element=element.parentElement;
    }
    return null;
  }
  function timelineMessages(viewport) {
    const timeline=viewport.querySelector('[data-presentation-key="conversation:timeline"]');
    return [...(timeline?.children??[])].filter(element=>element.matches('article,details')&&/^(message:|message-group:)/.test(element.dataset.presentationKey??''));
  }
  function captureTimeline() {
    if(!root.getBoundingClientRect().width)return lastState?.timeline??null;
    const viewport=timelineViewport();if(!viewport)return null;
    const bounds=viewport.getBoundingClientRect();
    const message=timelineMessages(viewport).find(element=>{const rect=element.getBoundingClientRect();return rect.height>0&&rect.bottom>bounds.top&&rect.top<bounds.bottom;});
    return message?{key:message.dataset.presentationKey,offset:message.getBoundingClientRect().top-bounds.top,source:'external'}:null;
  }
  function restoreTimeline(anchor) {
    if(!anchor||anchor.source!=='default')return;
    const viewport=timelineViewport();if(!viewport)return;
    const message=timelineMessages(viewport).find(element=>element.dataset.presentationKey===anchor.key);if(!message)return;
    const rect=message.getBoundingClientRect();
    viewport.scrollTop+=rect.top-viewport.getBoundingClientRect().top-Math.max(-Math.max(0,rect.height-24),anchor.offset);
  }
  function captureState() {
    const element=document.activeElement;
    return {timeline:captureTimeline(),focus:element?.dataset.presentationKey?{key:element.dataset.presentationKey,selection:(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)&&element.selectionStart!==null?[element.selectionStart,element.selectionEnd]:null}:(lastState?.focus??null),
      scroll:[...root.querySelectorAll('[data-presentation-key]')].filter(element=>element.scrollLeft||element.scrollTop).slice(0,1024).map(element=>({key:element.dataset.presentationKey,x:element.scrollLeft,y:element.scrollTop})),window:[scrollX,scrollY],
      disclosures:[...root.querySelectorAll('details[data-presentation-key]')].slice(0,1024).map(element=>({key:element.dataset.presentationKey,open:element.open}))};
  }
  function restoreState(state,focus) {
    if(!state){window.scrollTo(0,0);return;}
    restoring=true;
    const elements=new Map([...root.querySelectorAll('[data-presentation-key]')].map(element=>[element.dataset.presentationKey,element]));
    for(const item of state.disclosures??[]) {const element=elements.get(item.key);if(element instanceof HTMLDetailsElement)element.open=item.open;}
    for(const item of state.scroll??[]) {const element=elements.get(item.key);if(element){element.scrollLeft=item.x;element.scrollTop=item.y;}}
    const element=state.focus&&elements.get(state.focus.key);
    if(element){if(focus && document.hasFocus() && !suspended && !searchRequested)element.focus({preventScroll:true});if(state.focus.selection&&typeof element.setSelectionRange==='function')try{element.setSelectionRange(...state.focus.selection)}catch{}}
    window.scrollTo(...state.window);
    restoreTimeline(state.timeline);
    restoring=false;
  }
  function publishState() {
    if(!active||!current||restoring||renderedContext?.revision!==current.context.revision)return;
    clearTimeout(stateTimer);stateTimer=setTimeout(()=>{if(active&&current&&renderedContext?.revision===current.context.revision){lastState=captureState();send({type:'view-state',context:current.context,state:lastState});}},0);
  }
  for(const event of ['focusin','selectionchange','scroll','input','toggle'])document.addEventListener(event,publishState,true);
  const tags = new Set('div section main aside header footer nav article h1 h2 h3 p span strong em pre code ul ol li button input textarea label select option table thead tbody tr th td details summary hr img svg path circle rect line polyline polygon g'.split(' '));
  const attributes = new Set('id role title aria-label aria-labelledby aria-describedby aria-expanded aria-selected aria-pressed aria-live aria-busy aria-atomic aria-hidden aria-current aria-disabled aria-orientation aria-valuenow aria-valuemin aria-valuemax placeholder type value min max step disabled readonly checked selected multiple name for tabindex rows cols open alt width height viewBox d fill stroke stroke-width stroke-linecap stroke-linejoin cx cy r x y x1 x2 y1 y2 points'.split(' '));
  const eventNames = new Set(['click', 'input', 'change', 'keydown']);
  const send = message => { if (!disposed) port?.postMessage(message); };
  function stop() {
    clearTimeout(stateTimer); clearTimeout(timer); clearTimeout(pongDeadline); clearInterval(heartbeat); worker?.terminate(); worker = null;
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = null;
  }
  function fail(message) { stop(); send({ type: 'failure', message: String(message).slice(0, 512) }); }
  let previewScope = '', previews = new Map();
  function render(tree, context) {
    const hadFocus = document.hasFocus();
    const scope = JSON.stringify([context.workspaceId,context.sessionId]);
    if (scope !== previewScope) { previewScope=scope; previews.clear(); }

    let count = 0; const keys = new Set();
    const elements=new Map(),clicks=new Map(),interactive=new Set(),suggestions=[];let suggestionCount=0;
    const nextSplitters=new Map();
    const state=pendingState!==undefined?pendingState:captureState();
    pendingState=undefined;
    function node(value, depth) {
      if (++count > 10000 || depth > 64 || !value || !tags.has(value.tag) || typeof value.key !== 'string' || value.key.length > 256 || keys.has(value.key)) throw Error('invalid_presentation_tree');
      keys.add(value.key);
      const element = ['svg','path','circle','rect','line','polyline','polygon','g'].includes(value.tag)
        ? document.createElementNS('http://www.w3.org/2000/svg', value.tag) : document.createElement(value.tag);
      if (value.resource !== undefined) {
        if (value.tag !== 'img' || typeof value.resource !== 'string') throw Error('invalid_presentation_image');
        if (value.resource.startsWith('attachment:')) {
          const id=value.resource.slice(11);
          const attachment=current?.data?.conversation?.attachments?.find(item=>item.id===id && item.sessionId===context.sessionId);
          if (attachment?.mediaType?.startsWith('image/')) {
            element.dataset.attachmentPreview=id;
            element.style.objectFit='contain';
            if(previews.get(id))element.src=previews.get(id);
            else if(!previews.has(id)){previews.set(id,null);send({type:'attachment-preview',id,context});}
            element.onerror=()=>{element.alt='图片无法预览 · '+attachment.path;};
          }
        } else {
          if (!assets[value.resource]?.startsWith('data:image/')) throw Error('invalid_presentation_image');
          element.src = assets[value.resource];
        }
      }
      element.dataset.presentationKey = value.key;
      elements.set(value.key,element);
      if(value.events||value.localEvents)interactive.add(value.key);
      if(value.tag==='button'&&value.events?.click)clicks.set(value.key,{key:value.key,element,token:value.events.click});
      if(value.suggestions!==undefined){
        const config=value.suggestions;
        if(value.tag!=='textarea'||!config||typeof config.listKey!=='string'||config.listKey.length>256||!Array.isArray(config.keys)||config.keys.length>100||config.keys.some(key=>typeof key!=='string'||key.length>256)||new Set(config.keys).size!==config.keys.length||config.confirmWithTab!==undefined&&typeof config.confirmWithTab!=='boolean'||value.events?.keydown||value.localEvents?.keydown)throw Error('invalid_presentation_suggestions');
        if(config.confirmWithPrimary!==undefined&&typeof config.confirmWithPrimary!=='boolean'||config.categories!==undefined&&(!Array.isArray(config.categories)||config.categories.length>8||new Set(config.categories.map(category=>category?.key)).size!==config.categories.length||config.categories.some(category=>!category||typeof category.key!=='string'||category.key.length>256||!Array.isArray(category.options)||category.options.length>100||category.options.some(key=>!config.keys.includes(key)))))throw Error('invalid_presentation_suggestions');
        suggestionCount+=config.keys.length+(config.categories??[]).reduce((count,category)=>count+category.options.length,0);if(suggestionCount>1000)throw Error('invalid_presentation_suggestions');
        suggestions.push({element,key:value.key,config,expectedValue:String(value.attrs?.value??'')});
      }
      if(value.resize!==undefined){
        const resize=value.resize;
        if(value.tag!=='button'||!resize||typeof resize.token!=='string'||!resize.token||resize.token.length>256||![1,-1].includes(resize.direction)||![resize.value,resize.min,resize.max].every(number=>Number.isFinite(number)&&number>=0&&number<=4096)||resize.min>resize.max||value.events?.keydown||value.localEvents?.keydown)throw Error('invalid_presentation_resize');
        const binding={...resize,context};nextSplitters.set(value.key,binding);
        element.addEventListener('pointerdown',event=>{
          if(!event.isTrusted||event.button!==0||element.disabled||!active||!localInputActions.includes(binding.token))return;
          event.preventDefault();element.focus({preventScroll:true});
          drag={...binding,key:value.key,x:event.clientX,pointerId:event.pointerId};root.setPointerCapture(event.pointerId);
        });
        element.addEventListener('keydown',event=>{
          if(!event.isTrusted||event.isComposing||element.disabled)return;
          const next=event.key==='ArrowLeft'?binding.value-16*binding.direction:event.key==='ArrowRight'?binding.value+16*binding.direction:event.key==='Home'?binding.min:event.key==='End'?binding.max:null;
          if(next===null)return;event.preventDefault();resizeInput(binding,next);
        });
      }
      if (value.inlineSize !== undefined) {
        if (!Number.isFinite(value.inlineSize) || value.inlineSize < 0 || value.inlineSize > 4096) throw Error('invalid_presentation_size');
        element.style.setProperty('--presentation-inline-size', value.inlineSize+'px');
      }
      if (value.primaryEnter !== undefined) {
        if (value.tag !== 'textarea' || typeof value.primaryEnter !== 'string' || !value.primaryEnter || value.primaryEnter.length > 256 || value.events?.keydown || value.localEvents?.keydown) throw Error('invalid_presentation_shortcut');
        element.addEventListener('keydown', event => {
          if (!event.isTrusted || event.isComposing || event.repeat || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || element.disabled || element.readOnly) return;
          if(value.suggestions?.confirmWithPrimary&&element.hasAttribute('aria-activedescendant'))return;
          event.preventDefault(); event.stopPropagation();
          send({ type:'intent', intent:{ id:value.primaryEnter, event:'click', context } });
        });
      }
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
      if (value.tag === 'textarea' && value.events?.input && current?.data?.conversationActions?.some(action => action.operation === 'draft' && action.token === value.events.input)) {
        element.addEventListener('paste', event => {
          if (!event.isTrusted || !active || suspended || element.disabled || element.readOnly) return;
          const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
          if (!files.length) return;
          event.preventDefault();
          send({type:'clipboard-images', context, token:value.events.input, files});
        });
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
    splitters=nextSplitters;
    if(drag&&(!splitters.has(drag.key)||splitters.get(drag.key).token!==drag.token))endResize();
    root.replaceChildren(next);
    for(const entry of suggestions)bindSuggestions(entry,elements,clicks,interactive,context);
    const suggestionKeys=new Set(suggestions.map(entry=>entry.key));
    for(const key of suggestionStates.keys())if(!suggestionKeys.has(key))suggestionStates.delete(key);
    // A delayed render must not take focus back from a fixed host control.
    restoreState(state,active&&mayRestoreFocus&&hadFocus);
    for(const [key,completion] of completions){
      const element=elements.get(key);
      if(!(element instanceof HTMLTextAreaElement)||completion.workspaceId!==context.workspaceId||completion.sessionId!==context.sessionId){completions.delete(key);continue;}
      if(element.value!==completion.value){
        if(typeof element.setSelectionRange==='function')element.setSelectionRange(element.value.length,element.value.length);
        if(state?.focus?.key===key)state.focus.selection=[element.value.length,element.value.length];
        completions.delete(key);
      }
    }
    lastState=state; renderedContext=context;

  }
  function update(input, acknowledged = 0, local = undefined) {
    if (current && (current.context.workspaceId !== input.context.workspaceId || current.context.sessionId !== input.context.sessionId)) {edits.clear();if(pendingState===undefined)pendingState=null;}
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
        if (data.type === 'attachment-preview' && data.scope===previewScope) {
          const url=typeof data.url==='string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(data.url)?data.url:null;
          previews.set(data.id,url);
          for(const element of root.querySelectorAll('img[data-attachment-preview]'))if(element.dataset.attachmentPreview===data.id){if(url)element.src=url;else element.alt='图片无法预览 · '+element.alt;}
        }
        else if (data.type === 'start' && !worker) start(data);
        else if(data.type==='suspended'){suspended=data.value===true;if(suspended){mayRestoreFocus=false;searchRequested=false;}}
        else if(data.type==='activate'){active=true;mayRestoreFocus=data.restoreFocus===true;if(data.viewState){lastState=data.viewState;restoreState(lastState,data.restoreFocus===true);}}
        else if(data.type==='restore-focus'){mayRestoreFocus=true;restoreState(lastState,true);}
        else if (data.type === 'update' && worker) { mayRestoreFocus=data.restoreFocus===true;if('viewState' in data)pendingState=data.viewState; localInputActions = data.localInputActions; update(data.input, data.acceptedEdits); }
        else if (data.type === 'dispose') { stop(); root.replaceChildren(); disposed = true; port.close(); }
      } catch (error) { fail(error); }
    };
    port.start(); send({ type: 'connected' });
  }
  window.addEventListener('message', initialize);
  let shiftPressed = null, shiftPrevious = null;
  const resetSearchShortcut = () => { shiftPressed = null; shiftPrevious = null; };
  function searchShortcut(event) {
    if (!event.isTrusted || !active) { resetSearchShortcut(); return; }
    if (event.type === 'keydown' && !event.isComposing && !event.repeat && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); event.stopImmediatePropagation(); resetSearchShortcut(); searchRequested=true; mayRestoreFocus=false; send({type:'global-search'}); return;
    }
    if (event.key !== 'Shift' || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) { resetSearchShortcut(); return; }
    const now = performance.now();
    if (event.type === 'keydown') { if (shiftPressed !== null) resetSearchShortcut(); shiftPressed = now; return; }
    if (shiftPressed === null || now - shiftPressed > 400) { resetSearchShortcut(); return; }
    shiftPressed = null;
    if (shiftPrevious !== null && now - shiftPrevious <= 400) { resetSearchShortcut(); searchRequested=true; mayRestoreFocus=false; send({type:'global-search'}); }
    else shiftPrevious = now;
  }
  window.addEventListener('keydown', searchShortcut, true);
  window.addEventListener('keyup', searchShortcut, true);
  window.addEventListener('blur', resetSearchShortcut);
  window.addEventListener('compositionstart', resetSearchShortcut, true);
  window.addEventListener('keydown', event => {
    if (event.isTrusted && (event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Backspace') {
      event.preventDefault(); event.stopImmediatePropagation(); send({ type: 'recovery' });
    }
  }, true);
})();
