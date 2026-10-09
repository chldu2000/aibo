import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {catalogs} from '../packages/i18n/index.js';
import {renderNavigation} from '../packages/presentation-workbench/navigation.js';
import {renderTimelineEntry,renderTimeline} from '../packages/presentation-workbench/timeline.js';
import {renderAttachment,renderExecutionProfile} from '../packages/presentation-workbench/metadata.js';
import {renderWorkbench} from '../packages/presentation-workbench/workbench.js';
import {navigationActions} from '../src/lib/presentation-runtime/navigation.ts';
import {controlInput} from '../src/lib/presentation-runtime/controls.ts';
import {semanticInput} from '../src/lib/presentation-runtime/semantic.ts';
import {buildPresentationSkins} from '../probes/lib/build-presentation-skins.mjs';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
const fixture=async name=>JSON.parse(await readFile(`fixtures/presentation-workbench/${name}.json`,'utf8'));
const authority=tree=>flatten(tree).map(({key,events,primaryEnter,suggestions,resize})=>({key,events,primaryEnter,suggestions,resize}));
test('published presentation translations stay generated from the canonical catalog and use existing keys',async()=>{
 execFileSync(process.execPath,['scripts/build-presentation-i18n.mjs','--check']);
 const files=(await readdir('packages/presentation-workbench')).filter(file=>file.endsWith('.js')&&file!=='i18n.generated.js').map(file=>'packages/presentation-workbench/'+file);
 files.push(...['shadcn','material3'].map(skin=>'packages/presentation-'+skin+'/skin.js'));
 for(const file of files){const source=await readFile(file,'utf8');for(const [,key] of source.matchAll(/\bt\('([^']+)'\s*(?=[,)])/g))assert.ok(Object.hasOwn(catalogs.en,key),`${file}: ${key}`);}
});
test('shared navigation changes chrome while preserving names, paths, keys and tokens',async()=>{
 const state=await fixture('navigation');state.workspaces[0].label='用户项目中文';state.sessionsByWorkspace.w1[0].label='用户会话中文';
 const actions=navigationActions(state),zh=renderNavigation(state,actions),en=renderNavigation(state,actions,'en');
 assert.deepEqual(authority(en),authority(zh));
 const nodes=flatten(en);assert.ok(nodes.some(node=>node.text==='Workspaces'));assert.ok(nodes.some(node=>node.text==='Add workspace'));
 for(const text of ['用户项目中文','用户会话中文'])assert.ok(nodes.some(node=>node.text===text));
 assert.deepEqual(state.workspaces[0].path,flatten(zh).find(node=>node.key==='workspace:w1').attrs.title);
 assert.equal(renderWorkbench({surface:'workbench',data:null,locale:'en'},()=>null).text,'Preparing the workbench');
});
test('timeline and metadata translate chrome and preserve literal payloads and bound actions',()=>{
 const entry={id:'m',role:'tool',toolName:'commandExecution',entryType:'tool_call',status:'completed',content:'用户代码中文 **literal**',turnId:'t'};
 const zh=renderTimelineEntry(entry,[]),en=renderTimelineEntry(entry,[],[],'en');
 assert.deepEqual(authority(en),authority(zh));assert.ok(flatten(en).some(node=>node.text==='Command execution · View call parameters'));
 assert.equal(flatten(en).find(node=>node.tag==='pre').text,entry.content);
 assert.ok(renderTimeline([{...entry,role:'system',toolName:null,content:''},{...entry,id:'n',role:'system',toolName:null,content:'原始系统正文'}],[],true,[],'en').flatMap(flatten).some(node=>node.text==='System message · View details'));
 const attachment=renderAttachment({id:'a',path:'用户路径中文.ts',turnId:null,sendStrategy:'inline',size:12,mediaType:'text/plain',source:'用户来源'},'a','en');
 assert.ok(flatten(attachment).some(node=>node.text==='Pending · Inline · 12 bytes'));
 assert.ok(flatten(attachment).some(node=>node.text==='Source: 用户来源'));
 const profile=renderExecutionProfile({requested:{},enforced:{},adapterCapabilities:[],unsupported:['raw capability 中文'],nativeSandbox:false},'profile','en');
 assert.ok(flatten(profile).some(node=>node.text==='Execution permissions'));assert.ok(flatten(profile).some(node=>node.text==='Not enabled: raw capability 中文'));
});
test('independent skin tarballs translate controls and semantic chrome without translating plugin content',async t=>{
 const built=await buildPresentationSkins();t.after(built.dispose);
 for(const pkg of built.packages){const context={self:{}};vm.runInNewContext(Buffer.from(pkg.resources['skin.js'],'base64').toString(),context);const render=context.self.aiboPresentation.render;
  const props={objective:'用户目标中文',statusLabel:'plugin status 中文',usageLabel:null,busy:false,onPause(){}};
  const input=controlInput('GoalBar',props,{workspaceId:'w',sessionId:'s',revision:1},{},'en');const english=render(input),chinese=render({...input,locale:'zh-CN'});
  assert.deepEqual(JSON.parse(JSON.stringify(authority(english))),JSON.parse(JSON.stringify(authority(chinese))));
  assert.ok(flatten(english).some(node=>node.text==='Pause goal'));assert.ok(flatten(chinese).some(node=>node.text==='暂停目标'));assert.ok(flatten(english).some(node=>node.text===props.objective));
  const detail=JSON.parse(await readFile('fixtures/semantic-git/detail.json','utf8'));detail.view.content='用户正文中文';detail.view.truncated=true;
  const nodes=flatten(render(semanticInput(detail,1,{},'en')));assert.ok(nodes.some(node=>node.text==='用户正文中文'));assert.ok(nodes.some(node=>node.text==='Content truncated'));
 }
});

test('conversation, Git, Inspector and capability pages translate presentation without changing authority or drafts',async()=>{
 const {renderConversation}=await import('../packages/presentation-workbench/conversation.js');
 const {renderGit}=await import('../packages/presentation-workbench/git.js');
 const {renderInspector}=await import('../packages/presentation-workbench/inspector.js');
 const {renderCapability}=await import('../packages/presentation-workbench/capability.js');
 const {createConversationDirectory}=await import('../src/lib/presentation-runtime/conversation.ts');
 const {createGitDirectory}=await import('../src/lib/presentation-runtime/git.ts');
 const {createInspectorDirectory}=await import('../src/lib/presentation-runtime/inspector.ts');
 const {createCapabilityWorkbenchDirectory}=await import('../src/lib/presentation-runtime/capability-workbench.ts');
 for(const [kind,render,create,expected] of [['conversation',renderConversation,createConversationDirectory,'Compose a message'],['git',renderGit,createGitDirectory,'Branches'],['inspector',renderInspector,createInspectorDirectory,'Edit project action'],['capability',renderCapability,createCapabilityWorkbenchDirectory,'Capability view']]){
  const state=await fixture(kind);const actions=create().project(state);const saved=structuredClone(state);
  const semantic=data=>({tag:'pre',key:'semantic-test',text:data.snapshot.view.content});
  const zh=kind==='capability'?render(state,actions,semantic):render(state,actions);
  const en=kind==='capability'?render(state,actions,semantic,'en'):render(state,actions,'en');
  assert.deepEqual(authority(en),authority(zh));assert.deepEqual(state,saved);
  const nodes=flatten(en);assert.ok(nodes.some(node=>node.text===expected),kind);
  const values=tree=>flatten(tree).filter(node=>node.attrs?.value!==undefined).map(node=>[node.key,node.attrs.value]);
  assert.deepEqual(values(en),values(zh),`${kind} preserves drafts and selection IDs`);
  for(const node of nodes)for(const [event,token]of Object.entries(node.events??{}))assert.ok(actions.some(action=>action.token===token&&action.event===event));
 }
});

test('tool labels and disconnected task fallbacks change language while preserving provider payloads',async()=>{
 const {toolLabel}=await import('../packages/presentation-workbench/timeline-model.js');
 const {parseBackgroundTask}=await import('../packages/presentation-workbench/background-tasks.js');
 const item={toolName:'commandExecution',content:'echo 原文中文'};
 assert.equal(toolLabel(item,'en'),'Command execution · echo 原文中文');assert.equal(toolLabel(item),'命令执行 · echo 原文中文');
 assert.equal(toolLabel({toolName:'providerTool',content:'用户原文'},'en'),'provider Tool · 用户原文');
 const task={id:'task',rootTurnId:'turn',name:'用户任务',command:'echo 原文',activity:'原始活动',status:'running'};
 const entry={toolName:'background_task',content:JSON.stringify(task),status:'streaming'};
 assert.deepEqual(parseBackgroundTask(entry,'en'),task);
 const stopped={...entry,status:'completed'};
 assert.equal(parseBackgroundTask(stopped,'en').status,'unknown');
 assert.equal(parseBackgroundTask(stopped,'en').activity,'The connection was lost; the task may still be running.');
 assert.equal(parseBackgroundTask(stopped).activity,'连接已中断，无法确认任务是否仍在运行。');
 assert.equal(stopped.content,entry.content);
});


test('restore audit status titles translate without changing stored statuses or original paths',async()=>{
 const {renderInspector}=await import('../packages/presentation-workbench/inspector.js');
 const state=await fixture('inspector');
 state.restoreOperations=['completed','blocked','failed','provider-status'].map(status=>({id:status,status,restored:['原始{path}.txt'],conflicts:[],unsupported:['原始原因']}));
 const original=structuredClone(state),zh=flatten(renderInspector(state,[],'zh-CN')),en=flatten(renderInspector(state,[],'en'));
 for(const [status,english,chinese] of [['completed','Restored','已恢复'],['blocked','Blocked','已阻止'],['failed','Restore failed','恢复失败'],['provider-status','provider-status','provider-status']]){
  assert.equal(en.find(node=>node.key==='restore:'+status).children[0].text,english);
  assert.equal(zh.find(node=>node.key==='restore:'+status).children[0].text,chinese);
 }
 assert.deepEqual(state,original);assert.ok(en.some(node=>node.text?.includes('原始{path}.txt')));assert.ok(en.some(node=>node.text?.includes('原始原因')));
});

test('external runtime diagnostic labels translate known statuses while preserving raw values, identities and action authority',async()=>{
 const {renderInspector}=await import('../packages/presentation-workbench/inspector.js');
 const state=await fixture('inspector');
 state.diagnostics=[['ready','delegated','Available · System credentials','可用 · 系统凭据'],['missing','not_required','Not installed · Not required','未安装 · 无需认证'],['error','unknown','Error · Unknown','异常 · 未知'],['provider-status','provider-auth','provider-status · provider-auth','provider-status · provider-auth']].map(([status,authState,en,zh],index)=>({agent:'third.party:'+index,label:'程序原文 {label} '+index,status,authState,en,zh,version:'version {raw}',executable:'/用户/{path}',message:'提供者原文 {message}',capabilities:['capability.raw']}));
 const original=structuredClone(state),english=renderInspector(state,[],'en'),chinese=renderInspector(state,[],'zh-CN');
 assert.deepEqual(authority(english),authority(chinese));
 const en=flatten(english),zh=flatten(chinese);
 for(const item of state.diagnostics){
  assert.equal(en.find(node=>node.key==='diagnostic:status:'+item.agent).text,item.en);
  assert.equal(zh.find(node=>node.key==='diagnostic:status:'+item.agent).text,item.zh);
  for(const nodes of [en,zh]){assert(nodes.some(node=>node.text===item.label));assert(nodes.some(node=>node.text===item.message));assert(nodes.some(node=>node.text===item.version));}
 }
 assert.deepEqual(state,original);
});
