import {node,section,text} from './tree.js';
const labels={interactionMode:{ask:'问答',plan:'计划',edit:'编辑'},filesystemPolicy:{'read-only':'只读','workspace-write':'工作区可写','danger-full-access':'完整文件访问'},commandPolicy:{disabled:'禁用',approved:'需审批',trusted:'自动执行'},networkPolicy:{disabled:'禁用','agent-managed':'Agent 管理'},approvalPolicy:{never:'从不请求审批',untrusted:'未信任操作需审批','on-request':'按请求审批',trusted:'信任模式'},approvalReviewer:{user:'用户','auto-review':'自动审核',none:'无'}};
export function renderExecutionProfile(profile,key){
 if(!profile)return null;
 const fields=[['interactionMode','模式'],['filesystemPolicy','文件'],['commandPolicy','命令'],['networkPolicy','网络'],['approvalPolicy','审批'],['approvalReviewer','审核者'],['model','模型'],['reasoningEffort','推理强度']];
 const value=(field,value)=>value==null?'默认':labels[field]?.[value]??value;
 return section(key,'执行权限',[text(key+':sandbox',profile.nativeSandbox?'原生沙箱':'无原生沙箱'),node('table',key+':table',null,[node('thead',key+':head',null,[node('tr',key+':columns',null,['设置','请求值','实际生效'].map((label,i)=>node('th',key+':column:'+i,label)))]),node('tbody',key+':body',null,fields.map(([field,label])=>node('tr',key+':row:'+field,null,[node('th',key+':label:'+field,label),node('td',key+':requested:'+field,value(field,profile.requested[field])),node('td',key+':enforced:'+field,value(field,profile.enforced[field]))])))]),...(profile.unsupported??[]).map((item,i)=>node('p',key+':unsupported:'+i,'未启用：'+item,[],{role:'status'})),text(key+':resolved',profile.resolvedAt?'更新于 '+profile.resolvedAt:null),section(key+':capabilities','Agent 能力',(profile.adapterCapabilities??[]).length?profile.adapterCapabilities.map((item,i)=>text(key+':capability:'+i,item)):[text(key+':no-capabilities','未报告额外能力')])]);
}
export function renderAttachment(item,key){
 return node('div',key,null,[text(key+':path',item.path),text(key+':state',`${item.turnId?'已发送':'待发送'} · ${item.sendStrategy==='reference'?'工作区引用':item.sendStrategy==='inline'?'内联':item.sendStrategy??'发送方式未提供'}${item.size==null?'':` · ${item.size} 字节`}`),text(key+':media',item.mediaType),text(key+':source',item.source?'来源：'+item.source:null)]);
}
export function renderSessionMetadata(session,key){
 if(!session)return null;
 return node('details',key,null,[node('summary',key+':summary','会话信息'),text(key+':id','会话 ID：'+session.id),text(key+':external',session.externalSessionId?'远端绑定：'+session.externalSessionId:null),text(key+':updated',session.updatedAt?'更新于 '+session.updatedAt:null),text(key+':archived',session.archived?'已归档':null)]);
}
