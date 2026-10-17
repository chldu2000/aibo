import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {codexLauncher} from './launcher.mjs';

const text = value => typeof value === 'string' ? value.slice(0,256) : '';
const unavailable = () => new Error('Codex management status is unavailable');
/** A dedicated, bounded connection: no threads, session state, raw errors or credentials. */
export function createManagementReader({launch=codexLauncher, start=spawn, timeoutMs=25000}={}) {
  return async function read(request,{signal}) {
    const section=request.input.sectionId;
    if (request.scope.kind!=='application' || !['account','usage'].includes(section) || signal.aborted) throw unavailable();
    const launcher=launch();
    const child=start(launcher.command,[...launcher.prefix,'app-server'],{cwd:homedir(),stdio:['pipe','pipe','pipe'],shell:launcher.shell});
    const pending=new Map();let sequence=0,buffer='',stopped=false;
    const fail=()=>{stopped=true;for(const entry of pending.values())entry.reject(unavailable());pending.clear();};
    const abort=()=>{fail();child.kill();};
    const timer=setTimeout(abort,timeoutMs);
    signal.addEventListener('abort',abort,{once:true});
    child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);
    child.stdout.setEncoding('utf8');
    child.stderr.resume(); // Native diagnostics can contain secrets; never forward them.
    const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
    child.stdout.on('data',chunk=>{
      buffer+=chunk.toString();
      if(buffer.length>262144){abort();return;}
      for(let newline;(newline=buffer.indexOf('\n'))>=0;){
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
        let message;try{message=JSON.parse(line);}catch{abort();return;}
        if(!message || typeof message!=='object' || Array.isArray(message)){abort();return;}
        const entry=pending.get(message.id);
        if(entry){pending.delete(message.id);if(message.error)entry.reject(unavailable());else entry.resolve(message.result);}
        else if(message.method && message.id!==undefined)send({id:message.id,error:{code:-32601,message:'Unsupported request'}});
      }
    });
    const rpc=(method,params)=>new Promise((resolve,reject)=>{
      if(stopped || signal.aborted){reject(unavailable());return;}
      const id=++sequence;pending.set(id,{resolve,reject});send({id,method,params});
    });
    try {
      await rpc('initialize',{clientInfo:{name:'aibo_codex_management',title:'Aibo Codex Management',version:'1.0.0'}});
      send({method:'initialized',params:{}});
      const account=await rpc('account/read',{refreshToken:false});
      if(!account || !Object.hasOwn(account,'account') || (account.account !== null && !['apiKey','chatgpt','bedrock'].includes(account.account?.type))) throw unavailable();
      const result={schema:'aibo.management-data/v1',target:{id:'codex-default',label:'Codex'},state:'ready',message:'',observedAt:new Date().toISOString(),properties:[],metrics:[]};
      if(section==='account'){
        const identity=account?.account;
        result.properties.push({key:'status',label:'登录状态',value:identity?'已登录':'未登录'});
        if(identity){
          result.properties.push({key:'type',label:'账户类型',value:text(identity.type)});
          if(identity.type==='chatgpt'){
            if(text(identity.email))result.properties.push({key:'email',label:'邮箱',value:text(identity.email)});
            if(text(identity.planType))result.properties.push({key:'plan',label:'套餐',value:text(identity.planType)});
          }
        }
        return result;
      }
      if(!account?.account){result.state='unavailable';result.message='登录后可查看额度。';return result;}
      const limits=await rpc('account/rateLimits/read',{});
      const rate=limits?.rateLimits;
      for(const [key,label] of [['primary','主要额度'],['secondary','次要额度']]){
        const window=rate?.[key];
        if(!Number.isFinite(window?.usedPercent))continue;
        result.metrics.push({key,label,value:Math.min(100,Math.max(0,window.usedPercent)),unit:'% 已使用',maximum:100,
          ...(Number.isSafeInteger(window.resetsAt)&&window.resetsAt>=0?{resetsAt:window.resetsAt}:{})});
      }
      if(!result.metrics.length){result.state='unavailable';result.message='当前账户未提供可用的额度信息。';}
      return result;
    } finally {
      clearTimeout(timer);signal.removeEventListener('abort',abort);fail();
      if(child.pid && child.exitCode===null && child.signalCode===null){
        const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();
        const force=setTimeout(()=>child.kill('SIGKILL'),1000);
        await exited;clearTimeout(force);
      }
    }
  };
}
export const readManagement=createManagementReader();
