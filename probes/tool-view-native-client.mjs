import '/src/app.css';
import * as api from '../src/lib/api';
import {mount,tick} from 'svelte';
import App from '/src/App.svelte';
import {setUiKit} from '/src/lib/ui-kit/registry.ts';
const check=(value,label)=>{if(!value)throw Error(label);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label){for(let i=0;i<200;i++){const result=await read();if(result)return result;await delay(100);}throw Error(label);}
try {
 const config=await(await fetch('/__tool_config')).json();
 const workspace=await api.addWorkspace(config.workspacePath);
 const plugin=await api.installAgentPlugin(config.packagePath);check(plugin.runnable,'Plugin must activate');await api.setAgentPluginEnabled(plugin.id,true);
 const catalog=await api.listSemanticContributions();const item=catalog.find(v=>v.installationId===plugin.id&&v.toolView);check(item,'Tool contribution discovery');
 const handle=await api.openToolView(workspace.id,plugin.id,item.contributionId);
 await api.requestToolView(handle.id,{action:'settings',settings:{path:'/bin/sh',args:[]}});
 mount(App,{target:document.getElementById('app')});
 await until(()=>document.querySelector('[data-presentation-layout]:not([inert])'),'App mounted');
 const skins=[];
 for(const kit of ['material3','shadcn']) {
   setUiKit(kit);await tick();
   const add=await until(()=>document.querySelector('button[aria-label="添加视图"], button[aria-label="Add view"]'),'Tool panel entry');add.click();
   const entry=await until(()=>[...document.querySelectorAll('.sidebar-picker-results button')].find(v=>v.textContent.includes('Terminal')&&!v.disabled),'Tool menu entry');entry.click();
   await until(()=>document.querySelector('iframe[title="Terminal · 终端"]'),'Tool iframe mounted');
   const terminal=await until(async()=>{const state=await api.requestToolView(handle.id,{action:'list'});return state.terminals.find(v=>v.running);},'Isolated native page initialized its backend');
   await api.requestToolView(handle.id,{action:'input',id:terminal.id,data:"printf '\\nNATIVE_%s\\n' TOOL\n"});
   await until(async()=>{const updates=await api.requestToolView(handle.id,{action:'read',cursors:{}});return updates.some(v=>atob(v.output.data).includes('NATIVE_TOOL'));},'Native PTY output');
   const frame=document.querySelector('iframe[title="Terminal · 终端"]');
   for(const deadline=Date.now()+6000;Date.now()<deadline;) {
     await delay(100);
     check(frame===document.querySelector('iframe[title="Terminal · 终端"]'),'Host refresh replaced the interactive terminal iframe');
   }
   skins.push(kit);
 }
 const reused=await api.openToolView(workspace.id,plugin.id,item.contributionId);check(reused.id===handle.id,'Repeated mounting reuses backend');
 const state=await api.requestToolView(handle.id,{action:'list'});
 for(const terminal of state.terminals)await api.requestToolView(handle.id,{action:'close',id:terminal.id});
 check(await api.closeToolView(handle.id),'Close idle tool');
 let stale=false;try{await api.requestToolView(handle.id,{action:'list'});}catch{stale=true;}check(stale,'Reject stale handle');
 await api.setAgentPluginEnabled(plugin.id,false);
 await fetch('/__tool_report',{method:'POST',body:JSON.stringify({ok:true,installed:true,discovered:true,customScheme:true,stableFrame:true,realPty:true,reused:true,staleRejected:true,skins})});
} catch(error) {await fetch('/__tool_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error),detail:JSON.stringify(error),surface:document.body.innerText.slice(-5000)})});}
