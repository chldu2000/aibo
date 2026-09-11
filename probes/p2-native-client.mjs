import '/src/app.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mount, tick } from 'svelte';
import App from '/src/App.svelte';
import { writePersistedSelection } from '/src/lib/app/selection-storage.ts';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(find,label,timeout=90_000){const end=Date.now()+timeout;while(Date.now()<end){const found=await find();if(found)return found;await delay(80);}throw Error('timeout: '+label);}
const check=(condition,label)=>{if(!condition)throw Error(label);};
const events=[];await listen('agent-event',({payload})=>events.push(payload));
const call=(capability,sessionId,input={})=>invoke('invoke_agent_capability',{sessionId,capability,input});
const report=value=>fetch('/__p2_report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
let saved={}, evidence=[];
try {
  const config=await(await fetch('/__p2_config')).json();saved=config.saved;
  if(getCurrentWindow().label==='secondary') {
    try {
      const sessionId=saved.agents[0].id;
      writePersistedSelection(localStorage,{workspaceId:saved.workspaceId,sessionId},'secondary');
      await invoke('save_composer_draft',{sessionId,text:'SECONDARY_DRAFT',sendFailed:false});
      mount(App,{target:document.getElementById('app')});
      await until(()=>document.querySelector('[data-presentation-focus="composer"]')?.value==='SECONDARY_DRAFT','secondary scoped draft');
      await fetch('/__p2_secondary',{method:'POST',body:JSON.stringify({ok:true,window:'secondary',sessionId,draft:'passed'})});
    } catch(error) {await fetch('/__p2_secondary',{method:'POST',body:JSON.stringify({ok:false,error:String(error)})});}
  } else if(config.stage===0){
    const workspace=await invoke('add_workspace',{path:config.workspacePath});await invoke('set_workspace_trust',{workspaceId:workspace.id,trusted:true});
    const installed=await invoke('install_agent_plugin',{path:config.packagePath});await invoke('set_agent_plugin_enabled',{id:installed.id,enabled:true});
    const echo=await invoke('create_agent_session',{workspaceId:workspace.id,agentId:'dev.aibo.echo.agent',installationId:installed.id});
    saved={workspaceId:workspace.id,echoId:echo.id,agents:[]};
    localStorage.setItem('aibo.workbench-presentation.v1.main','standard');
    writePersistedSelection(localStorage,{workspaceId:workspace.id,sessionId:echo.id},'main');
    await invoke('save_composer_draft',{sessionId:echo.id,text:'P2_DRAFT_KEEP',sendFailed:false});
    mount(App,{target:document.getElementById('app')});
    await until(()=>document.querySelector('[data-presentation-focus="composer"]')?.value==='P2_DRAFT_KEEP','initial persisted draft');
    await until(()=>!document.querySelector('[data-presentation-focus="composer"]')?.disabled,'interactive composer');
    const commitInput=await until(()=>document.querySelector('input[aria-label="提交信息"]'),'commit draft control');
    commitInput.value='P2_COMMIT_DRAFT';commitInput.dispatchEvent(new Event('input',{bubbles:true}));await tick();
    const before=events.filter(event=>event.sessionId===echo.id&&event.type==='session.started').length;
    await invoke('send_agent_prompt',{sessionId:echo.id,input:'P2_STREAM '.repeat(65)});
    await until(()=>events.some(event=>event.sessionId===echo.id&&event.type==='message.delta'),'stream starts');
    const composer=document.querySelector('[data-presentation-focus="composer"]');composer.focus();await tick();
    const generation=document.querySelector('[data-presentation-generation]').dataset.presentationGeneration;
    document.querySelector('button[aria-label="切换工作台呈现"]').click();
    await until(()=>document.querySelector('[data-presentation-layout="focus"]:not([inert])'),'focus presentation');
    check(document.querySelector('[data-presentation-generation]').dataset.presentationGeneration!==generation,'renderer must remount');
    check(document.querySelector('[data-presentation-focus="composer"]').value==='P2_DRAFT_KEEP','draft survives switch');
    await until(()=>document.activeElement?.dataset.presentationFocus==='composer','semantic focus restored',5000);
    await until(()=>events.some(event=>event.sessionId===echo.id&&event.type==='turn.completed'),'stream completes across switch');
    check(events.filter(event=>event.sessionId===echo.id&&event.type==='session.started').length===before,'switch must not restart Agent');
    const timeline=await invoke('get_timeline',{sessionId:echo.id});check(timeline.some(item=>item.content?.includes('P2_STREAM')),'history kept');
    document.querySelector('button[aria-label="切换工作台呈现"]').click();await until(()=>document.querySelector('[data-presentation-layout="standard"]:not([inert])'),'standard presentation');
    check(document.querySelector('input[aria-label="提交信息"]')?.value==='P2_COMMIT_DRAFT','Git draft survives renderer switch');
    evidence.push({agent:'echo',streamAcrossSwitch:true,draft:true,gitDraft:true,focus:true,noAgentRestart:true,history:true});
    for(const agent of ['codex','pi']){
      const profile={schema:'aibo.execution-profile/v1',interactionMode:'edit',approvalPolicy:agent==='codex'?'untrusted':'on-request',filesystemPolicy:'workspace-write',commandPolicy:'approved',networkPolicy:'disabled',model:null,reasoningEffort:null};
      const session=await invoke('create_agent_session',{workspaceId:workspace.id,agentId:`dev.aibo.${agent}.agent`,requestedProfile:profile});
      check(Boolean(session.pluginInstallationId),'default create binds plugin');saved.agents.push({agent,id:session.id});
      const stored=await invoke('get_session_execution_profile',{sessionId:session.id});check(stored.requested.filesystemPolicy==='workspace-write','creation profile retained');
      const catalog=await invoke('get_session_models',{sessionId:session.id});const model=catalog.current??catalog.models.find(model=>model.isDefault)??catalog.models[0];check(Boolean(model),'model catalog');
      await call('model.select',session.id,model.provider?{action:'set',provider:model.provider,modelId:model.id}:{action:'set',reference:model.reference});
      const level=model.reasoningEfforts.find(option=>option.id==='low')??model.reasoningEfforts.find(option=>option.id!=='off');
      if(level)await call('model.reasoning',session.id,{action:'set',level:level.id});
      const selected=await invoke('get_session_models',{sessionId:session.id});if(level)check(selected.currentReasoningEffort===level.id,'reasoning confirmed');saved.agents.at(-1).model=model.reference;saved.agents.at(-1).level=level?.id??null;
      const marker=`AIBO_P2_${agent.toUpperCase()}_OK`;
      const offset=events.length;await invoke('send_agent_prompt',{sessionId:session.id,input:`Reply with exactly ${marker}. Do not use tools.`});
      await until(()=>events.slice(offset).find(event=>event.sessionId===session.id&&['turn.completed','turn.failed'].includes(event.type)),agent+' smoke',120_000);
      const terminal=events.slice(offset).find(event=>event.sessionId===session.id&&['turn.completed','turn.failed'].includes(event.type));check(terminal.type==='turn.completed',agent+' failed: '+(terminal.payload.message??''));
      check((await invoke('get_timeline',{sessionId:session.id})).some(item=>item.content?.includes(marker)),agent+' exact marker');
      if(agent==='pi'){
        const tree=await call('session.tree',session.id,{action:'get'});check(Array.isArray(tree.tree),'Pi tree');
        if(tree.leafId)await call('session.tree',session.id,{action:'navigate',entryId:tree.leafId,summarize:false,customInstructions:null});
        await call('queue.manage',session.id,{action:'steer',message:'P2 queue check'});await call('queue.manage',session.id,{action:'followUp',message:'P2 follow-up check'});await call('queue.manage',session.id,{action:'clear'});
      }
      const approvalOffset=events.length;
      await invoke('send_agent_prompt',{sessionId:session.id,input:agent==='pi'?'Use the write tool to create p2-approval.txt containing P2_APPROVAL_OK. Then reply P2_APPROVAL_DONE.':'Run the read-only shell command pwd exactly once, then reply P2_APPROVAL_DONE. Do not modify files.'});
      const approval=await until(()=>{const active=events.slice(approvalOffset).filter(event=>event.sessionId===session.id);const request=active.find(event=>event.type==='approval.requested');if(!request&&active.some(event=>['turn.completed','turn.failed'].includes(event.type)))throw Error(agent+' turn ended without requested approval');return request;},agent+' approval',120_000);
      await invoke('resolve_agent_approval',{sessionId:session.id,requestId:approval.payload.requestId,decision:'accept'});
      await until(()=>events.slice(approvalOffset).some(event=>event.sessionId===session.id&&event.type==='turn.completed'),agent+' approved completion',120_000);
      const cancelOffset=events.length;await invoke('send_agent_prompt',{sessionId:session.id,input:'Write 1000 numbered lines of P2_CANCEL. Do not use tools.'});
      await invoke('cancel_agent_turn',{sessionId:session.id});
      await until(()=>events.slice(cancelOffset).some(event=>event.sessionId===session.id&&['turn.completed','turn.failed'].includes(event.type)),agent+' cancel');
      evidence.push({agent,pluginBinding:true,profile:true,models:true,reasoning:level?.id??'not supported',stream:true,approval:true,cancel:true,treeQueue:agent==='pi'?'passed':'not declared'});
    }
    await invoke('save_composer_draft',{sessionId:echo.id,text:'P2_DRAFT_KEEP',sendFailed:false});
    writePersistedSelection(localStorage,{workspaceId:workspace.id,sessionId:echo.id},'main');
  }else{
    mount(App,{target:document.getElementById('app')});
    await until(()=>document.querySelector('[data-presentation-focus="composer"]')?.value==='P2_DRAFT_KEEP','draft after native process restart');
    await until(()=>document.querySelector('input[aria-label="提交信息"]')?.value==='P2_COMMIT_DRAFT','Git draft after native restart');
    check((await invoke('get_timeline',{sessionId:saved.echoId})).some(item=>item.content?.includes('P2_STREAM')),'history after app restart');
    for(const item of saved.agents){
      await invoke('resume_agent_session',{sessionId:item.id});const catalog=await invoke('get_session_models',{sessionId:item.id});
      check(catalog.current?.reference===item.model,item.agent+' model survives restart');if(item.level)check(catalog.currentReasoningEffort===item.level,item.agent+' reasoning survives restart');
      const history=await invoke('get_timeline',{sessionId:item.id});check(history.length>0,'history restored');
      await invoke('archive_session',{sessionId:item.id});await invoke('unarchive_session',{sessionId:item.id});await invoke('resume_agent_session',{sessionId:item.id});
      check((await invoke('get_timeline',{sessionId:item.id})).length===history.length,'archive preserves history');
      evidence.push({agent:item.agent,realProcessRestart:true,configuration:true,archiveUnarchive:true,history:true});
    }
    const second=await until(async()=>{const latest=await(await fetch('/__p2_config')).json();return latest.secondary;},'secondary window');
    check(second.ok,second.error??'secondary window failed');
    check(document.querySelector('[data-presentation-focus="composer"]')?.value==='P2_DRAFT_KEEP','secondary selection cannot replace main draft');
    evidence.push({draftAfterNativeRestart:true,selectionAfterNativeRestart:true,historyAfterNativeRestart:true,windowIsolation:true});
  }
  if(getCurrentWindow().label==='main')await report({ok:true,stage:config.stage,saved,evidence});
}catch(error){await report({ok:false,error:String(error),saved,evidence,focus:{wanted:document.querySelector('[data-presentation-focus-target]')?.dataset.presentationFocusTarget,active:document.activeElement?.outerHTML?.slice(0,300),disabled:document.querySelector('[data-presentation-focus]')?.disabled},ui:document.body.innerText.slice(0,500)});}
