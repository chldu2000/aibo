import {presentationTranslator} from './i18n.js';
import {formatDateTime} from './i18n.generated.js';
import {node,section,text} from './tree.js';
export function renderExecutionProfile(profile,key,locale='zh-CN'){
 const t=presentationTranslator(locale);
 const labels={interactionMode:{ask:t('inspector.ask'),plan:t('inspector.plan'),edit:t('common.edit')},filesystemPolicy:{'agent-managed':t('inspector.nativePermissions'),'read-only':t('git.readOnly'),'workspace-write':t('inspector.workspaceWrite'),'danger-full-access':t('external.fullFileAccess')},commandPolicy:{'agent-managed':t('inspector.nativePermissions'),disabled:t('inspector.disabled'),approved:t('inspector.approvalRequired'),trusted:t('inspector.automatic')},networkPolicy:{disabled:t('inspector.disabled'),'agent-managed':t('inspector.agentManaged')},approvalPolicy:{never:t('external.neverApprove'),untrusted:t('external.approveUntrusted'),'on-request':t('external.approveOnRequest'),trusted:t('external.trustMode')},approvalReviewer:{user:t('role.user'),'auto-review':t('external.autoReview'),none:t('external.none')}};
 if(!profile)return null;
 const fields=[['interactionMode',t('inspector.mode')],['filesystemPolicy',t('inspector.file')],['commandPolicy',t('inspector.command')],['networkPolicy',t('inspector.network')],['approvalPolicy',t('inspector.approval')],['approvalReviewer',t('inspector.reviewer')],['model',t('composer.model')],['reasoningEffort',t('composer.reasoning')]];
 const value=(field,value)=>value==null?t('app.defaultModel'):labels[field]?.[value]??value;
 return section(key,t('external.executionPermissions'),[text(key+':sandbox',profile.agentManagedPermissions?t('external.agentPermissions'):profile.nativeSandbox?t('inspector.nativeSandbox'):t('inspector.noNativeSandbox')),node('table',key+':table',null,[node('thead',key+':head',null,[node('tr',key+':columns',null,[t('search.kind.setting'),t('external.requestedValue'),t('external.enforcedValue')].map((label,i)=>node('th',key+':column:'+i,label)))]),node('tbody',key+':body',null,fields.map(([field,label])=>node('tr',key+':row:'+field,null,[node('th',key+':label:'+field,label),node('td',key+':requested:'+field,value(field,profile.requested[field])),node('td',key+':enforced:'+field,value(field,profile.enforced[field]))])))]),...(profile.unsupported??[]).map((item,i)=>node('p',key+':unsupported:'+i,t('external.profileUnsupported',{message:item}),[],{role:'status'})),text(key+':resolved',profile.resolvedAt?t('external.updatedAt',{date:formatDateTime(locale,profile.resolvedAt,{dateStyle:'medium',timeStyle:'short'})}):null),section(key+':capabilities',t('inspector.agentCapabilities'),(profile.adapterCapabilities??[]).length?profile.adapterCapabilities.map((item,i)=>text(key+':capability:'+i,item)):[text(key+':no-capabilities',t('external.noExtraCapabilities'))])]);
}
export function renderAttachment(item,key,locale='zh-CN'){
 const t=presentationTranslator(locale);
 return node('div',key,null,[text(key+':path',item.displayName??item.path),text(key+':state',t('external.attachmentState',{state:item.turnId?t('inspector.sent'):t('inspector.pending'),strategy:item.sendStrategy==='reference'?t('external.workspaceReference'):item.sendStrategy==='inline'?t('inspector.inline'):item.sendStrategy??t('external.missingSendStrategy'),size:item.size==null?'':t('external.bytesSuffix',{count:item.size})})),text(key+':media',item.mediaType),text(key+':source',item.source?t('external.source',{source:item.source}):null)]);
}
export function renderSessionMetadata(session,key,locale='zh-CN'){
 const t=presentationTranslator(locale);
 if(!session)return null;
 return node('details',key,null,[node('summary',key+':summary',t('external.sessionInformation')),text(key+':id',t('external.sessionId',{id:session.id})),text(key+':external',session.externalSessionId?t('external.remoteBinding',{id:session.externalSessionId}):null),text(key+':updated',session.updatedAt?t('external.updatedAt',{date:formatDateTime(locale,session.updatedAt,{dateStyle:'medium',timeStyle:'short'})}):null),text(key+':archived',session.archived?t('session.status.archived'):null)]);
}

export function renderMessageAttachment(item,key,locale='zh-CN'){
 const name=item.displayName??((item.path??item.id).split(/[\\/]/).pop()||item.id);
 return {...node('div',key,null,[
  item.mediaType?.startsWith('image/')?{...node('img',key+':preview',null,[],{alt:name,width:'160',height:'112'}),resource:'attachment:'+item.id}:null,
  text(key+':name',name),
 ],{title:item.displayName??item.path??item.id}),className:'message-attachment'};
}
