import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){const c=input.data.capability;if(c.view.snapshot&&c.view.snapshot.schema!=='aibo.semantic-view/v1')throw Error('undeclared snapshot leaked');return {tag:'main',key:'main',children:[{tag:'h1',key:'heading',text:'External capability workbench'},{tag:'pre',key:'snapshot',attrs:{'aria-label':'Capability state'},text:JSON.stringify(c)},...input.data.capabilityActions.map(a=>{const semantic=a.operation==='semantic'?JSON.parse(a.args[0]):null;return {tag:'button',key:a.token,text:semantic?'semantic:'+semantic.actionId+':'+(semantic.itemId||''):a.operation+(a.args.length?':'+a.args.join(':'):''),events:{click:a.token}}})]}}};";
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
    window.navigationCalls=[];window.capabilitySchema='aibo.semantic-view/v1';let generation=0,revision=0;
    const contribution={installationId:'installation',contributionId:'dev.example.tool',title:'Capability tool',scope:'workspace',available:true,issue:null};
    const capabilitySnapshot=(detail=false)=>({schema:window.capabilitySchema,context:{workspaceId:'w1',contributionId:contribution.contributionId,generation:'generation:'+generation,revision:++revision},contribution:{id:contribution.contributionId,extensionPoint:'workspace.tool',title:'Capability tool'},state:{status:'ready',message:''},view:detail?{kind:'detail',itemId:'item',properties:[{label:'Source',value:'Provider'}],content:'Complete capability detail',truncated:false}:{kind:'collection',properties:[{key:'name',label:'Name',type:'text',values:[]}],items:[{id:'item',values:{name:'Capability item'}}],selection:null,page:{offset:0,size:50,total:1,truncated:false}},actions:detail?[{id:'back',label:'Back',intent:'navigate',enabled:true},{id:'refresh',label:'Refresh',intent:'refresh',enabled:true}]:[{id:'inspect',label:'Inspect',intent:'inspect',enabled:true},{id:'refresh',label:'Refresh',intent:'refresh',enabled:true}]});

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='list_semantic_contributions')return [contribution];
        if(command==='open_semantic_contribution'){generation++;revision=0;return capabilitySnapshot();}
        if(command==='act_semantic_contribution')return capabilitySnapshot(args.action.actionId==='inspect');
        if(command==='release_semantic_contribution'||command==='cancel_semantic_open')return;
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
  const snapshot=()=>frame.getByLabel('Capability state').textContent().then(JSON.parse);
  const calls=command=>page.evaluate(command=>window.navigationCalls.filter(c=>c.command===command).length,command);
  await frame.getByRole('heading',{name:'External capability workbench'}).waitFor();
  await frame.getByRole('button',{name:'open:installation:dev.example.tool',exact:true}).click();
  await frame.getByRole('button',{name:'semantic:inspect:item',exact:true}).click();
  await frame.getByRole('button',{name:'toggleReading',exact:true}).waitFor();
  assert.equal((await snapshot()).view.snapshot.view.content,'Complete capability detail');
  console.log('verified initial detail');
  const opened=await calls('open_semantic_contribution');const released=await calls('release_semantic_contribution');
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('button',{name:'恢复内置呈现',exact:true}).click();
  await page.getByRole('button',{name:'关闭管理中心',exact:true}).click();
  await page.getByText('Complete capability detail',{exact:true}).waitFor();
  await page.getByRole('button',{name:'切换布局',exact:true}).click();
  assert.equal(await calls('open_semantic_contribution'),opened);assert.equal(await calls('release_semantic_contribution'),released);
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'关闭管理中心',exact:true}).click();
  assert.equal((await snapshot()).view.layout,'sidebar');assert.equal((await snapshot()).view.snapshot.view.content,'Complete capability detail');
  assert.equal(await calls('open_semantic_contribution'),opened);assert.equal(await calls('release_semantic_contribution'),released);
  console.log('verified switch retains lease');
  await frame.getByRole('button',{name:'close',exact:true}).click();
  await page.waitForFunction(released=>window.navigationCalls.filter(c=>c.command==='release_semantic_contribution').length===released+1,released);
  await frame.getByRole('button',{name:'open:installation:dev.example.tool',exact:true}).click();
  await frame.getByRole('button',{name:'toggleReading',exact:true}).waitFor();
  assert.equal((await snapshot()).view.snapshot.view.content,'Complete capability detail');
  console.log('verified reopen restores detail');
  await page.evaluate(()=>window.capabilitySchema='aibo.semantic-view/v1.1');
  await frame.getByRole('button',{name:'reload',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0&&JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')===null);
  await page.getByRole('status').filter({hasText:'皮肤不支持此能力视图格式'}).waitFor();
  console.log('verified unsupported schema recovery');
  await page.getByText('Complete capability detail',{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'unsupported_presentation_snapshot'}).first().waitFor();
  assert.equal(await page.locator('iframe').count(),0);
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App, default capability view and Worker',browser:browser.version(),checks:['open contribution and inspect semantic item','full provider detail exposed','external/default/external keeps same lease and view','layout preference survives switches','explicit close releases lease','reopen restores detail','unsupported snapshot falls back without delivering undeclared data','incompatible candidate rejected before activation']};
  await writeFile('/tmp/aibo-capability-workbench-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

} catch(error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error; } finally {await browser.close();await server.close();}
