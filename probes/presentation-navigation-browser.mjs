import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){const n=input.data.navigation;return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:'External navigation'},{tag:'pre',key:'snapshot',attrs:{'aria-label':'Navigation snapshot'},text:JSON.stringify(n)},{tag:'input',key:'search',attrs:{'aria-label':'External search',value:n.sessionSearch},events:{input:'navigation:search:'}},...(n.renamingSessionId?[{tag:'input',key:'rename',attrs:{'aria-label':'External rename',value:n.sessionLabelDraft},events:{input:'navigation:renameDraft:'+n.renamingSessionId}}]:[]),...input.data.navigationActions.filter(a=>a.event==='click').map(a=>({tag:'button',key:a.token,text:a.operation+(a.targetId?':'+a.targetId:''),events:{click:a.token}})),{tag:'button',key:'forged',text:'Forged archive',events:{click:'navigation:archiveSession:unknown'}}]}}};";
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
    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
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
  await page.locator('[data-host-navigation="management"]').click();
  await page.getByRole('tab',{name:'插件与能力',exact:true}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('tab',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')!==null);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  const frame=page.frameLocator('iframe');
  const snapshot=()=>frame.getByLabel('Navigation snapshot').textContent().then(JSON.parse);
  await frame.getByRole('heading',{name:'External navigation'}).waitFor();
  await frame.getByRole('button',{name:'selectWorkspace:w1',exact:true}).click();
  await frame.getByRole('button',{name:'renameSession:s1',exact:true}).waitFor();
  await frame.getByRole('button',{name:'selectWorkspace:w2',exact:true}).click();
  await frame.getByRole('button',{name:'renameSession:s2',exact:true}).waitFor();
  assert.deepEqual(Object.keys((await snapshot()).sessionsByWorkspace).sort(),['w1','w2']);
  const search=frame.getByRole('textbox',{name:'External search'});
  await search.pressSequentially('search across streaming updates',{delay:10});
  await page.waitForTimeout(200);
  assert.equal(await search.inputValue(),'search across streaming updates');
  assert.equal((await snapshot()).sessionSearch,'search across streaming updates');
  await frame.getByRole('button',{name:'renameSession:s2',exact:true}).click();
  const rename=frame.getByRole('textbox',{name:'External rename'});
  await rename.fill('Renamed');await rename.pressSequentially(' through plugin',{delay:10});
  await page.waitForTimeout(200);assert.equal(await rename.inputValue(),'Renamed through plugin');
  await frame.getByRole('button',{name:'saveRename:s2',exact:true}).click();
  await page.getByRole('status').filter({hasText:'会话名称已更新'}).waitFor();
  assert.equal((await snapshot()).sessionsByWorkspace.w2[0].label,'Renamed through plugin');
  await frame.getByRole('button',{name:'Forged archive',exact:true}).click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.navigationCalls.filter(c=>c.command==='archive_session').length),0);
  await frame.getByRole('button',{name:'archiveSession:s2',exact:true}).click();
  await page.getByRole('alertdialog').waitFor();
  assert(await page.locator('.presentation-external').evaluate(e=>e.inert),'native host dialog suspends the external surface');
  assert(await page.getByRole('alertdialog').evaluate(e=>e.contains(document.activeElement)),'focus stays in the trusted dialog');
  await frame.getByRole('button',{name:'archiveSession:s2',exact:true}).evaluate(e=>e.click());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.navigationCalls.filter(c=>c.command==='archive_session').length),0,'suspended renderer cannot bypass archive confirmation');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await frame.getByRole('button',{name:'archiveSession:s2',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'归档',exact:true}).click();
  await frame.getByRole('button',{name:'unarchiveSession:s2',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.navigationCalls.filter(c=>c.command==='archive_session').length),1);
  await frame.getByRole('button',{name:'unarchiveSession:s2',exact:true}).click();
  await frame.getByRole('button',{name:'archiveSession:s2',exact:true}).waitFor();
  await page.locator('[data-host-navigation="management"]').click();
  await page.getByRole('button',{name:'恢复内置皮肤',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  assert.equal(await page.locator('iframe').count(),0);
  await page.getByRole('button',{name:/Renamed through plugin，plugin/}).waitFor();
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App.svelte and sandbox runtime',browser:browser.version(),checks:['complete navigation state for multiple workspaces','search and rename keep rapid input','rename executes host lifecycle and host notification stays visible','forged archive rejected','archive confirmation remains in host and suspends external interaction','archive cancellation and confirmation','unarchive action','default UI retains renamed session after restore']};
  await writeFile('/tmp/aibo-presentation-navigation-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

} catch(error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error; } finally {await browser.close();await server.close();}
