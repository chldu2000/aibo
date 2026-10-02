import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

// Exercise App's real reactive graph. Counts catch redundant work independently
// of machine speed; native timing is verified separately with real histories.
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
 name:'conversation-performance',enforce:'pre',transform(code,id){
  if(id.endsWith('/packages/presentation-workbench/markdown.js'))return code.replace('const result = blocks(Lexer.lex(', 'globalThis.perfLexCount = (globalThis.perfLexCount ?? 0) + 1;\n  const result = blocks(Lexer.lex(');
  if(!id.endsWith('/src/App.svelte'))return;
  return code.replace('const data = { workspaces:', 'window.perfSnapshotCount = (window.perfSnapshotCount ?? 0) + 1;\n    const data = { workspaces:')
   .replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces;
    workspaceSessionMap={'preview-workspace':[{id:'a',workspaceId:'preview-workspace',agent:'fixture',label:'Performance session',state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:[],createdAt:'2026-10-02',updatedAt:'2026-10-02'}]};
    window.perfHistory=()=>{
      timeline=Array.from({length:2000},(_,i)=>({id:'m'+i,sessionId:'a',turnId:'t'+i,externalMessageId:null,role:i%5?'tool':'assistant',toolName:i%5?'shell':null,entryType:null,content:i%5?'literal [tool](https://tool.invalid) '+('log '.repeat(3000)):'Message '+i+' [link](https://message.invalid/'+i+')',status:'completed',createdAt:'2026-10-02',updatedAt:'2026-10-02'}));
      timelineVisibleCount=80;
    };
    window.perfSnapshot=()=>externalInput;
    window.perfPrepare=(enabled)=>preparingExternalWorkbench=enabled?1:0;
    window.perfStream=()=>timeline=timeline.map(item=>item.id==='m1995'?{...item,content:item.content+' streamed'}:item);
    setTimeout(()=>{selectedSessionId='a';window.perfHistory();},100);
   `);
 }
}]});
await server.listen();const browser=await chromium.launch({headless:true});
try {
 for(const kit of ['material3','ak-ui'])for(const theme of ['light','dark']){
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({kit,theme})=>localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme})),{kit,theme});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const input=page.locator('[data-composer-input]');await input.waitFor();
  await page.waitForFunction(()=>window.perfSnapshot().context.sessionId==='a');
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const before=await page.evaluate(()=>({snapshots:window.perfSnapshotCount??0,lex:window.perfLexCount??0}));
  await input.pressSequentially('typing without history work');
  assert.equal(await input.inputValue(),'typing without history work');
  const after=await page.evaluate(()=>({snapshots:window.perfSnapshotCount??0,lex:window.perfLexCount??0}));
  assert.deepEqual(after,before,'default typing neither builds external snapshots nor parses history');
  assert.equal(before.snapshots,0,'default history loading does not build an unused external snapshot');
  await page.evaluate(()=>window.perfPrepare(true));
  await page.waitForFunction(()=>window.perfSnapshot().data?.conversation?.timeline.length===2000);
  await page.evaluate(()=>{window.perfPreviousHistory=window.perfSnapshot().data.conversation.timeline;window.perfPreviousLegacy=window.perfSnapshot().data.timeline;window.perfPreviousLex=window.perfLexCount;});
  await input.pressSequentially(' with external snapshot');
  assert.deepEqual(await page.evaluate(()=>({history:window.perfPreviousHistory===window.perfSnapshot().data.conversation.timeline,legacy:window.perfPreviousLegacy===window.perfSnapshot().data.timeline,lex:window.perfPreviousLex===window.perfLexCount})),{history:true,legacy:true,lex:true},'draft updates reuse detached history and parsed prose');
  await page.evaluate(()=>window.perfStream());
  await page.waitForFunction(()=>window.perfSnapshot().data.conversation.timeline.find(item=>item.id==='m1995').content.endsWith(' streamed'));
  assert.deepEqual(await page.evaluate(()=>({changed:window.perfPreviousHistory!==window.perfSnapshot().data.conversation.timeline,oldUnchanged:!window.perfPreviousHistory.find(item=>item.id==='m1995').content.endsWith(' streamed'),newParses:window.perfLexCount-window.perfPreviousLex})),{changed:true,oldUnchanged:true,newParses:1},'stream updates only parse changed prose and preserve prior snapshot immutability');
  await page.evaluate(()=>window.perfPrepare(false));
  await page.waitForFunction(()=>window.perfSnapshot().data===null);
  assert.equal(await input.inputValue(),'typing without history work with external snapshot');
  assert.deepEqual(errors,[]);console.log(`${kit}/${theme}: no history work on default input; external history reuse, streaming invalidation and draft retention passed`);
  await page.close();
 }
}finally{await browser.close();await server.close();}
