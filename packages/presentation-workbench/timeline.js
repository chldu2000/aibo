import {presentationTranslator} from './i18n.js';
import {parseBackgroundTask} from './background-tasks.js';
import {splitMessageAttachments} from './message-attachments.js';
import {renderMessageAttachment} from './metadata.js';
import {splitSessionReferences} from './session-references.js';
import {node,button,text,actionFor} from './tree.js';
import {renderRichText} from './rich-text.js';
import {groupTimelineItems} from './timeline-model.js';

export function renderTimeline(entries,actions,groupSystemItems=false,attachments=[],locale='zh-CN'){
 const t=presentationTranslator(locale);
 return groupTimelineItems(entries,groupSystemItems).map(group=>{
  if(group.kind==='entry')return renderTimelineEntry(group.item,actions,attachments,locale);
  const key='message-group:'+group.id;
  const tool=group.kind==='tool-group';
  const completed=group.items.filter(item=>item.status==='completed').length;
  return node('details',key,null,[
   node('summary',key+':summary',tool?t('external.toolGroup',{count:group.items.length,completed}):t('external.systemGroup',{count:group.items.length})),
   ...group.items.map(entry=>{
    if(tool)return renderTimelineEntry(entry,actions,attachments,locale);
    return node('details','message:'+entry.id+':disclosure',null,[
     node('summary','message:'+entry.id+':summary',t('external.viewDetails',{title:entry.content.split('\n')[0]||t('timeline.systemMessage')})),
     renderTimelineEntry(entry,actions,attachments,locale),
    ]);
   }),
  ]);
 });
}


/** Tool payloads are literal text; only conversational prose uses Markdown. */
export function renderTimelineEntry(entry,actions,attachments=[],locale='zh-CN'){
 const t=presentationTranslator(locale);
 const timelineStatusLabels={streaming:t('timeline.streaming'),completed:t('timeline.completed'),failed:t('timeline.failed'),queued:t('timeline.queued'),interrupted:t('timeline.interrupted')};
 const timelineToolLabels={commandExecution:t('external.toolCommand'),fileRead:t('external.toolRead'),fileChange:t('external.toolChange'),mcpToolCall:t('external.toolMcp'),webSearch:t('external.toolWeb')};
 const key='message:'+entry.id;
 const background = parseBackgroundTask(entry,locale);
 if(background)return node('article',key,null,[node('strong',key+':name',t('external.backgroundName',{name:background.name})),text(key+':status',t('background.status.'+background.status)),node('pre',key+':command',background.command),node('pre',key+':activity',background.activity),text(key+':id',t('external.taskId',{id:background.id})),background.exitCode!=null?text(key+':exit',t('external.exitCode',{code:background.exitCode})):null,background.outputPath?node('pre',key+':output',background.outputPath):null]);
 if(entry.toolName==='subagent') {
  try {
   const child=JSON.parse(entry.content);
   const labels={pending:t('subagent.status.pending'),running:t('subagent.status.running'),waiting:t('subagent.status.waiting'),completed:t('markdown.completed'),failed:t('timeline.failed'),interrupted:t('timeline.interrupted'),closed:t('subagent.status.closed'),unavailable:t('subagent.status.unavailable')};
   return node('article',key,null,[node('strong',key+':name',child.name),text(key+':status',labels[child.status]??child.status),text(key+':task',child.task),text(key+':activity',child.activity),button(key+':open',t('subagent.viewProcess'),actionFor(actions,'openSubagent',child.id))]);
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
  const label=timelineToolLabels[name]??name??t('external.toolOperation');
  const hint=entry.entryType==='tool_call'?t('timeline.parameters'):diff?t('timeline.viewDiff'):t('subagent.viewTool');
  content=node('details',key+':disclosure',null,[node('summary',key+':summary',`${label} · ${hint}`),
   {...node('pre','message:content:'+entry.id,entry.content||'…'),className:diff?'tool-output diff-content':'tool-output'},
  ]);
 }else{
  const attached=entry.role==='user'?splitMessageAttachments(entry.content,attachments):{body:entry.content,attachments:[]};
  const message=entry.role==='user'?splitSessionReferences(attached.body):{body:entry.content,references:[]};
  content=node('div',key+':body',null,[message.body?renderRichText(message.body,'message:content:'+entry.id,entry.id,actions,locale):message.references.length||attached.attachments.length?null:text(key+':empty','…'),
   ...attached.attachments.map(item=>renderMessageAttachment(item,key+':attachment:'+item.id)),
   ...message.references.map((reference,index)=>{const refKey=key+':reference:'+index;return node('details',refKey,null,[
    node('summary',refKey+':title',t('external.referenceTitle',{title:reference.title})),
    text(refKey+':note',reference.omitted===null?reference.agent+' · '+reference.note:t('external.referenceOmitted',{agent:reference.agent,note:reference.note,count:reference.omitted})),
    ...reference.excerpts.flatMap((excerpt,i)=>[text(refKey+':role:'+i,(excerpt.role==='user'?t('role.user'):t('role.assistant'))+(excerpt.truncated?t('timeline.excerptTruncated'):'')),node('pre',refKey+':text:'+i,excerpt.text)]),
   ]);}),
  ]);
  if(reasoning)content=node('details',key+':disclosure',null,[node('summary',key+':summary',t('timeline.reasoningDetails')),content]);
 }
 const fork=entry.role==='assistant'&&entry.turnId&&actionFor(actions,'fork',entry.turnId);
 return node('article',key,null,[header,content,fork?button('message:fork:'+entry.id,t('external.forkFromHere'),fork):null]);
}
