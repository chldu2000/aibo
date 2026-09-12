/** Runtime 2.0 dispatcher. Host authority and process cancellation remain in Aibo. */
export function createCapabilityRuntime({ pluginId, pluginVersion, contributionId, protocol = '2.0', operations, invoke, control, send }) {
  if (!['2.0','2.1'].includes(protocol)) throw Error('Unsupported capability protocol');
  let initialized, active, closed = false, nextId = 0;
  const pending = new Map();
  const copy = value => JSON.parse(JSON.stringify(value));
  const offered = copy(operations);
  const reply = (id, result) => send({jsonrpc:'2.0',id,result});
  const reject = (id, message) => send({jsonrpc:'2.0',id,error:{code:-32602,message}});
  function handlerError(id, error, fallback) {
    const kinds = new Set(['unsupported','incompatible_version','permission_denied','provider_unavailable','busy','cancelled','timeout','invalid_output','invalid_input','approval_rejected','outcome_unknown']);
    const aliases = {capability_unsupported:'unsupported',invalid_request:'invalid_input',invalid_session:'invalid_input',invalid_recovery_data:'invalid_input'};
    const raw = error?.kind ?? error?.code;
    const kind = kinds.has(raw) ? raw : aliases[raw] ?? 'provider_unavailable';
    send({jsonrpc:'2.0',id,error:{code:-32000,message:(error instanceof Error ? error.message : fallback).slice(0,4096),data:{kind}}});
  }

  function close(reason = 'Capability transport closed') {
    closed = true;
    active?.abort.abort(new Error(reason));
    for (const request of pending.values()) request.reject(new Error(reason));
    pending.clear();
  }
  async function receive(message) {
    if (closed) return;
    const {id,method,params:p} = message ?? {};
    if (message?.jsonrpc !== '2.0' || (typeof id !== 'string' && typeof id !== 'number')) throw Error('Invalid JSON-RPC envelope');
    if (method === undefined) {
      const request = pending.get(id);
      if (!request) throw Error('Unknown capability response');
      pending.delete(id);
      if (message.result?.ok === true && message.result.response) request.resolve(copy(message.result.response));
      else request.reject(Object.assign(new Error(message.result?.error?.message ?? message.error?.message ?? 'Invalid capability response'), {code:message.result?.error?.code ?? 'invalid_output'}));
      return;
    }
    if (method === 'capability.initialize') {
      if (active || p?.protocol !== protocol || p.pluginId !== pluginId || p.pluginVersion !== pluginVersion || p.contributionId !== contributionId || typeof p.generationId !== 'string' || typeof p.instanceId !== 'string') return reject(id,'Incompatible initialization');
      if (initialized && JSON.stringify(initialized) !== JSON.stringify(p)) return reject(id,'Runtime identity cannot change');
      initialized = copy(p);
      return reply(id,{protocol,pluginId,pluginVersion,generationId:p.generationId,operations:copy(offered)});
    }
    if (method === 'capability.control') {
      const owner = active;
      const keys = ['instanceId','generationId','contributionId','invocationId','capability','contractVersion','operationId','input'];
      if (protocol !== '2.1' || !control || !initialized || !owner || owner.controlling || owner.abort.signal.aborted || Date.now() >= owner.request.deadlineUnixMs || !p || Object.keys(p).some(key=>!keys.includes(key)) || p.invocationId !== owner.id || p.instanceId !== initialized.instanceId || p.generationId !== initialized.generationId || p.contributionId !== contributionId || !offered.some(op=>op.capability===p.capability && op.version===p.contractVersion && op.operationId===p.operationId)) return reject(id,'Invalid control identity or operation');
      owner.controlling = true;
      let listener;
      const aborted = new Promise((_,reject) => {
        listener = () => reject(owner.abort.signal.reason);
        owner.abort.signal.addEventListener('abort',listener,{once:true});
      });
      try {
        const output = await Promise.race([Promise.resolve().then(()=>control(copy(p),{invocation:copy(owner.request),signal:owner.abort.signal})),aborted]);
        if (!closed) reply(id,{invocationId:owner.id,generationId:initialized.generationId,output:copy(output)});
      } catch(error) {
        if (!closed) handlerError(id,error,'Capability control failed');
      } finally {
        owner.abort.signal.removeEventListener('abort',listener);
        owner.controlling = false;
      }
      return;
    }
    if (method !== 'capability.invoke') return reject(id,'Unsupported capability method');
    if (!initialized || active || p?.generationId !== initialized.generationId || p.instanceId !== initialized.instanceId || p.contributionId !== contributionId || typeof p.invocationId !== 'string' || !Number.isSafeInteger(p.deadlineUnixMs) || !offered.some(op=>op.capability===p.capability && op.version===p.contractVersion && op.operationId===p.operationId)) return reject(id,'Invalid invocation identity or operation');
    if (p.deadlineUnixMs <= Date.now()) return reject(id,'Capability deadline expired');
    const owner = {id:p.invocationId,request:copy(p),abort:new AbortController(),calls:0,sequence:0,streamBytes:0,controlling:false};
    active = owner;
    const emit = event => {
      if (protocol !== '2.1') throw Error('Streaming requires capability protocol 2.1');
      if (closed || active !== owner || owner.abort.signal.aborted || Date.now() >= owner.request.deadlineUnixMs) throw Error('Invocation is no longer active');
      const value = copy(event);
      const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
      if (bytes > 262144 || owner.sequence >= 100000 || owner.streamBytes+bytes > 64*1024*1024) throw Error('Capability stream limit');
      owner.streamBytes += bytes;
      send({jsonrpc:'2.0',method:'capability.event',params:{instanceId:initialized.instanceId,generationId:initialized.generationId,contributionId,invocationId:owner.id,sequence:++owner.sequence,event:value}});
    };
    const timer = setTimeout(()=>owner.abort.abort(new Error('Capability deadline expired')),Math.max(0,Math.min(p.deadlineUnixMs-Date.now(),2147483647)));
    const call = target => {
      if (closed || active !== owner || owner.abort.signal.aborted) return Promise.reject(new Error('Invocation is no longer active'));
      if (++owner.calls > 32) return Promise.reject(new Error('Capability child call limit'));
      if (!target || Object.keys(target).some(key=>!['pluginId','contributionId','capability','version','input'].includes(key))) return Promise.reject(new Error('Child calls cannot supply host authority'));
      const childId = `sdk-child-${++nextId}`;
      return new Promise((resolve,reject) => {
        pending.set(childId,{resolve,reject,owner});
        try { send({jsonrpc:'2.0',id:childId,method:'capability.call',params:{...copy(target),invocationId:owner.id,generationId:initialized.generationId}}); }
        catch(error) {pending.delete(childId);reject(error);}
      });
    };
    let abortListener;
    const aborted = new Promise((_,reject) => {
      abortListener = () => reject(owner.abort.signal.reason);
      owner.abort.signal.addEventListener('abort',abortListener,{once:true});
    });
    try {
      const result = await Promise.race([Promise.resolve().then(()=>invoke(copy(p),{initialization:copy(initialized),signal:owner.abort.signal,call,emit})),aborted]);
      if (!closed) reply(id,{invocationId:owner.id,generationId:initialized.generationId,output:copy(result)});
    } catch(error) {
      if (!closed) handlerError(id,error,'Capability handler failed');
    } finally {
      clearTimeout(timer);
      owner.abort.signal.removeEventListener('abort',abortListener);
      owner.abort.abort(new Error('Invocation completed'));
      for (const [key,request] of pending) if (request.owner===owner) {pending.delete(key);request.reject(new Error('Parent invocation completed'));}
      if (active===owner) active=undefined;
    }
  }
  return {receive,close};
}
