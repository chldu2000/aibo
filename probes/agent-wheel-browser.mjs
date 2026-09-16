import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen();
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1200,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/probes/agent-wheel.html`);
  await page.waitForFunction(() => window.agentWheelProbe);
  const installations = Array.from({length:8}, (_, i) => ({id:`installation-${i}`,installed:true,enabled:true,runnable:true,
    contributions:[{id:`example.agent-${i}`,kind:'capabilityProvider',scope:'session',metadata:{
      displayName:`Agent ${i}`, icon:{path:`M${i+1} 2L22 12L12 22Z`},operations:[{capability:{id:'aibo.session.open'}}],
    }}],
  }));
  for (const kit of ['shadcn','material3']) {
    await page.evaluate(kit => window.agentWheelProbe.render(kit), kit);
    await page.getByRole('button',{name:'Wheel test，可信',exact:true}).hover();
    await page.getByRole('button',{name:'新建 Agent 会话',exact:true}).click();
    await page.getByRole('status').filter({hasText:'暂无就绪的 Agent'}).waitFor();
    await page.evaluate(value => window.agentWheelProbe.setInstallations(value), installations);
    await page.waitForFunction(() => document.querySelectorAll('.session-agent-option').length === 8);
    for (let i=0;i<8;i++) {
      const option = page.getByRole('button',{name:`使用 Agent ${i} 创建会话`,exact:true});
      assert.equal(await option.locator('.agent-status-logo path').getAttribute('d'),installations[i].contributions[0].metadata.icon.path);
    }
    assert.match(await page.getByRole('button',{name:'使用 Agent 6 创建会话',exact:true}).getAttribute('style'), /64px/);
    await page.getByRole('button',{name:'使用 Agent 7 创建会话',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => window.agentWheelProbe.calls().at(-1)),['workspace','installation-7','example.agent-7']);
    for (const patch of [{enabled:false},{runnable:false},{installed:false}]) {
      await page.evaluate(value => window.agentWheelProbe.setInstallations(value),[{...installations[0],...patch}]);
      await page.getByRole('status').filter({hasText:'暂无就绪的 Agent'}).waitFor();
      assert.equal(await page.locator('.session-agent-option').count(),0);
    }
    await page.evaluate(value => window.agentWheelProbe.setInstallations(value),[installations[0]]);
    await page.getByRole('button',{name:'使用 Agent 0 创建会话',exact:true}).waitFor();
    await page.getByRole('button',{name:'使用 Agent 0 创建会话',exact:true}).focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.session-agent-wheel'));
    console.log(`${kit}: live discovery, plugin paths, 8 choices / 2 rings, exact creation binding, readiness and Escape passed`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
