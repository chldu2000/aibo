/** Generic host tool transport. No provider names, database access, or tool-specific behavior. */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export function hostToolDefinitions(context) {
  const catalog=context?.hostTools;
  if (catalog == null) return [];
  if (catalog.schema!=='aibo.host-tools/v1' || !Array.isArray(catalog.tools) || catalog.tools.length>32
      || catalog.tools.some(tool=>!tool || typeof tool.name!=='string' || typeof tool.description!=='string' || tool.inputSchema?.type!=='object')) throw Error('Invalid host tool catalog');
  return structuredClone(catalog.tools);
}
export function createHostToolChannel() {
  let active, next=0;
  const pending=new Map();
  const fail=(message)=>Object.assign(new Error(message),{kind:'permission_denied'});
  function clear(owner, reason) {
    for (const [id, item] of pending) if(item.owner===owner){pending.delete(id);clearTimeout(item.timer);item.reject(fail(reason));}
  }
  return {
    begin(request,tools,nativeSessionId) {
      if(active) throw Error('Host tool invocation already active');
      const owner={request,tools,nativeSessionId,names:new Set(hostToolDefinitions(request.context).map(tool=>tool.name))};
      active=owner;
      const abort=()=>clear(owner,'cancelled: host tool invocation cancelled');
      tools.signal.addEventListener('abort',abort,{once:true});
      return ()=>{tools.signal.removeEventListener('abort',abort);clear(owner,'cancelled: host tool invocation ended');if(active===owner)active=undefined;};
    },
    call(name,input) {
      const owner=active;
      if(!owner || !owner.request.context.turnId || owner.tools.signal.aborted || !owner.names.has(name)) return Promise.reject(fail('Host tool is not available in this active turn'));
      if(pending.size>=8) return Promise.reject(Error('Host tool concurrency limit'));
      if(Buffer.byteLength(JSON.stringify(input))>131072) return Promise.reject(Error('Host tool input exceeds limit'));
      const requestId=`host-history-${++next}`;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Host tool request timed out'));},Math.max(1,Math.min(30000,owner.request.deadlineUnixMs-Date.now())));
        pending.set(requestId,{owner,resolve,reject,timer});
        try {owner.tools.emit({type:'workspace.requested',nativeSessionId:owner.nativeSessionId(),turnId:owner.request.context.turnId,
          correlation:{requestId},payload:{requestId,tool:name,input}});}
        catch(error){clearTimeout(timer);pending.delete(requestId);reject(error);}
      });
    },
    respond(input) {
      const item=pending.get(input.requestId);
      if(!item || item.owner!==active || active.tools.signal.aborted) throw fail('Host tool request is no longer pending');
      pending.delete(input.requestId);clearTimeout(item.timer);
      if(typeof input.error==='string')item.reject(Error(input.error));else item.resolve(input.result);
      return {resolved:true};
    },
  };
}

/** Private loopback relay for SDK-backed MCP stdio children. Never expose credentials to the model. */
export async function createHostToolMcpBridge({definitions,call}) {
  const token=randomBytes(32).toString('hex');
  let confirm;const ready=new Promise(resolve=>{confirm=resolve;});
  let inflight=0;
  const sockets=new Set();
  const server=createServer(async(req,res)=>{
    const reply=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}};
    if(req.method!=='POST' || req.headers.authorization!==`Bearer ${token}`){reply(403,{error:'Unauthorized'});return;}
    if(inflight>=8){reply(429,{error:'Tool concurrency limit'});return;}
    inflight++;
    try {
      let size=0;const parts=[];
      for await(const part of req){size+=part.length;if(size>131072){reply(413,{error:'Input exceeds limit'});req.destroy();return;}parts.push(part);}
      const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(req.url==='/list'){reply(200,{tools:definitions});confirm();return;}
      if(req.url!=='/call' || !definitions.some(tool=>tool.name===input.name)) throw Error('Unknown host tool');
      reply(200,{result:await call(input.name,input.arguments??{})});
    }catch(error){reply(400,{error:String(error.message??error).slice(0,4096)});}
    finally{inflight--;}
  });
  server.requestTimeout=35000;server.headersTimeout=5000;server.timeout=35000;server.maxConnections=12;
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const moduleUrl=new URL('./host-tools-mcp.mjs',import.meta.url).href;
  // In an installed plugin use the public host SDK export; local source tests use a file URL.
  const specifier=moduleUrl.startsWith('aibo-sdk:')?'@aibo/capability-runtime/host-tools-mcp':moduleUrl;
  return {
    ready,
    configuration:{name:`aibo-${randomBytes(8).toString('hex')}`,command:process.execPath,args:[...process.execArgv,'--input-type=module','-e',`import { serveHostToolMcp } from ${JSON.stringify(specifier)}; await serveHostToolMcp();`],
      env:{AIBO_HOST_TOOL_ENDPOINT:`http://127.0.0.1:${server.address().port}`,AIBO_HOST_TOOL_TOKEN:token}},
    async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));},
  };
}
