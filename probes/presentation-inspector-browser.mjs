import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){const i=input.data.inspector;return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:'External Inspector'},{tag:'pre',key:'navigation',attrs:{'aria-label':'Navigation state'},text:JSON.stringify(input.data.navigation)},{tag:'pre',key:'snapshot',attrs:{'aria-label':'Inspector snapshot'},text:JSON.stringify(i)},...input.data.navigationActions.filter(a=>a.operation==='selectWorkspace'||a.operation==='selectSession').map(a=>({tag:'button',key:a.token,text:a.operation+':'+a.targetId,events:{click:a.token}})),...input.data.inspectorActions.map(a=>({tag:'button',key:a.token,text:a.operation+(a.args.length?':'+a.args.join(':'):''),events:{click:a.token}}))]}}};";
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
    const artifact={schema:'aibo.artifact/v1',id:'artifact',workspaceId:'w1',sessionId:'s1',turnId:'turn',source:'test',mediaType:'text/plain',size:100,contentHash:'hash',storagePath:'internal',createdAt:'2026-09-13'};
    const file={path:'file.ts',previousPath:null,kind:'modified',baselineExists:true,baselineHash:'before',baselineSize:1,baselineDirty:false,resultExists:true,resultHash:'after',resultSize:2};
    const changes=sessionId=>({id:'change:'+sessionId,schema:'aibo.turn-changeset/v1',workspaceId:sessionId==='s1'?'w1':'w2',sessionId,turnId:'turn',baseline:{head:'before',dirty:false,capturedAt:'now'},result:{head:'after',dirty:true,capturedAt:'now'},files:[file],commands:[{id:'command',toolName:'shell',command:'test',cwd:'.',exitCode:0,status:'completed',output:'command output'}],verification:[{id:'verify',status:'passed',output:'verification output'}],attribution:'agent',captureStatus:'captured',captureError:null});
    window.inspectorDelayDiff=true;

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='inspect_workspace_capabilities')return {workspaceId:args.workspaceId,inspectedAt:'now',instructions:[],skills:[],tools:[],mcpServers:[],warnings:[]};
        if(command==='get_turn_change_set')return changes(args.sessionId);
        if(command==='list_turn_artifacts')return args.sessionId==='s1'?[artifact]:[];
        if(command==='read_artifact')return new Promise(resolve=>{window.resolveArtifact=()=>resolve({artifact,content:'Host retained artifact preview',truncated:true});});
        if(command==='get_turn_file_diff'){
          const diff={path:args.path,available:true,diff:'-before +after',hunks:[{index:0,header:'@@ -1 +1 @@',content:'-before +after'}],reason:null};
          if(window.inspectorDelayDiff)return new Promise(resolve=>{window.resolveDiff=()=>resolve(diff);});
          return diff;
        }
        if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:'head',branch:'main',dirty:true,capturedAt:'now',files:[],captureStatus:'captured',captureError:null};
        if(command==='apply_git_hunk_action')return {applied:true,message:'ok',path:args.path,hunkIndex:args.hunkIndex,action:args.action};
        if(command==='restore_turn_change_set')return {applied:false,restored:[],conflicts:['file.ts'],unsupported:[]};
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
  await page.getByRole('button',{name:'关闭管理中心',exact:true}).click();
  const frame=page.frameLocator('iframe');
  const snapshot=()=>frame.getByLabel('Inspector snapshot').textContent().then(JSON.parse);
  await frame.getByRole('heading',{name:'External Inspector'}).waitFor();
  if(!await frame.getByRole('button',{name:'selectSession:s1',exact:true}).count())await frame.getByRole('button',{name:'selectWorkspace:w1',exact:true}).click();
  await frame.getByRole('button',{name:'selectSession:s1',exact:true}).click();
  await frame.getByRole('button',{name:'selectView:context',exact:true}).click();
  await frame.getByRole('button',{name:'toggleArtifact:artifact',exact:true}).click();
  await page.waitForFunction(()=>typeof window.resolveArtifact==='function');
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('button',{name:'恢复内置呈现',exact:true}).click();
  await page.getByRole('button',{name:'关闭管理中心',exact:true}).click();
  await page.evaluate(()=>window.resolveArtifact());
  await page.getByText(/Host retained artifact preview/).waitFor();
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'关闭管理中心',exact:true}).click();
  assert.equal((await snapshot()).artifactPreview.content.truncated,true);
  assert.equal((await snapshot()).changeSet.commands[0].output,'command output');
  assert.equal((await snapshot()).changeSet.verification[0].output,'verification output');
  await frame.getByRole('button',{name:'showDiff:turn:file.ts',exact:true}).click();
  await page.waitForFunction(()=>typeof window.resolveDiff==='function');
  await frame.getByRole('button',{name:'selectWorkspace:w2',exact:true}).click();
  await page.frames().find(candidate=>candidate!==page.mainFrame()).waitForFunction(()=>{const node=document.querySelector('[aria-label="Navigation state"]');return node&&JSON.parse(node.textContent).sessionsLoadingWorkspaceIds.length===0;});
  await frame.getByRole('button',{name:'selectSession:s2',exact:true}).click();
  await page.frames().find(candidate=>candidate!==page.mainFrame()).waitForFunction(()=>JSON.parse(document.querySelector('[aria-label="Inspector snapshot"]').textContent).session?.id==='s2');
  await page.evaluate(()=>{window.resolveDiff();window.inspectorDelayDiff=false;});
  await page.waitForTimeout(150);
  assert.equal((await snapshot()).session.id,'s2');
  assert.equal((await snapshot()).fileDiff,null);
  assert.equal((await snapshot()).artifactPreview.artifactId,null);
  await frame.getByRole('button',{name:'selectSession:s1',exact:true}).click();
  await frame.getByRole('button',{name:'showDiff:turn:file.ts',exact:true}).click();
  await frame.getByRole('button',{name:'hunkAction:turn:file.ts:0:stage',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='apply_git_hunk_action'));
  const write=await page.evaluate(()=>window.navigationCalls.find(c=>c.command==='apply_git_hunk_action').args);
  assert.equal(write.sessionId,'s1');assert.equal(write.turnId,'turn');assert.equal(write.path,'file.ts');assert.equal(write.hunkIndex,0);assert.equal(write.action,'stage');
  await frame.getByRole('button',{name:'restoreTurn:turn',exact:true}).click();
  await page.getByRole('status').filter({hasText:'恢复已阻止'}).waitFor();
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App.svelte and default Inspector; no repository writes',browser:browser.version(),checks:['full command and verification data','pending artifact read survives external/default switch','default/external retains truncated artifact content','session switch clears artifact and rejects late diff','host binds exact hunk target','blocked restore reported by host']};
  await writeFile('/tmp/aibo-presentation-inspector-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

} catch(error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText(),calls:await page.evaluate(()=>window.navigationCalls.slice(-15))})); throw error; } finally {await browser.close();await server.close();}
