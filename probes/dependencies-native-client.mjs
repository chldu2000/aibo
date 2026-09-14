import { invoke } from '@tauri-apps/api/core';
const check=(value,message)=>{if(!value)throw Error(message);};
const report=value=>fetch('/__dep_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
try {
  const config=await(await fetch('/__dep_config')).json();let saved=config.saved;
  const cap=optional=>`dev.aibo.capability-parent.${optional?'optional-echo':'echo'}`;
  const invokeParent=(workspace,optional,id)=>invoke('invoke_capability',{request:{scope:{kind:'workspace',id:workspace.id},capability:cap(optional),version:'1.0.0',requestId:id,input:{value:'DEPENDENCY_OK'}}});
  const record=async id=>(await invoke('list_plugin_installations')).find(item=>item.id===id);
  if(config.stage===0) {
    const workspace=await invoke('add_workspace',{path:config.workspacePath});await invoke('set_workspace_trust',{workspaceId:workspace.id,trusted:true});
    const parent=await invoke('install_agent_plugin',{path:config.parentPath});
    check(parent.runnable&&parent.packageDependencies.unavailableContributions.includes('dev.aibo.capability-parent.optional'),'missing optional dependency only disables target');
    await invoke('set_agent_plugin_enabled',{id:parent.id,enabled:true});
    const child=await invoke('install_agent_plugin',{path:config.childPath});await invoke('set_agent_plugin_enabled',{id:child.id,enabled:true});
    const scope={kind:'workspace',id:workspace.id};
    for(const optional of [false,true]) {
      const offers=await invoke('list_capability_providers',{scope,capability:cap(optional),version:'1.0.0'});check(offers.length===1,'dependent contribution becomes available');
      await invoke('bind_capability_provider',{binding:{scope,capability:cap(optional),version:'1.0.0',installationId:offers[0].installationId,contributionId:offers[0].contributionId}});
      check((await invokeParent(workspace,optional,`first-${optional}`)).output.value==='DEPENDENCY_OK','real parent worker');
    }
    const newer=await invoke('install_agent_plugin',{path:config.newerPath});await invoke('set_agent_plugin_enabled',{id:newer.id,enabled:true});
    check((await record(parent.id)).packageDependencies.dependencies[0].installationId===child.id,'new compatible release cannot replace pin');
    await invoke('set_agent_plugin_enabled',{id:child.id,enabled:false});
    const unavailable=await invokeParent(workspace,true,'unavailable').catch(error=>error);check(unavailable.code==='provider_unavailable','no dependency failover');
    check((await invokeParent(workspace,false,'unrelated')).output.value==='DEPENDENCY_OK','unrelated feature still works');
    check((await record(parent.id)).runnable,'optional missing does not disable package');
    await invoke('set_agent_plugin_enabled',{id:child.id,enabled:true});
    saved={workspace,parentId:parent.id,childId:child.id,newerId:newer.id};
    await report({ok:true,stage:0,saved,evidence:{missingOptionalIsLocalized:true,lazyPin:true,newReleaseDoesNotReplacePin:true,noSilentFailover:true,unrelatedFeatureWorks:true,realParentProcess:true}});
  } else {
    check((await record(saved.parentId)).packageDependencies.dependencies[0].installationId===saved.childId,'dependency pin survives App restart');
    check((await invokeParent(saved.workspace,true,'restart')).output.value==='DEPENDENCY_OK','restored parent call');
    await invoke('uninstall_agent_plugin',{id:saved.childId});
    check((await invokeParent(saved.workspace,true,'removed').catch(error=>error)).code==='provider_unavailable','uninstalled dependency does not switch to newer release');
    check((await invokeParent(saved.workspace,false,'still-independent')).output.value==='DEPENDENCY_OK','unrelated feature survives dependency uninstall');
    check((await invoke('list_sessions',{workspaceId:saved.workspace.id})).length===0,'no Agent sessions');
    await report({ok:true,stage:1,saved,evidence:{actualAppRestart:true,persistedDependencyPin:true,uninstallBlocksAffectedOnly:true,noAgentSession:true}});
  }
}catch(error){await report({ok:false,error:JSON.stringify(error,Object.getOwnPropertyNames(error??{}))});}
