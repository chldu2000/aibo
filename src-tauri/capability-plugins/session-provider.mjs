import { createHostToolChannel, hostToolDefinitions } from '@aibo/capability-runtime/host-tools';
/** Session domain implementation for the shared Capability runtime; no Agent wire protocol. */
export function sessionProvider({engine, pluginId, actions}) {
  let owner, boundSession, nativeSessionId, executionProfile, nextTool = 0;
  const deferred = [];
  const hostTools = createHostToolChannel();
  const pendingTools = new Map();
  const reject = message => { throw new Error(message); };
  const snapshot = output => ({...output,recovery:engine.snapshot(),capabilities:[...engine.capabilities,...(engine.hostToolsRegistered?.() ? ['host-tools'] : [])]});
  function publish(event) {
    if (!owner) {
      // Native providers may finish a recovery update immediately after a turn.
      // It belongs to the next invocation, never to a completed stream identity.
      if (deferred.length >= 128 || JSON.stringify([...deferred,event]).length > 1048576) reject('Session event backlog exceeded');
      deferred.push(event);
      return;
    }
    owner.tools.emit(event);
    if (event.type === 'adapter.crashed') owner.fail(new Error('Native session process exited'));
    if (event.turnId === owner.request.context.turnId && ['turn.completed','turn.failed'].includes(event.type)) {
      owner.terminal = {status:event.type === 'turn.failed' ? 'failed' : event.payload.status ?? 'completed'};
      settle(owner);
    }
  }
  function settle(current) {
    if (!current.terminal || current.controls > 0 || current.settling) return;
    current.settling = true;
    // Let a control acknowledgement reach the capability dispatcher before ending its owner.
    setImmediate(()=>{current.settling=false;if(current.controls===0) current.finish(current.terminal);});
  }
  function clearTools(current,reason) {
    for (const [id,pending] of pendingTools) if (pending.owner===current) {
      pendingTools.delete(id);pending.reject(new Error(reason));
    }
  }
  engine.configure({emit:publish,requestHostTool:hostTools.call,requestTool(tool,input) {
    const current=owner;
    if (!current || !current.request.context.turnId || current.tools.signal.aborted) return Promise.reject(new Error('No active turn for workspace request'));
    if (pendingTools.size >= 32) return Promise.reject(new Error('Workspace request limit'));
    const requestId=`host-tool-${++nextTool}`;
    return new Promise((resolve,reject)=>{
      pendingTools.set(requestId,{owner:current,resolve,reject});
      try {publish({type:'workspace.requested',nativeSessionId,turnId:current.request.context.turnId,correlation:{requestId},payload:{requestId,tool,input}});}
      catch(error) {pendingTools.delete(requestId);reject(error);}
    });
  }});
  function params(request, tools) {
    const context=request.context;
    if (request.scope.kind!=='session' || !request.scope.id || !context.workspaceId || !context.workspacePath || !context.permissions.includes('workspace.read')) reject('Session requires a trusted workspace scope');
    if (boundSession && boundSession!==request.scope.id) reject('Session scope cannot change');
    return {sessionId:request.scope.id,requestId:request.invocationId,turnId:context.turnId,
      workspace:{workspaceId:context.workspaceId,path:context.workspacePath,trusted:true},
      executionProfile:{...(request.input.executionProfile ?? {}),runtimeDataPath:tools.initialization.privateData.path},
      binding:{pluginId,recovery:request.input.recovery},hostTools:hostToolDefinitions(context),input:request.input};
  }
  async function perform(request,tools) {
    const p=params(request,tools);
    if (request.capability==='aibo.session.open') {
      if (!['create','resume'].includes(request.input.mode)) reject('Invalid session open mode');
      boundSession=request.scope.id;
      if (nativeSessionId) return snapshot({nativeSessionId});
      const result=await engine.execute(request.input.mode,p);
      executionProfile=p.executionProfile;
      nativeSessionId=result.nativeSessionId;
      return snapshot(result);
    }
    if (!nativeSessionId) reject('Session must be opened in this runtime generation');
    if (['aibo.session.turn','aibo.session.turn.write','aibo.session.goal.resume','aibo.session.goal.resume.write'].includes(request.capability)) {
      const resumeGoal = request.capability.startsWith('aibo.session.goal.resume');
      if (!p.turnId || (!resumeGoal && (typeof request.input.text!=='string' || !request.input.text.trim()))) reject('Turn identity and text are required');
      if (request.capability.endsWith('.write') && !request.context.permissions.includes('workspace.write')) reject('Write turn requires host write authority');
      if (executionProfile?.filesystemPolicy && executionProfile.filesystemPolicy!=='read-only' && !request.context.permissions.includes('workspace.write')) reject('Writable session requires an approved write invocation');
      const instructions = request.context.settings?.values?.additionalInstructions;
      if (!resumeGoal && typeof instructions === 'string' && instructions.trim()) {
        p.input = {...p.input, text:`${instructions}\n\n${p.input.text}`};
      }
      await engine.execute(resumeGoal ? 'resumeGoal' : 'send',p);
      return snapshot(await owner.done);
    }
    if (request.capability==='aibo.session.close') {
      const result=await engine.execute('close',p);nativeSessionId=null;deferred.length=0;return snapshot(result);
    }
    const action=actions[request.capability];
    if (!action) reject('Unsupported session capability');
    return snapshot(await engine.execute('operation',{...p,operationId:action}));
  }
  return {
    async invoke(request,tools) {
      if (owner) reject('Session invocation already running');
      let finish,fail;
      const done=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
      // Failure can arrive while native send is still awaiting an acknowledgement.
      done.catch(()=>{});
      const current={request,tools,done,finish,fail,controls:0,terminal:null,settling:false};
      owner=current;
      let endHostTools=()=>{};
      const abort=()=>{clearTools(current,'Session invocation cancelled');fail(new Error('Session invocation cancelled'));void engine.stop();};
      tools.signal.addEventListener('abort',abort,{once:true});
      try {
        endHostTools=hostTools.begin(request,tools,()=>nativeSessionId);
        params(request,tools);
        while (deferred.length) publish(deferred.shift());
        return await perform(request,tools);
      } finally {
        endHostTools();
        tools.signal.removeEventListener('abort',abort);
        clearTools(current,'Session invocation ended');
        if (owner===current) owner=undefined;
      }
    },
    async control(request,{invocation,signal}) {
      const current=owner;
      if (!current || current.request.invocationId!==invocation.invocationId || signal.aborted) reject('No matching session invocation');
      current.controls++;
      try {
        if (request.capability==='aibo.session.tool.respond') {
          if (String(request.input.requestId).startsWith('host-history-')) return hostTools.respond(request.input);
          const pending=pendingTools.get(request.input.requestId);
          if (!pending || pending.owner!==current) reject('Workspace request is no longer pending');
          pendingTools.delete(request.input.requestId);
          if (request.input.error) pending.reject(new Error(request.input.error));
          else pending.resolve(request.input.result);
          return {resolved:true};
        }
        const p=params({...invocation,input:request.input},current.tools);
        if (request.capability==='aibo.session.cancel') {
          clearTools(current,'Turn cancelled');
          return snapshot(await engine.execute('cancel',p));
        }
        const action=actions[request.capability];
        if (!action) reject('Unsupported session control');
        return snapshot(await engine.execute('operation',{...p,operationId:action}));
      } finally {current.controls--;settle(current);}
    },
    close:()=>engine.stop(),
  };
}
