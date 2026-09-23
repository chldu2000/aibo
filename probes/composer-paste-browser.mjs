import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
const built=await buildPresentationSkins();
const pkg=built.packages[0];
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
page.setDefaultTimeout(15000);
await page.context().grantPermissions(['clipboard-read','clipboard-write']);const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.addInitScript(pkg=>{
    if(window!==window.top)return;
    const storedAttachments=JSON.parse(sessionStorage.getItem('probe.attachments')||'[]'), messages=JSON.parse(sessionStorage.getItem('probe.messages')||'[]');
    let callback=0;window.presentationCommands=[];window.presentationInstallable=pkg;
    const workspaces = ['w1','w2'].map(id=>({id,label:id,path:'/probe/'+id,trust:'trusted',createdAt:'2026-09-13',updatedAt:'2026-09-13',lastOpenedAt:null}));
    const sessions = ['s1','s2'].map((id,index)=>({id,workspaceId:'w'+(index+1),label:id,agent:'plugin',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:['image.input'],createdAt:'2026-09-13',updatedAt:'2026-09-13'}));
    window.navigationCalls=[];
    const changed={path:'src/file.ts',previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false};
    let commitAttempts=0;

    const read=()=>JSON.parse(localStorage.getItem('probe.presentation.installed')||'null');
    const saved=()=>JSON.parse(localStorage.getItem('probe.presentation.selection')||'null');
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(fn){const id=++callback;window['_'+id]=fn;return id;},unregisterCallback(id){delete window['_'+id];},
      async invoke(command,args={}){
        window.presentationCommands.push(command);window.navigationCalls.push({command,args});
        if(command==='list_workspace_git_repositories')return {repositories:(window.multiRepository?['one','two']:['.']).map(id=>({id,name:id==='.'?'w1':id,relativePath:id,kind:'repository',externalRoot:false})),limited:false,warnings:[],scanBudget:2000};
        if(command==='register_session_clipboard_images'){const added=args.images.map((image,index)=>({schema:'aibo.context-attachment/v1',id:'paste-'+window.navigationCalls.length+'-'+index,workspaceId:'w1',sessionId:args.sessionId,turnId:null,path:'clipboard/image-'+index+'.png',size:68,mediaType:'image/png',source:'manual',sendStrategy:'inline',createdAt:'now'}));storedAttachments.push(...added);return added;}
        if(command==='get_workspace_changes')return {workspaceId:args.workspaceId,head:'head',branch:'main',dirty:true,capturedAt:'now',files:[changed],captureStatus:'captured',captureError:null};
        if(command==='list_workspace_git_branches')return [{name:'main',current:true,commit:'head'},{name:'topic',current:false,commit:'old'}];
        if(command==='list_workspace_git_history'&&window.delayedRepositoryReads){if(args.repositoryId==='one')await new Promise(resolve=>setTimeout(resolve,300));return [{hash:'commit-a',shortHash:'commit-a',subject:args.repositoryId==='one'?'STALE ONE':'CURRENT TWO',author:'Author',authoredAt:'2026-09-13'}];}
        if(command==='list_workspace_git_history')return [{hash:'commit-a',shortHash:'commit-a',subject:'Earlier change',author:'Author',authoredAt:'2026-09-13'}];
        if(command==='get_workspace_git_remote_status')return {branch:'main',upstream:'origin/main',ahead:1,behind:1};
        if(command==='list_workspace_git_stashes')return [{reference:'stash@{0}',message:'Saved changes'}];
        if(command==='get_workspace_file_diff'||command==='get_workspace_git_commit_file_diff')return {path:args.path,staged:args.staged??false,available:true,truncated:true,diff:'@@ -1 +1 @@\n-before\n+after',hunks:[{index:0,header:'@@ -1 +1 @@',content:'-before\n+after'}],reason:'preview limit'};
        if(command==='list_workspace_git_commit_files')return {commit:args.commit,files:args.offset?[{path:'second.ts',previousPath:null,kind:'added'}]:[{path:'historical.ts',previousPath:'old.ts',kind:'renamed'}],total:2};
        if(command==='apply_workspace_git_file_action'){changed.staged=args.action==='stage';changed.unstaged=!changed.staged;return {applied:true,message:'ok',path:args.path,action:args.action};}
        if(command==='commit_workspace_changes')return ++commitAttempts===1?{committed:false,hash:null,message:'probe commit rejected'}:{committed:true,hash:'new-commit',message:'ok'};
        if(command==='create_workspace_git_branch'||command==='checkout_workspace_git_branch'||command==='sync_workspace_git'||command==='stash_workspace_git'||command==='apply_workspace_git_stash')return {applied:true,message:'ok',action:args.action??'branch'};
        if(command==='get_session_attachment_preview')return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
        if(command==='list_session_attachments')return storedAttachments.filter(item=>item.sessionId===args.sessionId);
        if(command==='get_timeline')return messages.filter(item=>item.sessionId===args.sessionId);
        if(command==='send_agent_prompt'){
          for(const item of storedAttachments)if(item.sessionId===args.sessionId && item.turnId===null)item.turnId='sent-turn';
          messages.push({id:'sent-message',sessionId:args.sessionId,turnId:'sent-turn',role:'user',content:args.input,status:'completed',createdAt:'2026-09-20',updatedAt:'2026-09-20'});
          sessionStorage.setItem('probe.attachments',JSON.stringify(storedAttachments));sessionStorage.setItem('probe.messages',JSON.stringify(messages));
          return {...sessions.find(item=>item.id===args.sessionId)};
        }
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
  console.log('loaded app');
  await page.getByText('s1',{exact:true}).click();
  const input=page.locator('[data-composer-input]');
  await input.fill('existing text');
  await input.evaluate(element=>{
    const data=new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'clipboard.png',{type:'image/png'}));
    element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.navigationCalls.filter(call=>call.command==='register_session_clipboard_images').length),1,'pasting an image must register it as a session attachment');
  await page.getByRole('button',{name:'移除附件 image-0.png',exact:true}).waitFor();
  assert.equal(await input.inputValue(),'existing text');
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);});
  console.log('registered image');
  // Plain text is not intercepted; both built-in textarea implementations forward paste.
  for (const kit of ['shadcn','material3']) {
    await page.evaluate(async kit=>(await import('/src/lib/ui-kit/registry.ts')).setUiKit(kit),kit);
    assert.equal(await input.evaluate(element=>{const data=new DataTransfer();data.setData('text/plain','ordinary text');const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});element.dispatchEvent(event);return event.defaultPrevented;}),false);
    const before=await page.evaluate(()=>window.navigationCalls.filter(call=>call.command==='register_session_clipboard_images').length);
    await input.press('Meta+V');
    await page.waitForFunction(before=>window.navigationCalls.filter(call=>call.command==='register_session_clipboard_images').length===before+1,before);
    await page.waitForFunction(()=>!document.querySelector('textarea').disabled);
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[aria-label="上下文附件"] img')).some(img=>img.naturalWidth>0));
    await input.fill('');
    assert.equal(await page.getByRole('button',{name:'发送',exact:true}).isEnabled(),true,'an image-only draft can be sent');
  }
  console.log('native previews passed');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[aria-label="消息附件"] img')).some(img=>img.naturalWidth>0));
  assert.equal(await page.getByRole('button',{name:'移除附件 image-0.png',exact:true}).count(),0,'sent attachments leave the draft');
  await page.screenshot({path:'/tmp/aibo-attachment-previews.png'});
  await page.reload();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[aria-label="消息附件"] img')).some(img=>img.naturalWidth>0));
  // Headless Chromium has its own clipboard: exercise a trusted native paste in the external skin.
  console.log('sent attachments passed');
  await page.keyboard.press('Meta+,');
  await page.getByRole('button',{name:'安装皮肤插件',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(pkg.release.manifest.displayName+' '+pkg.release.manifest.version),exact:true}).click();
  await page.getByRole('button',{name:'关闭管理中心',exact:true}).click();
  const frame=page.frameLocator('iframe:not([aria-hidden="true"])');
  const externalInput=frame.locator('textarea').first();
  await externalInput.click();
  const before=await page.evaluate(()=>window.navigationCalls.filter(call=>call.command==='register_session_clipboard_images').length);
  await externalInput.press('Meta+V');
  await page.waitForFunction(before=>window.navigationCalls.filter(call=>call.command==='register_session_clipboard_images').length===before+1,before);
  await frame.locator('img[data-attachment-preview]').first().evaluate(img=>img.decode());
  assert.ok(await frame.locator('img[data-attachment-preview]').first().evaluate(img=>img.naturalWidth>0));
  assert.deepEqual(errors,[]);
  console.log('Clipboard images: native registration, both built-in skins, plain text passthrough, image-only send and trusted paste in external skin passed');
} catch(error) { await page.screenshot({path:'/tmp/aibo-preview-failure.png'}); console.log(await page.locator('body').innerText()); console.log(errors); throw error; } finally {await browser.close();await server.close();await built.dispose();}
