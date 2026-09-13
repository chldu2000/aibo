import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {navigationActions} from '../src/lib/presentation-runtime/navigation.ts';
import {createConversationDirectory} from '../src/lib/presentation-runtime/conversation.ts';
let source='';
const tree=(await readFile('packages/presentation-workbench/tree.js','utf8')).replaceAll('export ','');
for(const name of ['navigation','conversation']){
 const code=(await readFile(`packages/presentation-workbench/${name}.js`,'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export ','');
 source+=`self.render${name}=(()=>{${tree}\n${code}\nreturn render${name[0].toUpperCase()+name.slice(1)};})();\n`;
}
source+='self.aiboPresentation={render(input){return self["render"+input.data.kind](input.data.state,input.data.actions)}};';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/presentation-sandbox.html`);await page.waitForFunction(()=>window.sandboxProbe);
 for(const kind of ['navigation','conversation']){
  const state=JSON.parse(await readFile(`fixtures/presentation-workbench/${kind}.json`,'utf8'));
  const actions=kind==='navigation'?navigationActions(state):createConversationDirectory().project(state);
  await page.evaluate(({source,data})=>window.sandboxProbe.mount(source,data),{source,data:{kind,state,actions}});
  const frame=page.frameLocator('iframe');
  const operation=kind==='navigation'?'renameDraft':'draft';
  const action=actions.find(action=>action.operation===operation);
  const field=frame.getByRole('textbox',{name:kind==='navigation'?'会话名称':'消息',exact:true});
  await field.fill('保留我的输入');
  await page.waitForFunction(token=>window.sandboxProbe.intents.at(-1)?.id===token,action.token);
  assert.equal(await page.evaluate(()=>window.sandboxProbe.intents.at(-1).value),'保留我的输入');
  const click=actions.find(action=>action.operation===(kind==='navigation'?'saveRename':'send'));
  await frame.getByRole('button',{name:kind==='navigation'?'保存名称':'发送',exact:true}).click();
  await page.waitForFunction(token=>window.sandboxProbe.intents.at(-1)?.id===token,click.token);
  if(kind==='conversation'){
   await frame.getByRole('textbox',{name:'Choice?',exact:true}).fill('自定义回答');
   const answer=actions.find(action=>action.operation==='answer');
   await page.waitForFunction(token=>window.sandboxProbe.intents.at(-1)?.id===token,answer.token);
   assert.equal(await frame.getByText('complete',{exact:true}).textContent(),'complete');
  }
 }
 assert.deepEqual(errors,[]);
 const result={passed:true,browser:browser.version(),scope:'isolated navigation/conversation modules; not full App workbench',checks:['real Worker accepts module trees','rename and composer input events','save and send host tokens','answer input and full message content']};
 await writeFile('/tmp/aibo-workbench-modules-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await server.close();}
