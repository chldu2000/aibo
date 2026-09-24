import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '/tmp/aibo-conversation-design';
await mkdir(output, {recursive:true});
const icon = 'M12 2 22 12 12 22 2 12Z';
const make = (id, role, content, extra={}) => ({id,sessionId:'a',turnId:'turn',externalMessageId:null,role,toolName:null,entryType:'message',content,status:'completed',createdAt:'2026-09-24T14:32:00+08:00',updatedAt:'2026-09-24T14:32:00+08:00',...extra});
const entries = [
  make('u','user','使用 ak-ui 改造 Aibo 的默认界面。导航和工作区在同一主题下保持统一明暗，保留会话与代码变更的工作流。'),
  make('a','assistant','## 先统一密度和选中语言，再处理装饰。\n\n当前实现同时叠加了旧的紧凑样式和 ak-ui 覆盖，导致 44px 控件里出现 9px 文字。\n\n- **密度**：命中区保持 44px，可见控件收紧到 32–36px。\n- **层级**：正文 14px，界面 13px，元信息 12px，不再更小。\n- **信号**：黄色只表示操作，蓝色只表示当前与焦点，`--ak-signal-*` 不借作他用。',{createdAt:'2026-09-24T14:33:00+08:00'}),
  ...[['read','src/lib/ui-kit/kits/ak-ui.css',100],['search','font-size: (8|9|10)px',200],['shell','pnpm run check:types',12400],['shell','node --test test/ui-style-boundaries.test.mjs',3100]].map(([toolName,content,ms],i)=>make('tool'+i,'tool',content,{toolName,entryType:'tool_result',status:i===3?'failed':'completed',createdAt:'2026-09-24T06:33:00Z',updatedAt:new Date(Date.parse('2026-09-24T06:33:00Z')+ms).toISOString()})),
];
const provider = {id:'fixture',installed:true,enabled:true,runnable:true,activationIssues:[],contributions:[{id:'independent-provider',kind:'capabilityProvider',scope:'session',metadata:{displayName:'Agent A',icon:{path:icon},operations:[{capability:{id:'aibo.session.open'}}]}}]};
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
  name:'conversation-design-fixture',enforce:'pre',transform(code,id){
    if(!id.endsWith('/src/App.svelte'))return;
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces;
      workspaceSessionMap = {'preview-workspace':[{id:'a',workspaceId:'preview-workspace',agent:'independent-provider',label:'会话区域对齐设计稿',state:'running',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:['session.fork'],createdAt:'2026-09-24',updatedAt:'2026-09-24'}]};
      window.conversationFixture = (mode) => {
        if(mode==='long') timeline=[...Array.from({length:60},(_,i)=>({...${JSON.stringify(entries[1])},id:'long'+i,content:'较早消息 '+i+'\\n\\n'+('保留历史滚动位置。'.repeat(30))})),...${JSON.stringify(entries)}];
        if(mode==='missing') { timeline=${JSON.stringify(entries)}.map(item=>({...item,createdAt:undefined,updatedAt:undefined})); pluginInstallations=[]; }
        if(mode==='waiting') workspaceSessionMap['preview-workspace'][0].state='waiting_user';
        if(mode==='empty') timeline=[];
        if(mode==='restore') {timeline=${JSON.stringify(entries)};pluginInstallations=[${JSON.stringify(provider)}];workspaceSessionMap['preview-workspace'][0].state='running';}
      };
      setTimeout(()=>{selectedSessionId='a';sidePanelView='context';},100);
      setTimeout(()=>{pluginInstallations=[${JSON.stringify(provider)}];timeline=${JSON.stringify(entries)};agentActivityOverrides={a:'正在编辑 ak-ui.css · 42s'};composerText='未发送的草稿';},350);`);
  }
}]});
await server.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.addInitScript(()=>localStorage.setItem('aibo.appearance.v1',JSON.stringify({kitId:'ak-ui',themeId:'light'})));
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(origin);
  await page.locator('.assistant-entry').waitFor();
  const summary=page.locator('.tool-group > summary');
  for(const theme of ['light','dark']) {
    if(await page.locator('.app-shell').getAttribute('data-ui-theme')!==theme)await page.getByRole('button',{name:'切换明暗主题',exact:true}).click();
    await page.locator('.timeline-feed').evaluate(el=>el.scrollTop=0);
    assert.equal(await page.locator('.assistant-entry .entry-author').innerText(),'Agent A');
    assert.equal(await page.locator('.assistant-entry time').innerText(),'14:33');
    assert.equal(await page.locator('.user-entry time').innerText(),'14:32');
    assert.equal(await page.locator('.assistant-entry .agent-status-logo path').getAttribute('d'),icon);
    assert.match(await summary.innerText(),/4 个工具调用[\s\S]*1 个失败[\s\S]*15.8s/);
    const metrics=await page.locator('.timeline-feed-content').evaluate(root=>{
      const style=selector=>getComputedStyle(root.querySelector(selector));
      return {gap:getComputedStyle(root).gap,h2:style('.markdown-heading-2').fontSize,weight:style('.markdown-heading-2').fontWeight,listGap:style('.markdown-list').gap,border:style('.tool-group-entry').borderWidth,radius:style('.tool-group-entry').borderRadius,summary:style('.tool-group > summary').minHeight,activityBorder:style('.agent-activity').borderWidth};
    });
    assert.deepEqual(metrics,{gap:'24px',h2:'17px',weight:'650',listGap:'4px',border:'1px',radius:'0px',summary:'44px',activityBorder:'0px'});
    assert.equal(await page.locator('.timeline-feed-content > .agent-activity .tone-running').count(),1);
    await page.locator('.timeline-feed').screenshot({path:`${output}/conversation-${theme}.png`});
    await summary.focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('.tool-group').getAttribute('open'),'');
    const rows=page.locator('.tool-group-items .tool-output');
    assert.equal(await rows.count(),4);
    assert.equal(await rows.first().locator('summary').evaluate(el=>el.getBoundingClientRect().height),36);
    await rows.first().locator('summary').focus();await page.keyboard.press('Enter');
    assert.equal(await rows.first().locator('pre').innerText(),'src/lib/ui-kit/kits/ak-ui.css');
    await page.keyboard.press('Enter');
    await page.locator('.timeline-feed').screenshot({path:`${output}/expanded-${theme}.png`});
    await summary.click();
    assert.equal(await page.locator('[data-composer-input]').inputValue(),'未发送的草稿');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.agent-activity .agent-status-orbit').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.evaluate(()=>window.conversationFixture('waiting'));
  assert.equal(await page.locator('.agent-activity .tone-attention').count(),1);
  assert.equal(await page.locator('.agent-activity .agent-status-orbit').count(),0);
  await page.evaluate(()=>window.conversationFixture('missing'));
  assert.equal(await page.locator('.entry-meta time').count(),0);
  assert(!/15\.8s/.test(await summary.innerText()));
  assert.equal(await page.locator('.assistant-entry .agent-status-logo path').count(),1,'missing plugin keeps a fallback icon');
  await page.evaluate(()=>window.conversationFixture('restore'));
  await page.evaluate(()=>window.conversationFixture('long'));
  const feed=page.locator('.conversation-tab-content .timeline-feed');
  await feed.evaluate(el=>{el.scrollTop=100;el.dispatchEvent(new Event('scroll'));});
  const scrollBefore=await feed.evaluate(el=>el.scrollTop);
  await page.evaluate(()=>window.conversationFixture('waiting'));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await feed.evaluate(el=>el.scrollTop),scrollBefore,'activity changes preserve a reader scrolled into history');
  await page.evaluate(()=>window.conversationFixture('restore'));
  for (const width of [1024,390]) {
    await page.setViewportSize({width,height:900});
    await page.locator('.timeline-feed').evaluate(el=>el.scrollTop=0);
    assert(await page.locator('[data-composer-input]').isVisible());
    await page.screenshot({path:`${output}/viewport-${width}.png`});
    const overflow=await page.locator('.timeline-feed').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
    assert(overflow.scroll<=overflow.client+1,`feed at ${width}px has no horizontal overflow: ${JSON.stringify(overflow)}`);
    await summary.click();
    assert(await page.locator('.tool-group').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'expanded tools fit the narrow pane');
    await page.screenshot({path:`${output}/viewport-${width}.png`});
    await summary.click();
  }
  await page.evaluate(()=>window.conversationFixture('empty'));
  assert.equal(await page.locator('.agent-activity').count(),1,'activity remains available before the first message');
  assert.deepEqual(errors,[]);
  const design=await browser.newPage({viewport:{width:1440,height:1000}});
  await design.goto(origin+'/docs/design/ak-ui-redesign.html');
  await design.locator('#view-chat .assistant').waitFor();
  await design.locator('.feed').screenshot({path:`${output}/reference.png`});
  console.log(`Conversation design checks passed. Screenshots: ${output}`);
} finally {await browser.close();await server.close();}
