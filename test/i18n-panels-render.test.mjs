import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import {workspaceFileDiffPresentation} from '../src/lib/app/workspace-file-diff.ts';
import { translate, localizedMessage } from '../packages/i18n/index.js';

test('history message status labels translate while preserving source content and unknown states', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {render} = await server.ssrLoadModule('svelte/server');
    const {language} = await server.ssrLoadModule('/src/lib/i18n/runtime.ts');
    const {default:Panel} = await server.ssrLoadModule('/src/lib/components/app/SessionHistoryPanel.svelte');
    const statuses = ['streaming','completed','failed','queued','interrupted','provider-status','constructor'];
    const items = statuses.map(status => ({id:'status-'+status,sessionId:'s',role:'tool',toolName:'工具原文 {name}',status,content:'正文原文 {content}',createdAt:'2026-10-09',updatedAt:'2026-10-09'}));
    const state = {sessions:[],selectedId:'s',loading:false,error:null,pageNumber:1,page:{session:{id:'s',label:'会话原文 {label}'},items,nextBefore:'raw-cursor'}};
    const original = structuredClone(state);
    for (const locale of ['zh-CN','en','zh-CN']) {
      language.set({preference:locale,locale});
      const html = render(Panel,{props:{state,workspaces:[],workspaceId:'w',desktop:true}}).body;
      for (const status of statuses) {
        const article = html.match(new RegExp(`<article[^>]*id="history-message-status-${status}"[\\s\\S]*?</article>`))?.[0];
        assert.ok(article, `history entry ${status}`);
        const label = statuses.indexOf(status)<5 ? translate(locale,`history.status.${status}`) : status;
        assert.ok(article.replace(/<!--[\s\S]*?-->/g,'').includes(`>${label}</span>`), `${locale}: ${status}: ${article}`);
        assert.ok(article.includes('正文原文 {content}'));
        assert.ok(article.includes('工具原文 {name}'));
      }
      assert.deepEqual(state,original);
    }
  } finally { await server.close(); }
});

test('host panels render the selected language and preserve user content', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const { render } = await server.ssrLoadModule('svelte/server');
    const { language } = await server.ssrLoadModule('/src/lib/i18n/runtime.ts');
    const fixtures = [
      ['WorkspacePreferencesPanel', {state:{value:{trustNewWorkspaces:true},loading:false,saving:false,error:null},desktop:true}, 'workspace.trustNew'],
      ['HostConfirmationPanel', {state:{value:{git:'ask',projectAction:'always-allow'},loading:false,saving:false,error:null},desktop:true}, 'confirmation.title'],
      ['SessionReferencePreferencesPanel', {state:{value:{messageLimit:12},loading:false,saving:false,error:null},desktop:true}, 'references.title'],
      ['NodeRuntimePanel', {state:{pending:null,value:{selected:{source:'managed',version:'24.18.0',path:'/用户目录/node'},hostRequirement:'>=22',issues:[],downloadSupported:true,downloadVersion:'24.18.0'},error:null,notice:null},desktop:true}, 'node.title', '/用户目录/node'],
      ['NodeRuntimePanel', {state:{pending:null,value:{selected:null,hostRequirement:'>=22',downloadSupported:false,downloadVersion:'24.18.0',issues:['原始诊断'],localizedIssues:[{schema:'aibo.host-message/v1',key:'native.node.notFound',params:{}}]},error:null,notice:null},desktop:true}, 'native.node.notFound'],
      ['GlobalSearchPanel', {state:{query:'',kind:null,workspaceId:null,items:[{id:'user-file',kind:'file',title:'用户文件.md',description:'原始说明',target:{source:'file',id:'f'},score:1}],pending:[],errors:[],warnings:[],hasMore:false,limit:50},workspaces:[],preview:null,previewLoading:false,previewError:''}, 'search.placeholder', '用户文件.md'],
      ['ExecutionHistoryPanel', {state:{entries:[],loading:false,errors:[],stopping:[],page:1,hasOlder:false,hasNewer:false},workspaces:[],workspaceId:'w',windowId:'main',desktop:true}, 'history.execution'],
      ['SessionHistoryPanel', {state:{sessions:[],loading:false,error:null,page:null,pageNumber:1},workspaces:[],workspaceId:'w',desktop:true}, 'history.sessions'],
      ['CapabilityHistoryPanel', {state:{source:'events',scopes:[],page:null,pageNumber:1,loadingScopes:false,loadingEvents:false,error:null},desktop:true}, 'history.capabilities'],
      ['FilePreviewPanel', {state:{loading:false,error:null,path:'/用户目录/原文.md',line:1,preview:null}}, 'file.preview', '/用户目录/原文.md'],
      ['FilePreviewPanel', {state:{loading:false,error:localizedMessage('error.operationFailed'),path:'/原文.md',line:1,preview:null}}, 'error.operationFailed', '/原文.md'],
      ['BackgroundTaskCard', {task:{id:'task',name:'用户任务',status:'running',command:'echo 原始命令',activity:'原始活动',exitCode:null,outputPath:null}}, 'background.details', 'echo 原始命令'],
      ['AppOverlays', {notice:{type:'success',message:localizedMessage('app.compacted')},errorMessage:null,archiveConfirmationOpen:false,piNavigationOpen:false}, 'app.compacted'],
      ['MarkdownContent', {content:'用户原文\n\n```js\nconst 原文 = 1;\n```'}, 'markdown.copy', '用户原文'],
      ['PluginManagerPanel', {installations:[],busy:false,installation:{error:localizedMessage('native.error.workspaceTrust'),notice:'',preview:null,undoTargets:[]},lifecycle:{error:localizedMessage('native.error.workspaceWriteBusy'),impact:null,report:null,busy:false}}, 'native.error.workspaceTrust'],
      ['DiagnosticsPanel', {open:true,embedded:true,diagnostics:[],desktop:true,workspaceCount:1,sessionCount:1,busy:false}, 'diagnostics.environment'],
    ];
    for (const [name, props, key, preserved] of fixtures) {
      const { default: Component } = await server.ssrLoadModule(`/src/lib/components/app/${name}.svelte`);
      for (const locale of ['zh-CN','en']) {
        language.set({preference:locale,locale});
        const html = render(Component,{props}).body;
        assert.ok(html.includes(translate(locale,key)), `${name} ${locale}`);
        if (preserved) assert.ok(html.includes(preserved), `${name} preserves source content in ${locale}`);
      }
    }
  } finally {
    await server.close();
  }
});


test('relative Git dates use time values for direction in both languages', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {relativeDateLabel} = await server.ssrLoadModule('/src/lib/components/app/session-utils.ts');
    const now = Date.parse('2026-10-09T12:00:00Z');
    for (const locale of ['zh-CN','en']) {
      assert.equal(relativeDateLabel('2026-10-09T11:58:00Z',locale,now),new Intl.RelativeTimeFormat(locale,{numeric:'always'}).format(-2,'minute'));
      assert.equal(relativeDateLabel('2026-10-09T13:00:00Z',locale,now),new Intl.RelativeTimeFormat(locale,{numeric:'always'}).format(1,'hour'));
      assert.equal(relativeDateLabel('invalid',locale,now),'invalid');
    }
  } finally { await server.close(); }
});

test('malformed settings retain translatable errors after a language change', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {render} = await server.ssrLoadModule('svelte/server');
    const {language} = await server.ssrLoadModule('/src/lib/i18n/runtime.ts');
    for (const [module,create,panel,key] of [
      ['workspace-preferences-controller','createWorkspacePreferencesController','WorkspacePreferencesPanel','error.workspacePreferences'],
      ['host-confirmation-controller','createHostConfirmationController','HostConfirmationPanel','error.confirmationPreferences'],
      ['session-reference-preferences-controller','createSessionReferencePreferencesController','SessionReferencePreferencesPanel','error.referencePreferences'],
      ['node-runtime-controller','createNodeRuntimeController','NodeRuntimePanel','error.nodeStatus'],
    ]) {
      const Controller = await server.ssrLoadModule(`/src/lib/app/${module}.ts`);
      let state;
      const controller = Controller[create]({read:async()=>({}),changed:value=>state=value});
      await (controller.load ? controller.load() : controller.read());
      const {default:Panel} = await server.ssrLoadModule(`/src/lib/components/app/${panel}.svelte`);
      assert.equal(state.error.key,key);
      for (const locale of ['zh-CN','en']) {
        language.set({preference:locale,locale});
        const html = render(Panel,{props:{state,desktop:true}}).body;
        assert.ok(html.includes(translate(locale,key)),`${panel}: ${locale}`);
        assert.ok(!html.includes('[object Object]'));
      }
    }
  } finally {await server.close();}
});


test('file diff reason renders as plain translated text in both languages',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try {
  const {render}=await server.ssrLoadModule('svelte/server');
  const {language}=await server.ssrLoadModule('/src/lib/i18n/runtime.ts');
  const {default:Component}=await server.ssrLoadModule('/src/lib/components/app/WorkspaceFileDiffPreview.svelte');
  const diff={path:'/用户/{reason}.txt',staged:false,available:false,truncated:false,diff:'',hunks:[],reason:'原始诊断',localizedReason:{schema:'aibo.host-message/v1',key:'native.diff.binary',params:{}}};
  for(const locale of ['zh-CN','en']){
   language.set({preference:locale,locale});
   const html=render(Component,{props:{fileDiff:workspaceFileDiffPresentation(diff,locale),fileDiffLoading:false,fileDiffError:null,selectedPath:diff.path,selectedStaged:false,onClose(){}}}).body;
   assert.ok(html.includes(translate(locale,'native.diff.binary')));assert.ok(html.includes(diff.path));assert.ok(!html.includes('原始诊断'));
  }
 }finally{await server.close();}
});
