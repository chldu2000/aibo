import {node,button,text,actionFor} from './tree.js';
import {renderRichText} from './rich-text.js';
import {groupTimelineItems} from './timeline-model.js';

export function renderTimeline(entries,actions,groupSystemItems=false){
 return groupTimelineItems(entries,groupSystemItems).map(group=>{
  if(group.kind==='entry')return renderTimelineEntry(group.item,actions);
  const key='message-group:'+group.id;
  const tool=group.kind==='tool-group';
  const completed=group.items.filter(item=>item.status==='completed').length;
  return node('details',key,null,[
   node('summary',key+':summary',tool?`工具调用 · ${group.items.length} 项 · ${completed}/${group.items.length} 完成`:`系统消息 · ${group.items.length} 项`),
   ...group.items.map(entry=>{
    if(tool)return renderTimelineEntry(entry,actions);
    return node('details','message:'+entry.id+':disclosure',null,[
     node('summary','message:'+entry.id+':summary',(entry.content.split('\n')[0]||'系统消息')+' · 查看详情'),
     renderTimelineEntry(entry,actions),
    ]);
   }),
  ]);
 });
}

const timelineStatusLabels={streaming:'生成中',completed:'完成',failed:'失败',queued:'排队中',interrupted:'已中断'};
const timelineToolLabels={commandExecution:'命令执行',fileRead:'读取文件',fileChange:'修改文件',mcpToolCall:'MCP 工具',webSearch:'网页搜索'};

/** Tool payloads are literal text; only conversational prose uses Markdown. */
export function renderTimelineEntry(entry,actions){
 const key='message:'+entry.id;
 const reasoning=entry.role==='system'&&entry.toolName==='reasoning';
 const header=node('header','message:header:'+entry.id,null,[
  node('strong','message:role:'+entry.id,reasoning?'THINKING':entry.role.toUpperCase()),
  text('message:tool:'+entry.id,entry.toolName),text('message:type:'+entry.id,entry.entryType),
  text('message:status:'+entry.id,timelineStatusLabels[entry.status]??entry.status),
 ]);
 let content;
 if(entry.role==='tool'){
  const diff=/(^diff --git |^@@ |^\+\+\+ |^--- )/m.test(entry.content);
  const name=entry.toolName?.trim();
  const label=timelineToolLabels[name]??name??'工具操作';
  const hint=entry.entryType==='tool_call'?'查看调用参数':diff?'查看 diff':'查看工具输出';
  content=node('details',key+':disclosure',null,[node('summary',key+':summary',`${label} · ${hint}`),
   {...node('pre','message:content:'+entry.id,entry.content||'…'),className:diff?'tool-output diff-content':'tool-output'},
  ]);
 }else{
  content=renderRichText(entry.content||'…','message:content:'+entry.id,entry.id,actions);
  if(reasoning)content=node('details',key+':disclosure',null,[node('summary',key+':summary','思考 · 查看详情'),content]);
 }
 const fork=entry.role==='assistant'&&entry.turnId&&actionFor(actions,'fork',entry.turnId);
 return node('article',key,null,[header,content,fork?button('message:fork:'+entry.id,'从此处分叉',fork):null]);
}
