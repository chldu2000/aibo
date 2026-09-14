import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){const g=input.data.git;return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:'External Git'},{tag:'pre',key:'snapshot',attrs:{'aria-label':'Git snapshot'},text:JSON.stringify(g)},...input.data.navigationActions.filter(a=>a.operation==='selectWorkspace'||a.operation==='selectSession').map(a=>({tag:'button',key:a.token,text:a.operation+':'+a.targetId,events:{click:a.token}})),...input.data.gitActions.map(a=>a.event==='input'?{tag:'input',key:a.operation,attrs:{'aria-label':a.operation,value:g.draft[a.operation]},events:{input:a.token}}:{tag:'button',key:a.token,text:a.operation+(a.args.length?':'+a.args.join(':'):''),events:{click:a.token}}),{tag:'button',key:'forged',text:'Forged Git action',events:{click:'git:forged'}}]}}};";
const bytes=Buffer.from(source);
const pkg={release:{digest:'a'.repeat(64),enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.workbench',version:'1.0.0',displayName:'External skin',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'text/javascript'}]}},resources:{'skin.js':bytes.toString('base64')}};
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
try {
  await page.addInitScript(pkg=>{
    let callback=0;window.presentationCommands=[];window.presentationInstallable=pkg;
    const workspaces = ['w1','w2'].map(id=>({id,label:id,path:'/probe/'+id,trust:'trusted',createdAt:'2026-09-13',updatedAt:'2026-09-13',lastOpenedAt:null}));
    const sessions = ['s1','s2'].map((id,index)=>({id,workspaceId:'w'+(index+1),label:id,agent:'plugin',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:null,capabilities:[],createdAt:'2026-09-13',updatedAt:'2026-09-13'}));
    window.navigationCalls=[];
    const changed={path:'src/file.ts',previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false};
    let commitAttempts=0;

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:'head',branch:'main',dirty:true,capturedAt:'now',files:[changed],captureStatus:'captured',captureError:null};
        if(command==='list_workspace_git_branches')return [{name:'main',current:true,commit:'head'},{name:'topic',current:false,commit:'old'}];
        if(command==='list_workspace_git_history')return [{hash:'commit-a',shortHash:'commit-a',subject:'Earlier change',author:'Author',authoredAt:'2026-09-13'}];
        if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:'origin/main',ahead:1,behind:1};
        if(command==='list_workspace_git_stashes')return [{reference:'stash@{0}',message:'Saved changes'}];
        if(command==='get_workspace_file_diff'||command==='get_workspace_git_commit_file_diff')return {path:args.path,staged:args.staged??false,available:true,truncated:true,diff:'@@ -1 +1 @@\n-before\n+after',hunks:[{index:0,header:'@@ -1 +1 @@',content:'-before\n+after'}],reason:'preview limit'};
        if(command==='list_workspace_git_commit_files')return {commit:args.commit,files:args.offset?[{path:'second.ts',previousPath:null,kind:'added'}]:[{path:'historical.ts',previousPath:'old.ts',kind:'renamed'}],total:2};
        if(command==='apply_workspace_git_file_action'){changed.staged=args.action==='stage';changed.unstaged=!changed.staged;return {applied:true,message:'ok',path:args.path,action:args.action};}
        if(command==='commit_workspace_changes')return ++commitAttempts===1?{committed:false,hash:null,message:'probe commit rejected'}:{committed:true,hash:'new-commit',message:'ok'};
        if(command==='create_workspace_git_branch'||command==='checkout_workspace_git_branch'||command==='sync_workspace_git'||command==='stash_workspace_git'||command==='apply_workspace_git_stash')return {applied:true,message:'ok',action:args.action??'branch'};
        if(command==='get_composer_draft')return null;
        if(command==='save_composer_draft')return {text:args.text,sendFailed:args.sendFailed,updatedAt:'2026-09-13'};
        if(command==='get_session_execution_profile'){
          const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'on-request',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',model:null,reasoningEffort:null};
          return {schema:profile.schema,sessionId:args.sessionId,requested:profile,enforced:profile,unsupported:[],adapterCapabilities:[],nativeSandbox:true,resolvedAt:'2026-09-13'};
        }
        if(command==='list_workspaces')return workspaces;
        if(command==='list_sessions')return sessions.filter(session=>session.workspaceId===args.workspaceId);
        if(command==='rename_session'){const session=sessions.find(session=>session.id===args.sessionId);session.label=args.label;return {...session};}
        if(command==='archive_session'){const session=sessions.find(session=>session.id===args.sessionId);session.archived=true;return {...session};}
        if(command==='unarchive_session'){const session=sessions.find(session=>session.id===args.sessionId);session.archived=false;return {...session};}

        if(command==='plugin:dialog|open')return '/probe/package';
        if(command==='install_presentation_package'){localStorage.setItem('probe.presentation.installed',JSON.stringify(window.presentationInstallable));return window.presentationInstallable.release;}
        if(command==='list_presentation_packages')return read()?[read().release]:[];
        if(command==='get_presentation_selection')return saved();
        if(command==='read_presentation_package'){const value=read();if(!value?.release.enabled)throw Error('unavailable');return value;}
        if(command==='select_presentation_package'){
          if((saved()?.digest??null)!==args.expectedDigest)throw Error('superseded');
          localStorage.setItem('probe.presentation.selection',JSON.stringify(args.digest?{digest:args.digest,themeId:args.themeId}:null));return;
        }
        if(command==='set_presentation_package_enabled'){const value=read();value.release.enabled=args.enabled;localStorage.setItem('probe.presentation.installed',JSON.stringify(value));if(!args.enabled)localStorage.removeItem('probe.presentation.selection');return;}
        if(command==='uninstall_presentation_package'){localStorage.removeItem('probe.presentation.installed');localStorage.removeItem('probe.presentation.selection');return;}
        if(command.startsWith('plugin:event|'))return 1;
        if(command==='get_app_snapshot')return {platform:'macos',appVersion:'probe',workspaceCount:0,diagnostics:[]};
        return [];
      }};
  },pkg);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')!==null);
  await page.getByRole('button',{name:'完成',exact:true}).click();
  const frame=page.frameLocator('iframe');
  const snapshot=()=>frame.getByLabel('Git snapshot').textContent().then(JSON.parse);
  await frame.getByRole('heading',{name:'External Git'}).waitFor();
  await frame.getByRole('button',{name:'selectView:git',exact:true}).click();
  await frame.getByRole('textbox',{name:'commitMessage',exact:true}).waitFor();
  assert.equal((await snapshot()).remoteStatus.upstream,'origin/main');
  await frame.getByRole('button',{name:'openDiff:src/file.ts:unstaged',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.presentationRevision);
  await frame.getByRole('button',{name:'closeDiff',exact:true}).waitFor();
  await page.waitForTimeout(100);
  assert.equal((await snapshot()).preview.fileDiff.truncated,true);
  assert.equal((await snapshot()).preview.fileDiff.hunks[0].content,'-before\n+after');
  await frame.getByRole('button',{name:'closeDiff',exact:true}).click();
  await frame.getByRole('button',{name:'stageFile:src/file.ts',exact:true}).click();
  await frame.getByRole('button',{name:'unstageFile:src/file.ts',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.navigationCalls.find(c=>c.command==='apply_workspace_git_file_action').args.path),'src/file.ts');
  await frame.getByRole('button',{name:'Forged Git action',exact:true}).click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.navigationCalls.filter(c=>c.command==='apply_workspace_git_file_action').length),1);
  const message=frame.getByRole('textbox',{name:'commitMessage',exact:true});
  await message.pressSequentially('message across skins',{delay:10});
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('button',{name:'恢复内置呈现',exact:true}).click();
  await page.getByRole('button',{name:'完成',exact:true}).click();
  const native=page.getByRole('textbox',{name:'提交信息',exact:true});
  assert.equal(await native.inputValue(),'message across skins');await native.fill('edited in default');
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'完成',exact:true}).click();
  assert.equal(await message.inputValue(),'edited in default');
  await frame.getByRole('button',{name:'commit:edited in default',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'probe commit rejected'}).waitFor();
  assert.equal(await message.inputValue(),'edited in default');
  await frame.getByRole('button',{name:'commit:edited in default',exact:true}).click();
  await page.waitForTimeout(200);assert.equal(await message.inputValue(),'');
  const branch=frame.getByRole('textbox',{name:'branchDraft',exact:true});await branch.fill('feature/skin');
  await frame.getByRole('button',{name:'createBranch:feature/skin',exact:true}).click();
  await page.waitForTimeout(150);assert.equal(await branch.inputValue(),'');
  await frame.getByRole('button',{name:'selectSection:history',exact:true}).click();
  await frame.getByRole('button',{name:'selectCommit:commit-a',exact:true}).click();
  await frame.getByRole('button',{name:'openCommitDiff:commit-a:historical.ts',exact:true}).click();
  await page.waitForTimeout(100);assert.equal((await snapshot()).preview.contextLabel,'提交 commit-a');
  await frame.getByRole('button',{name:'loadMoreCommitFiles:commit-a',exact:true}).click();
  await frame.getByRole('button',{name:'openCommitDiff:commit-a:second.ts',exact:true}).waitFor();
  await frame.getByRole('button',{name:'fetch',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='sync_workspace_git'&&c.args.action==='fetch'));
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App.svelte and Worker, no repository operations performed',browser:browser.version(),checks:['complete Git metadata and truncated hunk preview','stage targets host-selected file','forged action rejected','commit draft survives external/default/external switch','rejected commit keeps draft and successful commit clears it','branch draft and creation','history file paging and commit preview','fetch dispatch through existing host controller']};
  await writeFile('/tmp/aibo-presentation-git-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

} catch(error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error; } finally {await browser.close();await server.close();}
