import '/src/app.css';
import {invoke} from '@tauri-apps/api/core';
import {mount,tick} from 'svelte';
import App from '/src/App.svelte';
import {setUiKit} from '/src/lib/ui-kit/registry.ts';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(find,label){for(let n=0;n<300;n++){const value=find();if(value)return value;await delay(50);}throw Error(`timeout: ${label}`);}
const evidence=[];
try {
  const {workspacePath}=await(await fetch('/__session_native_config')).json();
  const workspace=await invoke('add_workspace',{path:workspacePath});
  await invoke('set_workspace_trust',{workspaceId:workspace.id,trusted:true});
  const installations=await invoke('list_plugin_installations');
  for(const name of ['pi','codex']){
    const installation=installations.find(item=>item.pluginId===`dev.aibo.${name}`&&item.enabled&&item.installed);
    if(!installation)throw Error(`missing enabled ${name} capability installation`);
    if(installation.manifest.schema!=='aibo.plugin-manifest/v2')throw Error('retired manifest installed');
    const session=await invoke('create_agent_session',{workspaceId:workspace.id,agentId:`dev.aibo.${name}.agent`,installationId:installation.id});
    const snapshot=await invoke('invoke_agent_capability',{sessionId:session.id,capability:'session.snapshot',input:{}});
    await invoke('get_timeline',{sessionId:session.id});
    await invoke('set_agent_plugin_enabled',{id:installation.id,enabled:false});
    await invoke('set_agent_plugin_enabled',{id:installation.id,enabled:true});
    await invoke('resume_agent_session',{sessionId:session.id});
    const restored=await invoke('invoke_agent_capability',{sessionId:session.id,capability:'session.snapshot',input:{}});
    evidence.push({provider:name,sessionId:session.id,capabilities:session.capabilities,snapshot:!!snapshot,recovered:!!restored});
    await invoke('close_agent_session',{sessionId:session.id});
  }
  mount(App,{target:document.getElementById('app')});
  const row=await until(()=>Array.from(document.querySelectorAll('button')).find(node=>node.getAttribute('aria-label')?.startsWith(workspace.label+'，')),'workspace row');row.click();await tick();
  for(const kit of ['shadcn','material3']){
    setUiKit(kit);await tick();
    await until(()=>document.body.innerText.includes('新建会话'),'session workbench');
    evidence.push({kit,workbench:true});
  }
  await fetch('/__session_native_report',{method:'POST',body:JSON.stringify({ok:true,evidence,limitations:'No model turn or physical keyboard/screen-reader validation'})});
}catch(error){await fetch('/__session_native_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error),evidence,text:document.body.innerText.slice(0,1500)})});}
