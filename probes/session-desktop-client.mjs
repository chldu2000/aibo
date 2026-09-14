import '/src/app.css';
import {invoke} from '@tauri-apps/api/core';
import {mount,tick} from 'svelte';
import App from '/src/App.svelte';
import {setUiKit} from '/src/lib/ui-kit/registry.ts';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(find,label){for(let n=0;n<300;n++){const value=await find();if(value)return value;await delay(50);}throw Error(`timeout: ${label}`);}
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
    const [snapshot,models,commands]=await Promise.all([
      invoke('invoke_agent_capability',{sessionId:session.id,capability:'session.snapshot',input:{}}),
      invoke('get_session_models',{sessionId:session.id}),
      invoke('invoke_agent_capability',{sessionId:session.id,capability:session.capabilities.includes('command.list')?'command.list':'skill.list',input:{}}),
    ]);
    if(!models || !commands)throw Error('Concurrent session context did not load');
    await invoke('get_timeline',{sessionId:session.id});
    await invoke('set_agent_plugin_enabled',{id:installation.id,enabled:false});
    await invoke('set_agent_plugin_enabled',{id:installation.id,enabled:true});
    await invoke('resume_agent_session',{sessionId:session.id});
    const restored=await invoke('invoke_agent_capability',{sessionId:session.id,capability:'session.snapshot',input:{}});
    evidence.push({provider:name,sessionId:session.id,capabilities:session.capabilities,snapshot:!!snapshot,recovered:!!restored,concurrentContext:true});
    await invoke('close_agent_session',{sessionId:session.id});
  }
  mount(App,{target:document.getElementById('app')});
  const row=await until(()=>Array.from(document.querySelectorAll('button')).find(node=>node.getAttribute('aria-label')?.startsWith(workspace.label+'，')),'workspace row');row.click();await tick();
  for(const kit of ['shadcn','material3']){
    setUiKit(kit);await tick();
    await until(()=>document.querySelector('[data-ui-component="timeline-panel"]'),'session workbench');
    const before=new Set((await invoke('list_sessions',{workspaceId:workspace.id})).map(session=>session.id));
    const create=await until(()=>document.querySelector('button[aria-label="新建 Agent 会话"]:not(:disabled)'),'session creator');
    create.click();await tick();
    const label=kit==='shadcn'?'使用 Pi 创建最低权限会话':'使用 Codex 创建只读会话';
    const agent=await until(()=>document.querySelector(`button[aria-label="${label}"]`),'agent choice');agent.click();
    const created=await until(async()=>
      (await invoke('list_sessions',{workspaceId:workspace.id})).find(session=>!before.has(session.id)&&session.state==='idle'),
      'session creation');
    const expected=['model.select',created.capabilities.includes('command.list')?'command.list':'skill.list'];
    if(created.capabilities.includes('model.reasoning'))expected.push('model.reasoning');
    await until(async()=>{
      const events=await invoke('list_capability_events',{scope:{kind:'session',id:created.id},afterSequence:0,limit:100});
      return expected.every(name=>events.some(event=>event.capability===`dev.aibo.${kit==='shadcn'?'pi':'codex'}.${name}`&&event.status==='completed'));
    },'automatic model and command loading');
    await tick();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(document.querySelector('.error-toast'))throw Error(document.querySelector('.error-toast').textContent);
    evidence.push({kit,workbench:true,uiCreatedSession:true,automaticContextLoaded:true,noErrorToast:true});
  }
  await fetch('/__session_native_report',{method:'POST',body:JSON.stringify({ok:true,evidence,limitations:'No model turn or physical keyboard/screen-reader validation'})});
}catch(error){await fetch('/__session_native_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error),evidence,text:document.body.innerText.slice(0,1500)})});}
