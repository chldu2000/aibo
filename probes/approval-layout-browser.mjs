import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {installDensityFixture} from './lib/density-fixture.mjs';

const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
let browser;
try {
  browser = await chromium.launch({headless:true});
  for (const kit of ['material3','ak-ui']) for (const theme of ['light','dark']) {
    const page = await browser.newPage({viewport:{width:1000,height:600}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(installDensityFixture);
    await page.addInitScript(({kit,theme}) => {
      localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:kit,themeId:theme}));
      const original = window.__TAURI_INTERNALS__.invoke;
      let handler, sequence = 0;
      window.__TAURI_INTERNALS__.invoke = async (command,args={}) => {
        if (command === 'plugin:event|listen' && args.event === 'agent-event') handler = args.handler;
        return original(command,args);
      };
      window.requestApproval = (id,command,options=[]) => window['_'+handler]({event:'agent-event',id:1,payload:{
        schemaVersion:'2.0',eventId:'approval:'+ ++sequence,generationId:'generation',sequence,occurredAt:new Date().toISOString(),
        source:{pluginId:'dev.example.2',pluginVersion:'1.0.0'},workspaceId:'w1',sessionId:'s1',turnId:'t',type:'approval.requested',
        payload:{requestId:id,kind:'command',command,cwd:'/probe/workspace',availableDecisions:['accept','cancel'],options},
      }});
    },{kit,theme});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator('.workspace-item').waitFor();
    if (await page.locator('.workspace-item').getAttribute('aria-expanded') !== 'true') await page.locator('.workspace-item').click();
    await page.locator('.session-item').click();
    const command = Array.from({length:180},(_,i)=>`echo '${i}: ${'long command '.repeat(15)}'`).join('\n');
    await page.evaluate(command=>window.requestApproval('long',command),command);
    const card = page.locator('.approval-card');
    await card.waitFor();
    const assertActionsReachable = async () => {
      for (const button of await card.getByRole('button').all()) {
        assert.ok(await button.evaluate(node=>{
          const r=node.getBoundingClientRect();
          return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        }),`${kit}/${theme}: approval button must be visible and unobscured`);
      }
    };
    await assertActionsReachable();
    assert.equal(await card.locator('code').textContent(),command);
    const details = card.getByRole('region',{name:'审批详情'});
    assert.ok(await details.evaluate(node=>node.scrollHeight>node.clientHeight),'long command scrolls independently');
    await details.focus();
    await page.keyboard.press('End');
    await details.evaluate(node=>{node.scrollTop=node.scrollHeight;});
    await assertActionsReachable();
    await page.setViewportSize({width:800,height:480});
    await assertActionsReachable();
    await card.getByRole('button',{name:'允许',exact:true}).click();
    await card.waitFor({state:'detached'});
    assert.ok(await page.evaluate(()=>window.densityCalls.some(call=>call.command==='resolve_agent_approval' && call.args.requestId==='long' && call.args.decision==='accept')));
    await page.evaluate(command=>{
      window.requestApproval('first',command,[{id:'reject',kind:'reject',label:'继续规划'},{id:'allow',kind:'allow',label:'批准计划，手动审批编辑'}]);
      window.requestApproval('second','echo short');
    },command);
    await page.locator('.approval-card').nth(1).waitFor();
    for (let i=0; i<2; i++) {
      const button = page.locator('.approval-card').first().getByRole('button').first();
      await button.scrollIntoViewIfNeeded();
      await button.click();
    }
    await page.locator('.approval-card').waitFor({state:'detached'});
    assert.ok(await page.evaluate(()=>window.densityCalls.some(call=>call.command==='resolve_agent_approval' && call.args.requestId==='first' && call.args.optionId==='reject')));
    assert.ok(await page.evaluate(()=>window.densityCalls.some(call=>call.command==='resolve_agent_approval' && call.args.requestId==='second' && call.args.decision==='cancel')));
    assert.deepEqual(errors,[]);
    console.log(`${kit}/${theme}: long command, scrolling, resize and approval dispatch passed`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
