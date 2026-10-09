import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {navigationActions} from '../src/lib/presentation-runtime/navigation.ts';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';
import {createGitDirectory} from '../src/lib/presentation-runtime/git.ts';
import {createCapabilityWorkbenchDirectory} from '../src/lib/presentation-runtime/capability-workbench.ts';
import {createInspectorDirectory} from '../src/lib/presentation-runtime/inspector.ts';
const {build}=await import('esbuild');
const bundled=await build({stdin:{contents:`
import {renderNavigation} from './navigation.js';
import {renderConversation} from './conversation.js';
import {renderGit} from './git.js';
import {renderInspector} from './inspector.js';
import {renderCapability} from './capability.js';
const renderers={navigation:renderNavigation,conversation:renderConversation,git:renderGit,inspector:renderInspector,capability:(state,actions,locale)=>renderCapability(state,actions,data=>({tag:'pre',key:'capability:raw-content',text:data.snapshot.view.content}),locale)};
self.aiboPresentation={render(input){return renderers[input.data.kind](input.data.state,input.data.actions,input.locale)}};
`,resolveDir:new URL('../packages/presentation-workbench/',import.meta.url).pathname},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'});
const source=bundled.outputFiles[0].text;
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/presentation-sandbox.html`);await page.waitForFunction(()=>window.sandboxProbe);
 for(const kind of ['navigation','conversation','git','inspector']){
  const state=JSON.parse(await readFile(`fixtures/presentation-workbench/${kind}.json`,'utf8'));
  if(kind==='git')state.draft.gitSection='changes';
  if(kind==='conversation'){state.groupSystemItems=true;state.timeline.push(...['First system event','Second system event'].map((content,index)=>({id:'system-'+index,role:'system',toolName:null,entryType:'note',content,status:'completed',turnId:null})));state.timelineVisibleCount=state.timeline.length;}
  const actions=kind==='navigation'?navigationActions(state):(kind==='git'?createGitDirectory():kind==='inspector'?createInspectorDirectory():createConversationDirectory()).project(state);
  await page.evaluate(({source,data})=>window.sandboxProbe.mount(source,data),{source,data:{kind,state,actions}});
  const frame=page.frameLocator('iframe');
  const operation=({navigation:'renameDraft',conversation:'draft',git:'commitMessage',inspector:'projectField'})[kind];
  const action=actions.find(action=>action.operation===operation);
  const field=frame.getByRole('textbox',{name:({navigation:'会话名称',conversation:'消息',git:'提交说明',inspector:'名称'})[kind],exact:true});
  await field.fill('保留我的输入');
  await page.waitForFunction(token=>window.sandboxProbe.intents.at(-1)?.id===token,action.token);
  assert.equal(await page.evaluate(()=>window.sandboxProbe.intents.at(-1).value),'保留我的输入');
  const click=actions.find(action=>action.operation===({navigation:'saveRename',conversation:'send',git:'stageFile',inspector:'hunkAction'})[kind]);
  await frame.getByRole('button',{name:({navigation:'保存名称',conversation:'发送',git:'暂存',inspector:'暂存片段'})[kind],exact:true}).click();
  await page.waitForFunction(token=>window.sandboxProbe.intents.at(-1)?.id===token,click.token);
  if(kind==='conversation'){
   await frame.getByText('系统消息 · 2 项',{exact:true}).click();
   await frame.getByText('First system event · 查看详情',{exact:true}).click();
   await frame.getByText('First system event',{exact:true}).waitFor();
   await frame.getByRole('textbox',{name:'Choice?',exact:true}).fill('自定义回答');
   const answer=actions.find(action=>action.operation==='answer');
   await page.waitForFunction(token=>window.sandboxProbe.intents.at(-1)?.id===token,answer.token);
   assert.equal(await frame.getByText('complete',{exact:true}).textContent(),'complete');
  }
  if(kind==='navigation')state.sessionLabelDraft='保留我的输入';
  if(kind==='conversation')state.draft='保留我的输入';
  if(kind==='git')state.draft.commitMessage='保留我的输入';
  if(kind==='inspector')state.projectEditor.name='保留我的输入';
  const nextActions=kind==='navigation'?navigationActions(state):(kind==='git'?createGitDirectory():kind==='inspector'?createInspectorDirectory():createConversationDirectory()).project(state);
  await page.locator('iframe').evaluate(element=>element.dataset.probeIdentity='same-instance');
  await page.evaluate(data=>window.sandboxProbe.update(data,'en'),{kind,state,actions:nextActions});
  const englishField=frame.getByRole('textbox',{name:({navigation:'Session name',conversation:'Message',git:'Commit message',inspector:'Name'})[kind],exact:true});
  await englishField.waitFor();assert.equal(await englishField.inputValue(),'保留我的输入');
  assert.equal(await page.locator('iframe').getAttribute('data-probe-identity'),'same-instance');
  const englishClick=nextActions.find(action=>action.operation===({navigation:'saveRename',conversation:'send',git:'stageFile',inspector:'hunkAction'})[kind]);
  await frame.getByRole('button',{name:({navigation:'Save name',conversation:'Send',git:'Stage',inspector:'Stage hunk'})[kind],exact:true}).click();
  await page.waitForFunction(token=>window.sandboxProbe.intents.at(-1)?.id===token,englishClick.token);
  await page.evaluate(data=>window.sandboxProbe.update(data,'zh-CN'),{kind,state,actions:nextActions});
  await field.waitFor();assert.equal(await field.inputValue(),'保留我的输入');
 }
 const capability=JSON.parse(await readFile('fixtures/presentation-workbench/capability.json','utf8'));
 const capabilityActions=createCapabilityWorkbenchDirectory().project(capability);
 await page.evaluate(({source,data})=>window.sandboxProbe.mount(source,data,'zh-CN'),{source,data:{kind:'capability',state:capability,actions:capabilityActions}});
 const capabilityFrame=page.frameLocator('iframe');
 await capabilityFrame.getByRole('heading',{name:'能力视图',exact:true}).waitFor();
 await page.locator('iframe').evaluate(element=>element.dataset.probeIdentity='same-capability');
 await page.evaluate(data=>window.sandboxProbe.update(data,'en'),{kind:'capability',state:capability,actions:capabilityActions});
 await capabilityFrame.getByRole('heading',{name:'Capability view',exact:true}).waitFor();
 assert.equal(await capabilityFrame.locator('[data-presentation-key="capability:raw-content"]').textContent(),capability.view.snapshot.view.content);
 assert.equal(await page.locator('iframe').getAttribute('data-probe-identity'),'same-capability');
 const reload=capabilityActions.find(action=>action.operation==='reload');
 await capabilityFrame.getByRole('button',{name:'Reload',exact:true}).click();
 await page.waitForFunction(token=>window.sandboxProbe.intents.at(-1)?.id===token,reload.token);
 assert.deepEqual(errors,[]);
 const result={passed:true,browser:browser.version(),scope:'isolated navigation/conversation/Git/Inspector/capability modules; not full App workbench',checks:['ordinary system group and nested disclosure','real Worker accepts module trees','Chinese/English language updates retain the iframe and all four drafts', 'rename and composer input events','save and send host tokens','answer input and full message content','Git draft input and staged file target','project field input and hunk target','capability language, raw content and reload token']};
 await writeFile('/tmp/aibo-workbench-modules-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await server.close();}
