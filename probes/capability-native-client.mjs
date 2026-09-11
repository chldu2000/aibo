import { invoke } from '@tauri-apps/api/core';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(condition,message)=>{if(!condition)throw Error(message);};
const report=value=>fetch('/__cap_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const cap='dev.aibo.capability-echo.echo';
try {
  const config=await(await fetch('/__cap_config')).json();let saved=config.saved;
  const request=(workspace,id,input={value:'AIBO_CAPABILITY_OK'})=>({scope:{kind:'workspace',id:workspace.id},capability:cap,version:'1.0.0',requestId:id,input});
  if(config.stage===0) {
    const a=await invoke('add_workspace',{path:config.workspaceA}),b=await invoke('add_workspace',{path:config.workspaceB});
    for(const workspace of [a,b])await invoke('set_workspace_trust',{workspaceId:workspace.id,trusted:true});
    const plugin=await invoke('install_agent_plugin',{path:config.packagePath});
    check(plugin.runnable,'provider must be activatable');await invoke('set_agent_plugin_enabled',{id:plugin.id,enabled:true});
    const unbound=await invoke('invoke_capability',{request:request(a,'unbound')}).catch(error=>error);check(unbound.code==='provider_selection_required','explicit binding required');
    for(const workspace of [a,b]) {
      const scope={kind:'workspace',id:workspace.id};
      const providers=await invoke('list_capability_providers',{scope,capability:cap,version:'1.0.0'});check(providers.length===1,'exact offer');
      await invoke('bind_capability_provider',{binding:{scope,capability:cap,version:'1.0.0',installationId:providers[0].installationId,contributionId:providers[0].contributionId}});
    }
    const value=await invoke('invoke_capability',{request:request(a,'first')});check(value.output.value==='AIBO_CAPABILITY_OK'&&value.output.workspacePath===a.path,'real worker and host-resolved path');
    let forged=false;try{await invoke('invoke_capability',{request:{...request(a,'forged'),caller:'other-window'}});}catch{forged=true;}check(forged,'forged caller rejected');
    const pending=invoke('invoke_capability',{request:request(a,'cancel',{value:'cancelled',delayMs:1600})}).catch(error=>error);
    const other=invoke('invoke_capability',{request:request(b,'other',{value:'OTHER_WORKSPACE_OK',delayMs:300})});
    let cancelled=false;for(let i=0;i<100&&!cancelled;i++){cancelled=await invoke('cancel_capability',{requestId:'cancel'});if(!cancelled)await delay(20);}
    check(cancelled,'active request cancellation');check((await pending).code==='cancelled','cancel terminal');check((await other).output.value==='OTHER_WORKSPACE_OK','other workspace unaffected');
    check((await invoke('list_sessions',{workspaceId:a.id})).length===0,'no Agent session created');
    saved={a,b,installationId:plugin.id,generationId:value.generationId};
    await report({ok:true,stage:0,saved,evidence:{realCapabilityProcess:true,explicitBinding:true,hostWorkspacePath:true,forgedCallerRejected:true,cancellation:true,workspaceIsolation:true,noAgentSession:true}});
  } else {
    const resumed=await invoke('invoke_capability',{request:request(saved.a,'restart')});check(resumed.output.value==='AIBO_CAPABILITY_OK','binding restored after actual App restart');check(resumed.generationId!==saved.generationId,'new process generation');
    await invoke('set_agent_plugin_enabled',{id:saved.installationId,enabled:false});
    const disabled=await invoke('invoke_capability',{request:request(saved.a,'disabled')}).catch(error=>error);check(disabled.code==='provider_unavailable','no silent fallback');
    await invoke('set_agent_plugin_enabled',{id:saved.installationId,enabled:true});
    check((await invoke('invoke_capability',{request:request(saved.a,'reenabled')})).output.value==='AIBO_CAPABILITY_OK','explicit release restored');
    await invoke('uninstall_agent_plugin',{id:saved.installationId});
    await report({ok:true,stage:1,saved,evidence:{actualAppRestart:true,persistedBinding:true,newGeneration:true,disabledBindingRejected:true,reenabledRelease:true,uninstall:true}});
  }
}catch(error){await report({ok:false,error:JSON.stringify(error,Object.getOwnPropertyNames(error??{}))});}
