import {invoke} from '@tauri-apps/api/core';
const evidence=[];
const timed=async read=>{const start=performance.now();const value=await read();return {value,ms:Math.round(performance.now()-start)}};
try{
 const config=await(await fetch('/__startup_config')).json();
 const workspace=await invoke('add_workspace',{path:config.workspacePath});
 await invoke('set_workspace_trust',{workspaceId:workspace.id,trusted:true});
 const cursor=await invoke('install_agent_plugin',{path:config.cursorPackage});
 await invoke('set_agent_plugin_enabled',{id:cursor.id,enabled:true});
 const plugins=await invoke('list_plugin_installations');
 for(const id of ['dev.aibo.codex','dev.aibo.cursor']){
  const installation=plugins.find(item=>item.pluginId===id&&item.enabled&&item.installed);
  if(!installation)throw Error(`Provider missing: ${id}`);
  const prepared=await timed(()=>invoke('create_agent_session',{workspaceId:workspace.id,agentId:id+'.agent',installationId:installation.id,deferStart:true}));
  const session=prepared.value;
  if(session.state!=='starting'||session.externalSessionId||session.capabilities.length)throw Error('Preparation claimed native readiness');
  if(prepared.ms>3000)throw Error(`Local preparation too slow: ${prepared.ms}ms`);
  const profile=await timed(()=>invoke('get_session_execution_profile',{sessionId:session.id}));
  if(!profile.value.sessionControls.length)throw Error('Modes unavailable before native startup');
  const started=await timed(()=>invoke('resume_agent_session',{sessionId:session.id}));
  if(started.value.id!==session.id||started.value.state!=='idle'||!started.value.capabilities.includes('model.select'))throw Error('Startup did not preserve identity and negotiate models');
  const models=await timed(()=>invoke('get_session_models',{sessionId:session.id}));
  if(!models.value.models.length)throw Error('Native model catalog is empty');
  const reused=await timed(()=>invoke('resume_agent_session',{sessionId:session.id}));
  if(reused.value.externalSessionId!==started.value.externalSessionId)throw Error('Live session was recreated');
  await invoke('close_agent_session',{sessionId:session.id});
  evidence.push({provider:id,pluginVersion:installation.version??installation.pluginVersion,prepareMs:prepared.ms,localModesMs:profile.ms,nativeReadyMs:started.ms,modelsMs:models.ms,reuseMs:reused.ms,models:models.value.models.length});
 }
 await fetch('/__startup_report',{method:'POST',body:JSON.stringify({ok:true,evidence})});
}catch(error){await fetch('/__startup_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error),evidence})});}
