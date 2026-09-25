// Deterministic native IPC data for real App visual/interaction probes.
export const installDensityFixture=()=>{
    localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'ak-ui',themeId:'light'}));
    const workspace={id:'w1',label:'aibo-dev-with-a-long-workspace-name',path:'/probe/aibo',trust:'trusted',createdAt:'2026-09-22',updatedAt:'2026-09-22'};
    const session={id:'s1',workspaceId:'w1',label:'检查侧栏的信息密度和悬浮操作',agent:'agent-2',pluginInstallationId:'provider-2',state:'idle',capabilities:[],archived:false,externalSessionId:'a-long-external-session-identifier-for-overflow-check',createdAt:'2026-09-22',updatedAt:'2026-09-22T15:30:00.123Z'};
    const changes={workspaceId:'w1',head:'0c78fe5abcdef',branch:'main',dirty:true,capturedAt:'now',captureStatus:'captured',captureError:null,files:Array.from({length:8},(_,i)=>({path:`src/component-${i}.svelte`,previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false,unstagedStats:i===0?{additions:12,deletions:3}:null}))};
    window.densityCalls=[];window.failHistoryPageOnce=false;let callback=0;
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},async invoke(command,args={}){
      window.densityCalls.push({command,args});
      if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:1,diagnostics:[]};
      if(command.startsWith('plugin:event|'))return 1;
      if(command==='list_workspaces')return [workspace];
      if(command==='list_sessions')return [session];
      if(command==='get_presentation_selection'||command==='get_composer_draft'||command==='get_session_execution_profile'||command==='get_turn_change_set')return null;
      if(command==='save_composer_draft')return {text:args.text,sendFailed:false,updatedAt:'now'};
      if(command==='rename_session'){session.label=args.label;return {...session};}
      if(command==='list_plugin_installations')return ['Codex','Pi','Third-party'].map((label,i)=>({id:'provider-'+i,pluginId:'dev.example.'+i,pluginVersion:'1.0.0',packageDigest:'fixture-'+i,installed:true,enabled:true,runnable:true,dependencies:[],activationIssues:[],manifest:{displayName:label},contributions:[{id:'agent-'+i,kind:'capabilityProvider',scope:'session',required:true,metadata:{displayName:label,icon:{path:'M2 2L22 22Z'},operations:[{capability:{id:'aibo.session.open'}}]}}]}));
      if(command==='inspect_workspace_capabilities')return {workspaceId:'w1',inspectedAt:'now',instructions:[],skills:[],mcpServers:[],warnings:[],tools:['workspace-read','workspace-search','artifact-store','checkpoint-restore','project-actions'].map(name=>({name,source:'core'}))};
      if(command==='list_workspace_git_repositories')return {repositories:[{id:'repo',name:'aibo',relativePath:'.',kind:'repository',externalRoot:false},{id:'nested',name:'tools',relativePath:'tools',kind:'repository',externalRoot:false}],limited:false,warnings:[],scanBudget:2000};
      if(command==='get_workspace_changes')return changes;
      if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:'origin/main',ahead:1,behind:0};
      if(command==='list_workspace_git_history'){
        if((args.offset??0)>0&&window.failHistoryPageOnce){window.failHistoryPageOnce=false;throw Error('历史分页暂时失败');}
        const entries=[{hash:'commit-a',shortHash:'abc1234',subject:'调整文件列表对齐',author:'Tester',authoredAt:new Date(Date.now()-2*60*60*1000).toISOString()},...Array.from({length:19},(_,index)=>({hash:`older-${index}`,shortHash:`older-${index}`,subject:index===0?'fix(composer): @ 引用的文件不再重复显示附件卡片；图标与路径保持一致':`较早的提交 ${index+1}`,author:'Tester',authoredAt:'2026-09-21T15:30:00Z'}))];
        return entries.slice(args.offset??0,(args.offset??0)+(args.limit??30));
      }
      if(command==='list_workspace_git_commit_files')return {commit:args.commit,files:[{path:'src/components/AlignedButton.svelte',previousPath:null,kind:'modified'},{path:'probes/conversation-design-browser.mjs',previousPath:null,kind:'added'},{path:'src/components/一个很长的文件名称-long-renamed-component.svelte',previousPath:'legacy/old-component.svelte',kind:'renamed'}],total:4};
      if(command==='get_workspace_git_commit_file_diff')return {path:args.path,staged:false,available:true,truncated:false,diff:'diff --git a/file b/file\n@@ -1 +1 @@\n-old\n+history-preview',hunks:[],reason:null};
      if(command==='get_timeline')return [{id:'a',sessionId:'s1',turnId:'t',role:'assistant',entryType:'message',content:'侧栏保留清晰的信息层级，操作在需要时出现。',status:'completed',createdAt:'2026-09-22'}];
      return [];
    }};
  };
