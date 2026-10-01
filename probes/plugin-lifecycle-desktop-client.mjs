import { invoke } from '@tauri-apps/api/core';
const check=(condition,message)=>{if(!condition)throw Error(message);};
try {
  const {workspacePath,packagePath,upgradePath,downgradePath}=await(await fetch('/__plugin_lifecycle_config')).json();
  check(await invoke('read_plugin_upgrade_policy').then(()=>false,()=>true),'retired upgrade policy command is not registered');
  const workspace=await invoke('add_workspace',{path:workspacePath});
  let plugin=await invoke('install_agent_plugin',{path:packagePath});
  await invoke('set_agent_plugin_enabled',{id:plugin.id,enabled:true});
  const scope={kind:'workspace',id:workspace.id};
  const capability='dev.aibo.capability-echo.echo';
  await invoke('bind_capability_provider',{binding:{scope,capability,version:'1.0.0',installationId:plugin.id,contributionId:'dev.aibo.capability-echo.read'}});
  const response=await invoke('invoke_capability',{request:{scope,capability,version:'1.0.0',requestId:'lifecycle-native',turnId:null,input:{value:'history survives uninstall'}}});
  const originalId=plugin.id;
  const same=await invoke('install_agent_plugin',{path:packagePath});check(same.id===originalId,'duplicate must be a no-op');
  let preview=await invoke('preview_plugin_install',{path:upgradePath});check(preview.kind==='upgrade','upgrade preview');
  plugin=await invoke('install_agent_plugin',{path:upgradePath,token:preview.token});
  check((await invoke('list_plugin_installations')).filter(p=>p.pluginId===plugin.pluginId&&p.installed).length===1,'single current version');
  check((await invoke('list_plugin_undo_targets')).includes(plugin.id),'undo available');
  await invoke('undo_plugin_replacement',{id:plugin.id});
  check((await invoke('list_plugin_installations')).find(p=>p.id===originalId).installed,'undo restores original');
  preview=await invoke('preview_plugin_install',{path:upgradePath});
  plugin=await invoke('install_agent_plugin',{path:upgradePath,token:preview.token});
  await invoke('invoke_capability',{request:{scope,capability,version:'1.0.0',requestId:'after-upgrade',turnId:null,input:{value:'new usage'}}});
  check(!(await invoke('list_plugin_undo_targets')).includes(plugin.id),'new invocation invalidates undo');
  const downgrade=await invoke('preview_plugin_install',{path:downgradePath});check(downgrade.kind==='downgrade','downgrade preview');
  let refused=false;try{await invoke('install_agent_plugin',{path:downgradePath,token:downgrade.token});}catch{refused=true;}check(refused,'direct downgrade refused');
  plugin=await invoke('install_agent_plugin',{path:downgradePath,token:downgrade.token,reinstall:true});check(!plugin.enabled,'reinstall starts disabled');
  const impact=await invoke('preview_plugin_removal',{id:plugin.id});
  check(impact.bindings.length===0,'reinstall clears old capability bindings');
  let rejected=false;
  try {await invoke('uninstall_agent_plugin',{id:plugin.id,token:'stale',keepHistory:true});}catch{rejected=true;}
  check(rejected,'stale confirmation must fail');
  await invoke('uninstall_agent_plugin',{id:plugin.id,token:impact.token,keepHistory:true});
  const removed=(await invoke('list_plugin_installations')).find(item=>item.id===plugin.id);
  check(removed&&!removed.installed,'installation tombstone retained');
  const result={ok:true,installationId:plugin.id,pluginId:plugin.pluginId,instanceId:response.instanceId,invocationId:response.invocationId,replacementAndUndo:true,downgradeReinstall:true};
  document.querySelector('#result').textContent=JSON.stringify(result);
  await fetch('/__plugin_lifecycle_report',{method:'POST',body:JSON.stringify(result)});
} catch(error) {await fetch('/__plugin_lifecycle_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error),stack:error.stack})});}
