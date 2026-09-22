import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const source="self.aiboPresentation={render(input){const c=input.data.conversation;const actions=input.data.conversationActions;const children=[{tag:'h1',key:'heading',text:'External conversation'},{tag:'pre',key:'snapshot',attrs:{'aria-label':'Conversation snapshot'},text:JSON.stringify(c)},...input.data.navigationActions.filter(a=>a.operation==='selectWorkspace'||a.operation==='selectSession').map(a=>({tag:'button',key:a.token,text:a.operation+':'+a.targetId,events:{click:a.token}}))];for(const a of actions){if(a.event==='input'){const answer=a.operation==='answer';children.push({tag:'input',key:answer?'answer:'+JSON.stringify(a.args):'draft',attrs:{'aria-label':answer?'External answer':'External composer',value:answer?c.answerDrafts[JSON.stringify([c.session.id,...a.args])]||'':c.draft},events:{input:a.token}})}else children.push({tag:'button',key:a.token,text:a.operation+(a.args.length?':'+a.args.join(':'):''),events:{click:a.token}})}return {tag:'main',key:'main',children}}};";
const bytes=Buffer.from(source);
const pkg={release:{digest:'a'.repeat(64),enabled:true,manifest:{schema:'aibo.presentation-package/v1',id:'dev.example.workbench',version:'1.0.0',displayName:'External skin',hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'text/javascript'}]}},resources:{'skin.js':bytes.toString('base64')}};
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
try {
  await page.addInitScript(pkg=>{
    let callback=0;window.presentationCommands=[];window.presentationInstallable=pkg;
    const workspaces = ['w1','w2'].map(id=>({id,label:id,path:'/probe/'+id,trust:'trusted',createdAt:'2026-09-13',updatedAt:'2026-09-13',lastOpenedAt:null}));
    const sessions = ['s1','s2'].map((id,index)=>({id,workspaceId:'w'+(index+1),label:id,agent:'plugin',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'provider',capabilities:['queue.manage','model.list','model.select','model.reasoning','compaction.run'],createdAt:'2026-09-13',updatedAt:'2026-09-13'}));
    window.navigationCalls=[];
    const model={reference:'model-a',label:'Model A',id:'a',provider:'probe',description:null,isDefault:true,defaultReasoningEffort:null,serviceTiers:[],contextWindows:[],reasoningEfforts:[{id:'high',label:'High',description:null}]};
    const catalog={current:model,models:[model],currentReasoningEffort:null,reasoningEfforts:model.reasoningEfforts};
    let agentHandler=null,sequence=0;
    window.emitAgent=(type,payload)=>{const event={schemaVersion:'2.0',eventId:'event:'+ ++sequence,generationId:'generation',sequence,occurredAt:new Date().toISOString(),source:{pluginId:'dev.example.provider',pluginVersion:'1.0.0'},workspaceId:'w1',sessionId:'s1',turnId:'turn',type,payload};if(type==='session.state_changed')sessions[0].state=payload.state;window['_'+agentHandler]({event:'agent-event',id:1,payload:event});};

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='plugin:event|listen'){if(args.event==='agent-event')agentHandler=args.handler;return 1;}
        if(command==='get_session_models')return catalog;
        if(command==='get_timeline')return [{id:'message',sessionId:args.sessionId,turnId:'turn',externalMessageId:null,role:'assistant',toolName:'tool-name',entryType:'note',content:'Complete timeline data',status:'completed',createdAt:'2026-09-13',updatedAt:'2026-09-13'}];
        if(command==='invoke_agent_capability'){if(args.capability==='model.reasoning')catalog.currentReasoningEffort=args.input.level;return {};}
        if(command==='send_agent_prompt')return {...sessions.find(session=>session.id===args.sessionId),state:'idle'};
        if(command==='resolve_agent_user_input')return;
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
  await page.getByRole('button',{name:/^打开管理中心/}).click();
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null')!==null);
  await page.getByRole('button',{name:'完成',exact:true}).click();
  const frame=page.frameLocator('iframe');
  const snapshot=()=>frame.getByLabel('Conversation snapshot').textContent().then(JSON.parse);
  await frame.getByRole('heading',{name:'External conversation'}).waitFor();
  if(!await frame.getByRole('button',{name:'selectSession:s1',exact:true}).count())await frame.getByRole('button',{name:'selectWorkspace:w1',exact:true}).click();
  await frame.getByRole('button',{name:'selectSession:s1',exact:true}).click();
  const composer=frame.getByRole('textbox',{name:'External composer'});
  await composer.waitFor();
  assert.equal((await snapshot()).timeline[0].toolName,'tool-name');
  assert.equal((await snapshot()).timeline[0].entryType,'note');
  await composer.pressSequentially('complete conversation draft',{delay:10});
  await page.waitForTimeout(150);assert.equal(await composer.inputValue(),'complete conversation draft');
  await frame.getByRole('button',{name:'send',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='send_agent_prompt'));
  assert.equal(await page.evaluate(()=>window.navigationCalls.find(c=>c.command==='send_agent_prompt').args.input),'complete conversation draft');
  await frame.getByRole('button',{name:'loadModels',exact:true}).click();
  await frame.getByRole('button',{name:'selectModel:model-a:high',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='invoke_agent_capability'&&c.args.capability==='model.reasoning'));
  assert.equal(await page.evaluate(()=>window.navigationCalls.find(c=>c.command==='invoke_agent_capability'&&c.args.capability==='model.reasoning').args.input.level),'high');
  await frame.getByRole('button',{name:'compact',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='invoke_agent_capability'&&c.args.capability==='compaction.run'));
  await page.evaluate(()=>window.emitAgent('user_input.requested',{requestId:'question',isBlocking:true,questions:[{id:'q',header:null,question:'Which answer?',options:[{label:'Option',description:null}],isOther:true}]}));
  const answer=frame.getByRole('textbox',{name:'External answer'});await answer.waitFor();
  await answer.pressSequentially('answer survives skin switch',{delay:10});
  await page.getByRole('button',{name:/^打开管理中心/}).click();
  await page.getByRole('button',{name:'恢复内置呈现',exact:true}).click();
  await page.getByRole('button',{name:'完成',exact:true}).click();
  const nativeAnswer=page.getByRole('textbox',{name:'Which answer?'});
  assert.equal(await nativeAnswer.inputValue(),'answer survives skin switch');
  await nativeAnswer.fill('edited in default skin');
  await page.getByRole('button',{name:/^打开管理中心/}).click();
  await page.getByRole('button',{name:'External skin 1.0.0',exact:true}).click();
  await page.getByRole('button',{name:'完成',exact:true}).click();
  assert.equal(await answer.inputValue(),'edited in default skin');
  await frame.getByRole('button',{name:'submitAnswers:question:turn',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='resolve_agent_user_input'));
  assert.deepEqual(await page.evaluate(()=>window.navigationCalls.find(c=>c.command==='resolve_agent_user_input').args.answers),{q:['edited in default skin']});
  await answer.waitFor({state:'detached'});
  await page.evaluate(()=>{window.emitAgent('session.state_changed',{state:'running'});window.emitAgent('queue.updated',{steering:['queued'],followUp:[]});});
  await composer.fill('follow up from skin');
  await frame.getByRole('button',{name:'queueFollowUp',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='invoke_agent_capability'&&c.args.capability==='queue.manage'&&c.args.input.action==='followUp'));
  await frame.getByRole('button',{name:'stop',exact:true}).click();
  await page.waitForFunction(()=>window.navigationCalls.some(c=>c.command==='cancel_agent_turn'));
  assert.deepEqual(errors,[]);
  const result={passed:true,nativePort:'mocked; actual App.svelte, default components and Worker',browser:browser.version(),checks:['complete timeline metadata','rapid composer input and host send','model selection resolves host arguments','capability-based compaction','answer drafts survive external/default/external switch','host submits current request answers','running queue and stop dispatch through host']};
  await writeFile('/tmp/aibo-presentation-conversation-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

} catch(error) { console.error(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error; } finally {await browser.close();await server.close();}
