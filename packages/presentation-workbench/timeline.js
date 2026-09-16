import {splitSessionReferences} from './session-references.js';
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
 if(entry.toolName==='subagent') {
  try {
   const child=JSON.parse(entry.content);
   const labels={pending:'正在启动',running:'运行中',waiting:'等待输入',completed:'已完成',failed:'失败',interrupted:'已中断',closed:'已关闭',unavailable:'过程暂不可用'};
   return node('article',key,null,[node('strong',key+':name',child.name),text(key+':status',labels[child.status]??child.status),text(key+':task',child.task),text(key+':activity',child.activity),button(key+':open','查看工作过程',actionFor(actions,'openSubagent',child.id))]);
  } catch { /* Retain a readable fallback for older malformed history. */ }
 }

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
  const message=entry.role==='user'?splitSessionReferences(entry.content):{body:entry.content,references:[]};
  content=node('div',key+':body',null,[message.body?renderRichText(message.body,'message:content:'+entry.id,entry.id,actions):message.references.length?null:text(key+':empty','…'),
   ...message.references.map((reference,index)=>{const refKey=key+':reference:'+index;return node('details',refKey,null,[
    node('summary',refKey+':title','引用会话 · '+reference.title),
    text(refKey+':note',reference.agent+' · '+reference.note+(reference.omitted===null?'':' · 已省略 '+reference.omitted+' 条消息')),
    ...reference.excerpts.flatMap((excerpt,i)=>[text(refKey+':role:'+i,(excerpt.role==='user'?'用户':'助手')+(excerpt.truncated?' · 已截取':'')),node('pre',refKey+':text:'+i,excerpt.text)]),
   ]);}),
  ]);
  if(reasoning)content=node('details',key+':disclosure',null,[node('summary',key+':summary','思考 · 查看详情'),content]);
 }
 const fork=entry.role==='assistant'&&entry.turnId&&actionFor(actions,'fork',entry.turnId);
 return node('article',key,null,[header,content,fork?button('message:fork:'+entry.id,'从此处分叉',fork):null]);
}
