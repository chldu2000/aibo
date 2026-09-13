import { preparePresentationSandbox } from '../src/lib/presentation-runtime/sandbox.ts';
let current, revision=0, echoDraft=false;
const intents=[],failures=[];
const target=document.getElementById('target');
let recovered=0;
document.getElementById('recovery').onclick=()=>{recovered++;current?.dispose();current=null;};
async function packageOf(source) {
  const bytes=new TextEncoder().encode(source);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return {release:{digest:'probe',enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.probe',version:'1.0.0',displayName:'Probe skin',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',bytes:bytes.length,sha256,mediaType:'text/javascript'}]}},resources:{'skin.js':btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''))}};
}
const input=data=>({surface:'workbench',context:{workspaceId:'workspace',sessionId:'session',revision:++revision},data,theme:{'--primary':'#123456'}});
window.sandboxProbe={intents,failures,get recovered(){return recovered;},
  echoDraft(value){echoDraft=value;},
  async abortCandidate() {
    const abort=new AbortController();
    const candidate=preparePresentationSandbox(target,await packageOf('while(true){}'),input({}),()=>{},()=>{},abort.signal);
    setTimeout(()=>abort.abort(),100);
    return candidate;
  },
  async mount(source,data={}) {
    const candidate=await preparePresentationSandbox(target,await packageOf(source),input(data),intent=>{intents.push(intent);if(echoDraft&&intent.id==='draft')current?.update(input({draft:intent.value}));},error=>failures.push(error.message),undefined,{localInputActions:echoDraft?['draft']:[]});
    current?.dispose();current=candidate;candidate.activate();
  },
  update(data){current.update(input(data));},
  dispose(){current?.dispose();current=null;},
};
