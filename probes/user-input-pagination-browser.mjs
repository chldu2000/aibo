import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {installDensityFixture} from './lib/density-fixture.mjs';
import { assertMaterial3Tokens } from './lib/material3-token-scan.mjs';

const server = await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null}});
await server.listen();
let browser;
try {
  browser = await chromium.launch({headless:true});
  for (const kit of ['material3','ak-ui']) for (const theme of ['light','dark']) {
    const page = await browser.newPage({locale:'zh-CN',viewport:{width:1000,height:600}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(installDensityFixture);
    await page.addInitScript(({kit,theme}) => {
      localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
      const original = window.__TAURI_INTERNALS__.invoke;
      let handler, sequence = 0;
      window.__TAURI_INTERNALS__.invoke = async (command,args={}) => {
        if (command === 'plugin:event|listen' && args.event === 'agent-event') handler = args.handler;
        if (command === 'resolve_agent_user_input' && window.failAnswerOnce) {
          window.failAnswerOnce = false;
          throw new Error('回答提交暂时失败');
        }
        return original(command,args);
      };
      window.requestQuestions = (requestId,questions) => window['_'+handler]({event:'agent-event',id:1,payload:{
        schemaVersion:'2.0',eventId:'input:'+ ++sequence,generationId:'generation',sequence,occurredAt:new Date().toISOString(),
        source:{pluginId:'dev.example.2',pluginVersion:'1.0.0'},workspaceId:'w1',sessionId:'s1',turnId:'t',type:'user_input.requested',
        payload:{requestId,questions,isBlocking:true},
      }});
    },{kit,theme});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator('.workspace-item').waitFor();
    if (await page.locator('.workspace-item').getAttribute('aria-expanded') !== 'true') await page.locator('.workspace-item').click();
    await page.locator('.session-item').click();
    const questions = [
      {id:'choice',header:'选择方案',question:'你希望使用哪个方案？',options:[{label:'方案 A',description:null},{label:'方案 B',description:null}],isOther:true},
      {id:'detail',header:'补充信息',question:'请补充实现要求',options:[],isOther:false},
      {id:'long',header:'长问题',question:'请阅读以下背景再回答。'.repeat(400),options:[],isOther:false},
    ];
    await page.evaluate(questions=>window.requestQuestions('pages',questions),questions);
    const card = page.locator('.user-input-card');
    await card.waitFor();
    assert.equal(await card.locator('fieldset').count(),1);
    await card.getByRole('button',{name:'方案 A',exact:true}).click();
    assert.equal(await card.getByRole('button',{name:'方案 A',exact:true}).getAttribute('aria-pressed'),'true');
    assert.ok(await card.getByText('问题 1 / 3',{exact:true}).isVisible(),'choosing an option does not advance');
    await card.getByRole('button',{name:'下一个',exact:true}).click();
    await card.getByRole('textbox',{name:'请补充实现要求',exact:true}).fill('保留现有接口');
    await card.getByRole('button',{name:'上一个',exact:true}).click();
    assert.equal(await card.getByRole('button',{name:'方案 A',exact:true}).getAttribute('aria-pressed'),'true');
    await card.getByRole('textbox').fill('自定义方案');
    await card.getByRole('button',{name:'问题 3，未回答',exact:true}).click();
    const assertActionsReachable = async () => {
      for (const button of await card.locator('.user-input-actions button').all()) {
        assert.ok(await button.evaluate(node=>{
          const r=node.getBoundingClientRect();
          return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        }),`${kit}/${theme}: question actions remain visible and unobscured`);
      }
    };
    await assertActionsReachable();
    const region = card.getByRole('region',{name:'当前问题',exact:true});
    assert.ok(await region.evaluate(node=>node.scrollHeight>node.clientHeight));
    await page.setViewportSize({width:960,height:640});
    await assertActionsReachable();
    await assertMaterial3Tokens(page, `questions ${theme}`);
    await page.screenshot({path:`/tmp/aibo-questions-${kit}-${theme}.png`});
    await page.setViewportSize({width:1000,height:540});
    await assertActionsReachable();
    await page.getByRole('button',{name:'专注会话',exact:true}).click();
    await page.setViewportSize({width:800,height:480});
    await card.getByRole('button',{name:'问题 3，未回答',exact:true}).click();
    await assertActionsReachable();
    // Keyboard navigation into the answer must scroll the input into view.
    await region.focus();
    await page.keyboard.press('Tab');
    assert.ok(await card.getByRole('textbox').evaluate(node=>document.activeElement===node));
    assert.ok(await region.evaluate(node=>node.scrollTop>0));
    await card.getByRole('textbox').fill('已阅读');
    await card.getByRole('button',{name:'问题 2，已回答',exact:true}).click();
    assert.equal(await card.getByRole('textbox').inputValue(),'保留现有接口');
    await card.getByRole('textbox').fill('   ');
    await card.getByRole('button',{name:'下一个',exact:true}).click();
    await card.getByRole('button',{name:'提交全部回答',exact:true}).click();
    await card.getByRole('alert').waitFor();
    assert.ok(await card.getByText('问题 2 / 3',{exact:true}).isVisible());
    assert.equal(await page.evaluate(()=>window.densityCalls.filter(call=>call.command==='resolve_agent_user_input').length),0);
    await card.getByRole('textbox').fill('保留现有接口');
    await card.getByRole('button',{name:'下一个',exact:true}).click();
    await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('aibo.answer-drafts.v1.main')||'{}').drafts??{}).includes('已阅读'));
    await page.reload();
    await page.locator('.timeline').waitFor();
    await page.evaluate(questions=>window.requestQuestions('pages',questions),questions);
    await card.waitFor();
    assert.equal(await card.getByRole('textbox').inputValue(),'自定义方案');
    await card.getByRole('button',{name:'问题 3，已回答',exact:true}).click();
    assert.equal(await card.getByRole('textbox').inputValue(),'已阅读');
    await card.getByRole('button',{name:'提交全部回答',exact:true}).click();
    await card.waitFor({state:'detached'});
    assert.deepEqual(await page.evaluate(()=>window.densityCalls.find(call=>call.command==='resolve_agent_user_input').args),{
      sessionId:'s1',requestId:'pages',answers:{choice:['自定义方案'],detail:['保留现有接口'],long:['已阅读']},
    });
    await page.evaluate(question=>window.requestQuestions('single',[question]),questions[1]);
    await card.waitFor();
    assert.equal(await card.getByRole('navigation').count(),0);
    assert.equal(await card.getByRole('button',{name:'下一个',exact:true}).count(),0);
    assert.equal(await card.getByRole('textbox').inputValue(),'');
    await card.getByRole('textbox').fill('单题回答');
    await page.evaluate(()=>{window.failAnswerOnce=true;});
    await card.getByRole('button',{name:'提交回答',exact:true}).click();
    await page.getByText('回答提交暂时失败',{exact:true}).waitFor();
    assert.equal(await card.getByRole('textbox').inputValue(),'单题回答');
    await card.getByRole('button',{name:'提交回答',exact:true}).click();
    await card.waitFor({state:'detached'});
    await page.evaluate(()=>window.requestQuestions('options',[{
      id:'many',header:'选择',question:'请选择一个选项',isOther:false,
      options:Array.from({length:30},(_,i)=>({label:`选项 ${i}：${'较长的说明'.repeat(20)}`,description:null})),
    }]));
    await card.waitFor();
    await assertActionsReachable();
    assert.ok(await region.evaluate(node=>node.scrollHeight>node.clientHeight));
    assert.ok(await card.locator('.user-input-options').evaluate(node=>node.scrollWidth<=node.clientWidth));
    await card.getByRole('button',{name:'停止并取消',exact:true}).click();
    await card.waitFor({state:'detached'});
    assert.ok(await page.evaluate(()=>window.densityCalls.some(call=>call.command==='cancel_agent_turn')));
    assert.deepEqual(errors,[]);
    console.log(`${kit}/${theme}: pagination, drafts, validation, keyboard scroll, narrow layout and submission passed`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
