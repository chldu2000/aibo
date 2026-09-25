import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTimelineEntry} from '../packages/presentation-workbench/timeline.js';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
const entry={id:'entry',role:'tool',toolName:'commandExecution',entryType:'tool_call',status:'completed',turnId:'turn',content:'**literal**\n<script>alert(1)</script>\n[link](https://example.invalid)'};
test('tool arguments and diffs remain complete literal text without Markdown actions',()=>{
 for(const value of [entry,{...entry,entryType:'tool_result',content:'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-**old**\n+**new**'}]){
  const nodes=flatten(renderTimelineEntry(value,[]));
  assert.equal(nodes.find(node=>node.tag==='pre').text,value.content);
  assert.ok(nodes.some(node=>node.tag==='details'));
  assert.ok(!nodes.some(node=>node.events||node.tag==='script'||node.tag==='a'));
  assert.ok(nodes.some(node=>node.text==='完成'));
  if(value.entryType==='tool_result')assert.ok(nodes.some(node=>node.text==='命令执行 · 查看 diff'));
 }
});
test('reasoning disclosure keeps its identity during streaming and prose keeps Markdown',()=>{
 const initial={...entry,role:'system',toolName:'reasoning',status:'streaming',content:'## Thinking'};
 const before=flatten(renderTimelineEntry(initial,[]));
 const after=flatten(renderTimelineEntry({...initial,status:'completed',content:'## Thinking\n\nMore thoughts'},[]));
 assert.equal(before.find(node=>node.tag==='details').key,after.find(node=>node.tag==='details').key);
 assert.ok(before.some(node=>node.text==='THINKING'));assert.ok(before.some(node=>node.text==='生成中'));
 assert.ok(after.some(node=>node.tag==='h2'&&flatten(node).some(child=>child.text==='Thinking')));
 const token={operation:'fork',args:['turn'],event:'click',token:'host-issued'};
 assert.ok(!before.some(node=>node.events));
 assert.ok(flatten(renderTimelineEntry({...initial,role:'assistant'},[token])).some(node=>node.events?.click==='host-issued'));
});

 test('timeline groups preserve boundaries, completion counts and message keys',async()=>{
  const {renderTimeline}=await import('../packages/presentation-workbench/timeline.js');
  const {groupTimelineItems}=await import('../packages/presentation-workbench/timeline-model.js');
  const make=(id,role,extra={})=>({...entry,id,role,toolName:null,entryType:'note',content:id,...extra});
  const entries=[make('s1','system'),make('s2','system'),make('reason','system',{toolName:'reasoning'}),make('t1','tool'),make('t2','tool',{status:'failed'}),make('summary','system',{entryType:'compaction'}),make('branch','system',{entryType:'branch_summary'}),make('plain','system',{entryType:null}),make('answer','assistant')];
  assert.deepEqual(groupTimelineItems(entries,true).map(item=>item.kind),['system-group','entry','tool-group','entry','entry','entry','entry']);
  assert.equal(groupTimelineItems(entries).filter(item=>item.kind==='system-group').length,0);
  const trees=renderTimeline(entries,[],true),nodes=trees.flatMap(flatten);
  assert.equal(new Set(nodes.map(node=>node.key)).size,nodes.length);
  assert.ok(nodes.some(node=>node.text==='工具调用 · 2 项 · 1/2 完成'));
  assert.ok(nodes.some(node=>node.text==='系统消息 · 2 项'));
  const extended=renderTimeline([...entries.slice(0,5),make('t3','tool'),...entries.slice(5)],[],true).flatMap(flatten);
  assert.ok(extended.some(node=>node.key==='message-group:tool-group-t1'));
  assert.ok(extended.some(node=>node.key==='message:t1:disclosure'));
 });

test('references render inside collapsed disclosures with readable excerpts, including old snapshots',async()=>{
 const {splitSessionReferences}=await import('../packages/presentation-workbench/session-references.js');
 for(const version of ['v1','v2']){
  const payload=JSON.stringify([{snapshotId:'r',snapshot:{schema:'aibo.session-reference/'+version,sourceSessionId:'s',sourceLabel:'设计讨论',messages:[{role:'user',content:'要解决的问题'},{role:'tool',content:'SECRET_LOG'},{role:'assistant',content:'设计结论'}]}}]);
  const content='请参考\n\n[AIBO_SESSION_REFERENCES]\ntransport description\n'+payload+'\n[/AIBO_SESSION_REFERENCES]';
  assert.equal(splitSessionReferences(content).body,'请参考');
  const tree=renderTimelineEntry({...entry,role:'user',toolName:null,content},[]);const nodes=flatten(tree);
  const disclosure=nodes.find(n=>n.tag==='details');assert.ok(disclosure);assert.ok(!disclosure.attrs?.open);
  assert.ok(nodes.some(n=>n.text==='引用会话 · 设计讨论'));assert.ok(nodes.some(n=>n.text==='设计结论'));
  assert.ok(!JSON.stringify(tree).includes('SECRET_LOG'));assert.ok(!JSON.stringify(tree).includes('AIBO_SESSION_REFERENCES'));assert.ok(!JSON.stringify(tree).includes('transport description'));
 }
 const broken='text\n[AIBO_SESSION_REFERENCES]\nnotice\n[invalid]\n[/AIBO_SESSION_REFERENCES]';
 assert.equal(splitSessionReferences(broken).body,broken);assert.deepEqual(splitSessionReferences(broken).references,[]);
});

test('subagent cards expose a scoped history action instead of rendering their internal JSON',()=>{
 const task={id:'child',parentId:'parent',rootTurnId:'turn',name:'Reader',task:'Read the code',status:'completed',activity:'Found the cause'};
 const nodes=flatten(renderTimelineEntry({...entry,role:'system',toolName:'subagent',content:JSON.stringify(task)},[{operation:'openSubagent',args:['child'],event:'click',token:'child-history'}]));
 assert.ok(nodes.some(node=>node.text==='Reader'));
 assert.ok(nodes.some(node=>node.text==='已完成'));
 assert.ok(nodes.some(node=>node.events?.click==='child-history'));
 assert.ok(!nodes.some(node=>node.text===JSON.stringify(task)));
});
