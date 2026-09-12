import '/src/app.css';
import * as api from '../src/lib/api';
import { mount, tick } from 'svelte';
import App from '/src/App.svelte';
import { setUiKit } from '/src/lib/ui-kit/registry.ts';
const check=(value,label)=>{if(!value)throw Error(label);};
async function until(read,label) {
  const end=Date.now()+20000;
  while(Date.now()<end){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}
  throw Error(label);
}
const content=()=>document.querySelector('section.installed-workbench textarea')?.value ?? [...document.querySelectorAll('section.installed-workbench .text-line > span:last-child')].map(line=>line.textContent).join('\n');
try {
  const config=await (await fetch('/__external_config')).json();
  const workspace=await api.addWorkspace(config.workspacePath);await api.setWorkspaceTrust(workspace.id,true);
  const plugin=await api.installAgentPlugin(config.packagePath);check(plugin.runnable,'External plugin activation diagnostics');await api.setAgentPluginEnabled(plugin.id,true);
  const scope={kind:'application'};
  const providers=await api.listCapabilityProviders(scope,'dev.example.greeting.read','1.0.0');
  const provider=providers.find(item=>item.installationId===plugin.id&&item.contributionId==='dev.example.greeting.provider');
  check(provider,'Installed provider discovered');
  await api.bindCapabilityProvider(scope,'dev.example.greeting.read','1.0.0',provider);
  const result=await api.invokeCapability({scope,capability:'dev.example.greeting.read',version:'1.0.0',requestId:'outside-ui',input:{actionId:'refresh',itemId:null,offset:0}});
  check(result.output.view.content==='EXTERNAL_SDK_OK','External capability response');
  mount(App,{target:document.getElementById('app')});
  await until(()=>document.querySelector('button[aria-label="恢复默认呈现"]'),'Actual App loaded');
  const skins=[];
  for(const kit of ['shadcn','material3']) {
    setUiKit(kit);await tick();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}));
    const entry=await until(()=>[...document.querySelectorAll('[role="option"]')].find(item=>item.querySelector('strong')?.textContent==='External SDK greeting'&&!item.disabled),'Generic contribution entry');entry.click();
    await until(()=>content()==='EXTERNAL_SDK_OK','External semantic view rendered');
    const before=new Set((await api.listCapabilityEvents(scope)).map(event=>event.invocationId));
    const refresh=[...document.querySelectorAll('section.installed-workbench button')].find(button=>button.textContent.trim()==='刷新');check(refresh&&!refresh.disabled,'Refresh action available');refresh.click();
    await until(async()=> (await api.listCapabilityEvents(scope)).some(event=>!before.has(event.invocationId)&&event.status==='completed'),'Refresh ran a new capability invocation');
    await until(()=>content()==='EXTERNAL_SDK_OK','Refresh retained external content');
    skins.push({kit,genericEntry:true,rendered:true,refreshInvoked:true});
    if(kit==='shadcn') [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='关闭插件视图').click();
  }
  await api.uninstallAgentPlugin(plugin.id);
  check(!(await api.listSemanticContributions()).some(item=>item.installationId===plugin.id),'Uninstall removed contribution');
  await until(()=>!document.querySelector('section.installed-workbench'),'Uninstall removed active view');
  let denied=false;try {await api.invokeCapability({scope,capability:'dev.example.greeting.read',version:'1.0.0',requestId:'after-uninstall',input:{actionId:'refresh',itemId:null,offset:0}});}catch{denied=true;}
  check(denied,'Uninstalled provider cannot execute');
  check((await api.listSessions(workspace.id)).length===0,'No Agent session needed');
  await fetch('/__external_report',{method:'POST',body:JSON.stringify({ok:true,installed:true,capabilityWithoutUi:true,skins,uninstalled:true,activeViewClosed:true,newInvocationRejected:true,noAgentSession:true})});
} catch(error) {await fetch('/__external_report',{method:'POST',body:JSON.stringify({ok:false,error:JSON.stringify(error,Object.getOwnPropertyNames(error??{})),surface:document.querySelector('section.installed-workbench')?.textContent})});}
