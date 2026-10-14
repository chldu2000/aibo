import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '/tmp/aibo-record-cards';
await mkdir(output, {recursive:true});
const make = (id, role, content, extra={}) => ({id,sessionId:'a',turnId:'turn',externalMessageId:null,role,toolName:null,entryType:'message',content,status:'completed',createdAt:'2026-09-24T14:32:00+08:00',updatedAt:'2026-09-24T14:32:00+08:00',...extra});
const entries = [
  make('u','user','使用 ak-ui 改造 Aibo 的默认界面。导航和工作区在同一主题下保持统一明暗，保留会话与代码变更的工作流。'),
  make('a','assistant','## 先统一密度和选中语言，再处理装饰。\n\n当前实现同时叠加了旧的紧凑样式和 ak-ui 覆盖，导致 44px 控件里出现 9px 文字。\n\n- **密度**：命中区保持 44px，可见控件收紧到 32–36px。\n- **层级**：正文 14px，界面 13px，元信息 12px，不再更小。\n- **信号**：黄色只表示操作，蓝色只表示当前与焦点，`--ak-signal-*` 不借作他用。',{createdAt:'2026-09-24T14:33:00+08:00'}),
  ...[['read','src/lib/ui-kit/kits/ak-ui.css',100],['search','font-size: (8|9|10)px',200],['shell','pnpm run check:types',12400],['shell','node --test test/ui-style-boundaries.test.mjs',3100]].map(([toolName,content,ms],i)=>make('tool'+i,'tool',content,{toolName,entryType:'tool_result',status:i===3?'failed':'completed',createdAt:'2026-09-24T06:33:00Z',updatedAt:new Date(Date.parse('2026-09-24T06:33:00Z')+ms).toISOString()})),
];
entries.push(make('reasoning','system','**Considering changes**\n\nReasoning content with a long line that wraps inside the card.',{toolName:'reasoning'}),make('single','tool','Everything up-to-date\n'+ 'long-output-'.repeat(100),{toolName:'shell',entryType:'tool_result'}));
const server=await createServer({cacheDir:'/tmp/aibo-record-card-vite',optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
  name:'conversation-design-fixture',enforce:'pre',transform(code,id){
    if(!id.endsWith('/src/App.svelte'))return;
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces;
      workspaceSessionMap = {'preview-workspace':[{id:'a',workspaceId:'preview-workspace',agent:'independent-provider',label:'会话区域对齐设计稿',state:'running',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:['session.fork'],createdAt:'2026-09-24',updatedAt:'2026-09-24'}]};
      window.conversationFixture = () => { timeline=${JSON.stringify(entries)}; };
      setTimeout(()=>{selectedSessionId='a';sidePanelView='context';},100);
      `);
  }
}]});
await server.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.stack));
try {
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  for (const kitId of ['material3','ak-ui']) for (const themeId of ['light','dark']) {
    await page.addInitScript(({kitId,themeId})=>localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId,themeId})),{kitId,themeId});
    await page.goto(origin);
    await page.waitForFunction(()=>typeof window.conversationFixture==='function');
    await page.locator('[data-composer-input]').waitFor();
    await page.evaluate(()=>window.conversationFixture());
    const cards=page.locator('.tool-group-entry');
    await cards.nth(2).waitFor();
    const metrics=await cards.evaluateAll(nodes=>nodes.map(n=>{
      const s=n.querySelector(':scope > details > summary'), c=getComputedStyle(n), h=getComputedStyle(s);
      return {height:n.getBoundingClientRect().height,background:c.backgroundColor,border:c.border,radius:c.borderRadius,padding:c.padding,font:h.font,fontColor:h.color,summaryHeight:s.getBoundingClientRect().height};
    }));
    assert.equal(metrics.length,3);
    assert.deepEqual(metrics[1],metrics[0],`${kitId}/${themeId}: reasoning matches grouped card`);
    assert.deepEqual(metrics[2],metrics[0],`${kitId}/${themeId}: single tool matches grouped card`);
    for(const card of await cards.all()) {
      await card.locator(':scope > details > summary').focus();await page.keyboard.press('Enter');
      assert(await card.locator(':scope > details').evaluate(n=>n.open));
    }
    await cards.first().locator('.tool-output > summary').first().click();
    const insets=await page.locator('.tool-record-content').evaluateAll(nodes=>nodes.filter(n=>n.closest('details').open).map(n=>{
      const card=n.closest('.tool-group-entry').getBoundingClientRect(),content=n.firstElementChild.getBoundingClientRect();
      return {left:content.left-card.left,right:card.right-content.right};
    }));
    assert.equal(insets.length,3);
    for(const inset of insets){ assert(inset.left>1);assert.equal(inset.left,inset.right);assert.deepEqual(inset,insets[0]); }
    await page.locator('.timeline-feed').screenshot({path:`${output}/records-${kitId}-${themeId}.png`});
    for(const width of [1024,700]) {
      await page.setViewportSize({width,height:1000});
      assert(await cards.evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),'expanded cards fit narrow panes');
    }
    await page.setViewportSize({width:1440,height:1000});
  }
  assert.deepEqual(errors,[]);
  console.log(`Record card checks passed in both kits and themes. Screenshots: ${output}`);
} finally {await browser.close();await server.close();}
