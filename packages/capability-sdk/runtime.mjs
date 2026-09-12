/** Runtime 2.0 dispatcher. Host authority and process cancellation remain in Aibo. */
export function createCapabilityRuntime({ pluginId, pluginVersion, contributionId, operations, invoke, send }) {
  let initialized, active, closed = false, nextId = 0;
  const pending = new Map();
  const copy = value => JSON.parse(JSON.stringify(value));
  const offered = copy(operations);
  const reply = (id, result) => send({jsonrpc:'2.0',id,result});
  const reject = (id, message) => send({jsonrpc:'2.0',id,error:{code:-32602,message}});
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
      if (active || p?.protocol !== '2.0' || p.pluginId !== pluginId || p.pluginVersion !== pluginVersion || p.contributionId !== contributionId || typeof p.generationId !== 'string' || typeof p.instanceId !== 'string') return reject(id,'Incompatible initialization');
      if (initialized && JSON.stringify(initialized) !== JSON.stringify(p)) return reject(id,'Runtime identity cannot change');
      initialized = copy(p);
      return reply(id,{protocol:'2.0',pluginId,pluginVersion,generationId:p.generationId,operations:copy(offered)});
    }
    if (method !== 'capability.invoke') return reject(id,'Unsupported capability method');
    if (!initialized || active || p?.generationId !== initialized.generationId || p.instanceId !== initialized.instanceId || p.contributionId !== contributionId || typeof p.invocationId !== 'string' || !Number.isSafeInteger(p.deadlineUnixMs) || !offered.some(op=>op.capability===p.capability && op.version===p.contractVersion && op.operationId===p.operationId)) return reject(id,'Invalid invocation identity or operation');
    if (p.deadlineUnixMs <= Date.now()) return reject(id,'Capability deadline expired');
    const owner = {id:p.invocationId,abort:new AbortController(),calls:0};
    active = owner;
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
      const result = await Promise.race([Promise.resolve().then(()=>invoke(copy(p),{initialization:copy(initialized),signal:owner.abort.signal,call})),aborted]);
      if (!closed) reply(id,{invocationId:owner.id,generationId:initialized.generationId,output:copy(result)});
    } catch(error) {
      if (!closed) send({jsonrpc:'2.0',id,error:{code:-32000,message:error instanceof Error?error.message:'Capability handler failed'}});
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
