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
 assert.ok(after.some(node=>node.tag==='h3'&&flatten(node).some(child=>child.text==='Thinking')));
 const token={operation:'fork',args:['turn'],event:'click',token:'host-issued'};
 assert.ok(!before.some(node=>node.events));
 assert.ok(flatten(renderTimelineEntry({...initial,role:'assistant'},[token])).some(node=>node.events?.click==='host-issued'));
});
