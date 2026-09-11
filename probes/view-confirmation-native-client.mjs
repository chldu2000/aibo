import { invoke } from '@tauri-apps/api/core';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) { const end = Date.now() + 30000; while (Date.now() < end) { const result = await read(); if (result) return result; await pause(50); } throw Error(label); }
const report = data => fetch('/__dialog_report', {method:'POST',body:JSON.stringify(data)});
try {
  const config = await (await fetch('/__dialog_config')).json();
  const workspace = await invoke('add_workspace', {path:config.workspacePath});
  await invoke('set_workspace_trust', {workspaceId:workspace.id,trusted:true});
  const plugin = await invoke('install_agent_plugin', {path:config.packagePath});
  await invoke('set_agent_plugin_enabled', {id:plugin.id,enabled:true});
  const session = await invoke('create_agent_session', {workspaceId:workspace.id,agentId:'dev.aibo.echo.agent'});
  const snapshot = await until(async () => (await invoke('get_plugin_view_snapshots',{sessionId:session.id}))[0], 'initial view');
  for (const [marker, decision] of [['DIALOG_CANCEL_PROBE','取消'],['DIALOG_ACCEPT_PROBE','允许本次操作']]) {
    await fetch('/__dialog_ready', {method:'POST',body:JSON.stringify({marker,decision})});
    await fetch('/__dialog_progress', {method:'POST',body:JSON.stringify({phase:'invoking',marker,policy:snapshot.document.actions.find(action=>action.id==='refresh').confirmation})});
    let error = null, result;
    try { result = await invoke('invoke_plugin_view_action', {sessionId:session.id,viewId:snapshot.document.viewId,actionId:'refresh',input:{label:marker},version:snapshot.version}); }
    catch (caught) { error = String(caught); }
    await fetch('/__dialog_progress', {method:'POST',body:JSON.stringify({phase:'returned',marker,error,result})});
    if (decision === '取消') {
      if (!error?.includes('confirmation_cancelled')) throw Error('native cancel must reject');
      await pause(200);
      const after = (await invoke('get_plugin_view_snapshots',{sessionId:session.id}))[0];
      if (after.version.revision !== snapshot.version.revision) throw Error('cancel unexpectedly executed operation');
    } else {
      if (error || result?.cursor !== 0) throw Error('native accept failed: '+error);
      await until(async () => (await invoke('get_plugin_view_snapshots',{sessionId:session.id}))[0].version.revision > snapshot.version.revision, 'approved operation publishes view');
    }
  }
  await report({ok:true,nativeCancel:true,cancelDidNotExecute:true,nativeAccept:true,acceptedOperationExecuted:true});
} catch(error) { await report({ok:false,error:String(error)}); }
