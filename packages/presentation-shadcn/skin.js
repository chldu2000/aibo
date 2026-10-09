const node=(tag,key,text,children=[],attrs={})=>({tag,key,...(text==null?{}:{text:String(text)}),children,attrs});
const button=(key,label,token,attrs={})=>({...node('button',key,label,[],{type:'button',...attrs}),...(token?{events:{click:token}}:{})});
function controls({control,props,actions},locale='zh-CN') {
  const t=self.aiboTranslate(locale);
  if(control==='AgentStatusMark') {
    const logo=props.icon
      ? node('svg','logo',null,[node('path','logo-path',null,[],{d:props.icon.path,fill:'currentColor'})],{viewBox:'0 0 24 24','aria-hidden':'true'})
      : node('svg','logo',null,[node('polygon','logo-path',null,[],{points:'12,2 22,12 12,22 2,12',fill:'none',stroke:'currentColor','stroke-width':'2'})],{viewBox:'0 0 24 24','aria-hidden':'true'});
    return {...node('span','status',null,[node('span','orbit'),logo,node('span','signal')],{'aria-label':props.label,title:props.label}),className:'status '+props.tone};
  }
  // Host API 1.1.0 controls. Marks are decorative data; select triggers only bind the host `open` action.
  if(control==='FileChangeMark') {
    const symbol={added:'A',modified:'M',deleted:'D',renamed:'R',conflicted:'U'}[props.kind]??'?';
    return {...node('span','file-change',symbol,[],{title:props.label}),className:'file-change '+props.kind};
  }
  if(control==='SessionControlMark') {
    const glyph={edit:'M4 20h4L19 9l-4-4L4 16z',review:'M5 5h14M5 12h14M5 19h9',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z','shield-question':'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z','shield-alert':'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v5M12 16v.5',trust:'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5'}[props.appearance.icon];
    const icon=glyph?node('path','session-glyph',null,[],{d:glyph}):node('circle','session-glyph',null,[],{cx:'12',cy:'12',r:'7'});
    return {...node('span','session-control',null,[node('svg','session-icon',null,[icon],{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})]),className:'session-control '+props.appearance.tone+(props.compact?' compact':'')};
  }
  if(control==='Select'||control==='ModelContextSelect') {
    const open=actions.find(a=>a.kind==='open')?.token;
    const current=control==='Select'
      ? props.options.find(o=>o.value===props.value)?.label??props.placeholder
      : props.options.find(o=>o.id===props.current)?.label??(props.options.length?t('context.noCurrent'):t('context.unsupported'));
    const name=control==='Select'?props.label:t('context.size');
    const trigger=button('trigger',null,open,{disabled:!open,'aria-expanded':'false','aria-label':t('external.triggerLabel',{name,current}),title:name});
    trigger.children=[node('span','trigger-value',current),node('span','trigger-caret','▾',[],{'aria-hidden':'true'})];
    return {...node('span','select-control',null,control==='Select'?[trigger]:[node('span','select-label',t('side.context')),trigger]),className:'select-control'};
  }
  if(control==='AttachmentList') {
    const remove=id=>actions.find(a=>a.kind==='remove'&&a.id===id)?.token;
    return {...node('ul','attachments',null,props.items.map(item=>({...node('li','attachment:'+item.id,null,[
      node('span','attachment-icon:'+item.id,item.mediaType.startsWith('image/')?'▣':'▤',[],{'aria-hidden':'true'}),
      node('span','attachment-name:'+item.id,item.name,[],{title:item.name}),
      ...(item.sizeLabel?[node('span','attachment-size:'+item.id,item.sizeLabel)]:[]),
      ...(props.removable?[button('attachment-remove:'+item.id,'×',remove(item.id),{disabled:!remove(item.id),'aria-label':t('external.removeAttachment',{name:item.name})})]:[]),
    ]),className:'attachment'})),{'aria-label':props.label}),className:'attachments'};
  }
  if(control==='GoalBar') {
    const token=kind=>actions.find(a=>a.kind===kind)?.token,labels={pause:t('goal.pause'),resume:t('goal.resume'),clear:t('goal.clear')};
    return {...node('section','goal',null,[
      {...node('div','goal-copy',null,[node('p','goal-objective',props.objective,[],{title:props.objective}),node('span','goal-status',props.statusLabel+(props.usageLabel?' · '+props.usageLabel:''),[],{role:'status'})]),className:'goal-copy'},
      {...node('div','goal-actions',null,['pause','resume','clear'].filter(token).map(kind=>button('goal-'+kind,labels[kind],token(kind),{'aria-label':labels[kind]}))),className:'goal-actions'},
    ],{'aria-label':t('goal.current')}),className:'goal'};
  }
  if(control==='SubagentCard') {
    const card=button('subagent',null,actions.find(a=>a.kind==='open')?.token,{'aria-label':t('subagent.viewProcessLabel',{name:props.name})});
    const part=(key,text,attrs)=>({...node('span',key,text,[],attrs),className:key});
    card.children=[{...node('span','subagent-heading',null,[node('strong','subagent-name',props.name),part('subagent-status',props.statusLabel,{role:'status'})]),className:'subagent-heading'},
      part('subagent-task',props.task||t('subagent.defaultTask')),part('subagent-activity',props.activity||t('subagent.waitingActivity'))];
    return {...card,className:'subagent'+(props.failed?' failed':'')};
  }
  if(control!=='ModelMatrix')return null;
  const choose=(row,cell)=>actions.find(a=>a.kind==='model'&&a.model===row.reference&&a.reasoningEffort===(cell?.id??null))?.token;
  const tier=actions.find(a=>a.kind==='serviceTier')?.token;
  const table=node('table','models',null,[node('thead','model-head',null,[node('tr','labels',null,[node('th','model-label',t('composer.model')),node('th','default-label',props.defaultLabel),...props.columns.map(c=>node('th','column:'+c.id,c.label,[],{title:c.description??c.label}))])]),node('tbody','model-body',null,props.rows.map(row=>node('tr','model:'+row.reference,null,[node('th','name:'+row.reference,row.label+(row.isDefault?t('external.defaultSuffix'):'')),node('td','default-cell:'+row.reference,null,[button('default:'+row.reference,props.defaultLabel,choose(row),{disabled:props.disabled,'aria-pressed':String(row.defaultActive),title:props.defaultTitle})]),...row.cells.map(cell=>node('td','cell:'+row.reference+':'+cell.id,null,[button('choose:'+row.reference+':'+cell.id,cell.label,choose(row,cell),{disabled:props.disabled||!cell.available,'aria-pressed':String(cell.active),title:cell.description??cell.label})]))])))]);
  return {...node('section','models-control',null,[props.fastTier?button('service-tier:fast','⚡ '+props.fastTier.label,tier,{disabled:props.disabled,'aria-pressed':String(props.fastTier.active),title:props.fastTier.description??props.fastTier.label}):null,table].filter(Boolean)),className:'models'};
}
function semantic({snapshot,actions},locale='zh-CN') {
  const t=self.aiboTranslate(locale);
  const {view,state}=snapshot;
  const actionButtons=(entries,prefix)=>entries.map(a=>button(prefix+a.token,a.label,a.token));
  const general=actions.filter(a=>a.action.itemId===null);
  const children=[node('header','header',null,[node('h2','title',snapshot.contribution.title),node('nav','actions',null,actionButtons(general,'global:'))])];
  if(state.message)children.push(node('p','state',state.message,[],{role:state.status==='error'?'alert':'status'}));
  if(view.kind==='collection') {
    const rows=view.items.map(item=>({item,actions:actions.filter(a=>a.action.itemId===item.id)}));
    children.push(collection(view,rows,actionButtons,locale));
    children.push(node('p','pagination',`${view.page.offset+Math.min(1,view.items.length)}–${view.page.offset+view.items.length} / ${view.page.total}${view.page.truncated?t('external.listTruncatedSuffix'):''}`));
  } else {
    children.push(node('section','properties',null,view.properties.map((p,i)=>node('p','property:'+i,null,[node('strong','label:'+i,p.label+': '),node('span','value:'+i,p.value)]))));
    children.push(node('pre','content',view.content,[],{tabindex:'0','aria-label':t('external.content')}));
    if(view.truncated)children.push(node('p','truncated',t('external.contentTruncated'),[],{role:'status'}));
  }
  return {...node('section','semantic',null,children,{'aria-busy':String(state.status==='loading')}),className:'semantic'};
}
self.aiboPresentation={render(input){if(input.surface==='workbench')return self.aiboWorkbench(input,data=>semantic(data,input.locale));return input.surface==='semantic'?semantic(input.data,input.locale):input.surface==='controls'?controls(input.data,input.locale):null;}};

function collection(view,rows,buttons,locale='zh-CN'){const t=self.aiboTranslate(locale);return node('table','collection',null,[node('thead','head',null,[node('tr','columns',null,[...view.properties.map(p=>node('th','heading:'+p.key,p.label)),node('th','action-heading',t('semantic.actionColumn'))])]),node('tbody','rows',null,rows.map(({item,actions})=>node('tr','item:'+item.id,null,[...view.properties.map(p=>node('td','value:'+item.id+':'+p.key,item.values[p.key]??'')),node('td','actions:'+item.id,null,buttons(actions,'item:'+item.id+':'))],{'aria-selected':String(view.selection===item.id)})))]);}
