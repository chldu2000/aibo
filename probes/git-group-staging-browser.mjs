import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const fixture = '<html><body><div id="app"></div><script type="module" src="/probes/fixtures/git-group-staging.mjs"></script></body></html>';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{name:'git-group-fixture',configureServer(server){server.middlewares.use('/__git-group',(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(fixture);});}}]});
await server.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1000,height:900}});page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__git-group`);await page.waitForFunction(()=>Boolean(window.mountGroup));
 for(const kit of ['ak-ui','material3'])for(const theme of ['light','dark'])for(const all of [false,true]){
  await page.evaluate(options=>window.mountGroup(options),{kit,theme,all});
  const scope=all?page.getByRole('region',{name:'仓库 Two two',exact:true}):page.getByRole('complementary',{name:'Git 源代码管理'});
  for(const [group,action] of [['更改','stage_changed'],['未跟踪的文件','stage_untracked'],['已暂存','unstage_all']]){
   const region=scope.getByRole('region',{name:group,exact:true});await region.locator('.git-change-group-heading').hover();
   await region.locator('.git-change-group-action').focus();await page.keyboard.press('Enter');
   const result=await page.evaluate(()=>window.actions.at(-1));
   assert.equal(result.action,action,`${kit}/${theme}/${all?'all repositories':'one repository'}: ${group} bulk action must stay within its group`);
   assert.equal(result.workspaceId,'workspace');assert.equal(result.repositoryId,all?'two':undefined);
  }
  if(all){await scope.getByRole('button',{name:'全部暂存',exact:true}).click();assert.equal(await page.evaluate(()=>window.actions.at(-1).action),'stage_all','repository-wide action retains its explicit scope');}
 }
 for(const options of [{busy:true},{trust:'untrusted'}]){
  await page.evaluate(options=>window.mountGroup(options),options);
  assert(await page.getByRole('region',{name:'更改',exact:true}).locator('.git-change-group-action').isDisabled());
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: changed/untracked groups have separate bulk staging intents; full-repository action, repository identity, busy/trust guards and both themes preserved.');
} finally {await browser.close();await server.close();}
