import { invoke } from '@tauri-apps/api/core';
const check = (value, message) => { if (!value) throw Error(message); };
const report = data => fetch('/__dialog_report', { method: 'POST', body: JSON.stringify(data) });
try {
  const { workspacePath } = await (await fetch('/__dialog_config')).json();
  const defaults = await invoke('read_host_confirmation_preferences');
  check(Object.keys(defaults).length === 5 && Object.values(defaults).every(value => value === 'always-allow'), 'five native defaults');
  const workspace = await invoke('add_workspace', { path: workspacePath });
  const stage = await invoke('apply_workspace_git_file_action', { workspaceId: workspace.id, path: 'native.txt', action: 'stage', requestId: 'auto-stage' });
  check(stage.applied, 'default stage must execute without dialog');
  const commit = await invoke('commit_workspace_changes', { workspaceId: workspace.id, message: 'test: host confirmation default', requestId: 'auto-commit' });
  check(commit.committed, 'default commit must execute without dialog');
  const task = await invoke('save_project_action', { workspaceId: workspace.id, name: 'Confirmation probe', kind: 'custom', program: '/usr/bin/true', args: [] });
  const run = await invoke('run_project_action', { workspaceId: workspace.id, actionId: task.id, requestId: 'auto-task' });
  check(run.status === 'completed' && run.exitCode === 0, 'default project action must execute without dialog');
  await invoke('save_host_confirmation_preference', { category: 'git', policy: 'ask' });
  for (const locale of ['zh-CN','en']) {
    check(await invoke('set_window_locale',{locale})===locale,'native language acknowledged');
    for (const accepted of [false,true]) {
      const marker='HOST_'+locale.replace('-','_')+'_'+(accepted?'ACCEPT':'CANCEL');
      const decision=locale==='en'?(accepted?'Allow this execution':'Cancel'):(accepted?'允许本次执行':'取消');
      await fetch('/__dialog_ready', { method: 'POST', body: JSON.stringify({ marker, decision, title:locale==='en'?'Confirm Git write':'确认 Git 写入',bodyMarker:locale==='en'?'Workspace:':'工作区：' }) });
      let error,result;
      try { result=await invoke('create_workspace_git_branch',{workspaceId:workspace.id,branch:marker,requestId:marker}); }catch(caught){error=JSON.stringify(caught)}
      const branches=await invoke('list_workspace_git_branches',{workspaceId:workspace.id});
      if(!accepted){check(error?.includes('approval_rejected'),'cancel must reject');check(!branches.some(branch=>branch.name===marker),'cancel must not create a branch');}
      else check(!error&&result.applied&&branches.some(branch=>branch.name===marker),'accept must create a branch');
    }
  }
  await invoke('save_host_confirmation_preference',{category:'projectAction',policy:'ask'});
  for(const locale of ['en','zh-CN']){
    await invoke('set_window_locale',{locale});
    const marker='PROJECT_'+locale.replace('-','_');
    const action=await invoke('save_project_action',{workspaceId:workspace.id,name:marker+' 原始任务名',kind:'custom',program:'/usr/bin/true',args:[]});
    await fetch('/__dialog_ready',{method:'POST',body:JSON.stringify({marker,decision:locale==='en'?'Cancel':'取消',title:locale==='en'?'Confirm project action':'确认工程动作',bodyMarker:locale==='en'?'Working directory:':'工作目录：'})});
    const rejected=await invoke('run_project_action',{workspaceId:workspace.id,actionId:action.id,requestId:marker});
    check(rejected.status==='rejected'&&rejected.exitCode===null&&rejected.output.includes('approval denied'),'localized project dialog cancellation blocks execution');
  }
  await invoke('save_host_confirmation_preference',{category:'projectAction',policy:'always-allow'});
  const persisted = await invoke('read_host_confirmation_preferences');
  check(persisted.git === 'ask' && persisted.projectAction === 'always-allow', 'category policies remain independent');
  await invoke('save_host_confirmation_preference', { category: 'git', policy: 'always-allow' });
  await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: false });
  let trustError;
  try { await invoke('create_workspace_git_branch', { workspaceId: workspace.id, branch: 'must-not-exist', requestId: 'untrusted' }); }
  catch (error) { trustError = JSON.stringify(error); }
  check(trustError?.includes('workspace_trust_required'), 'always allow must preserve trust gate');
  await report({ ok: true, defaultStage: true, defaultCommit: true, defaultTask: true, nativeCancel: true, nativeAccept: true, dialogLanguages:['zh-CN','en'], projectCancelBothLanguages:true, independentSettings: true, trustGate: true });
} catch (error) { await report({ ok: false, error: String(error) }); }
