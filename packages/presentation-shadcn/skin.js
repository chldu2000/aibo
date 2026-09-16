const node=(tag,key,text,children=[],attrs={})=>({tag,key,...(text==null?{}:{text:String(text)}),children,attrs});
const button=(key,label,token,attrs={})=>({...node('button',key,label,[],{type:'button',...attrs}),...(token?{events:{click:token}}:{})});
function controls({control,props,actions}) {
  if(control==='AgentStatusMark') {
    const logo=props.icon
      ? node('svg','logo',null,[node('path','logo-path',null,[],{d:props.icon.path,fill:'currentColor'})],{viewBox:'0 0 24 24','aria-hidden':'true'})
      : node('svg','logo',null,[node('polygon','logo-path',null,[],{points:'12,2 22,12 12,22 2,12',fill:'none',stroke:'currentColor','stroke-width':'2'})],{viewBox:'0 0 24 24','aria-hidden':'true'});
    return {...node('span','status',null,[node('span','orbit'),logo,node('span','signal')],{'aria-label':props.label,title:props.label}),className:'status '+props.tone};
  }
  if(control!=='ModelMatrix')return null;
  const choose=(row,cell)=>actions.find(a=>a.kind==='model'&&a.model===row.reference&&a.reasoningEffort===(cell?.id??null))?.token;
  const tier=actions.find(a=>a.kind==='serviceTier')?.token;
  const table=node('table','models',null,[node('thead','model-head',null,[node('tr','labels',null,[node('th','model-label','模型'),node('th','default-label',props.defaultLabel),...props.columns.map(c=>node('th','column:'+c.id,c.label,[],{title:c.description??c.label}))])]),node('tbody','model-body',null,props.rows.map(row=>node('tr','model:'+row.reference,null,[node('th','name:'+row.reference,row.label+(row.isDefault?' · 默认':'')),node('td','default-cell:'+row.reference,null,[button('default:'+row.reference,props.defaultLabel,choose(row),{disabled:props.disabled,'aria-pressed':String(row.defaultActive),title:props.defaultTitle})]),...row.cells.map(cell=>node('td','cell:'+row.reference+':'+cell.id,null,[button('choose:'+row.reference+':'+cell.id,cell.label,choose(row,cell),{disabled:props.disabled||!cell.available,'aria-pressed':String(cell.active),title:cell.description??cell.label})]))])))]);
  return {...node('section','models-control',null,[props.fastTier?button('service-tier:fast','⚡ '+props.fastTier.label,tier,{disabled:props.disabled,'aria-pressed':String(props.fastTier.active),title:props.fastTier.description??props.fastTier.label}):null,table].filter(Boolean)),className:'models'};
}
function semantic({snapshot,actions}) {
  const {view,state}=snapshot;
  const actionButtons=(entries,prefix)=>entries.map(a=>button(prefix+a.token,a.label,a.token));
  const general=actions.filter(a=>a.action.itemId===null);
  const children=[node('header','header',null,[node('h2','title',snapshot.contribution.title),node('nav','actions',null,actionButtons(general,'global:'))])];
  if(state.message)children.push(node('p','state',state.message,[],{role:state.status==='error'?'alert':'status'}));
  if(view.kind==='collection') {
    const rows=view.items.map(item=>({item,actions:actions.filter(a=>a.action.itemId===item.id)}));
    children.push(collection(view,rows,actionButtons));
    children.push(node('p','pagination',`${view.page.offset+Math.min(1,view.items.length)}–${view.page.offset+view.items.length} / ${view.page.total}${view.page.truncated?' · 列表已截断':''}`));
  } else {
    children.push(node('section','properties',null,view.properties.map((p,i)=>node('p','property:'+i,null,[node('strong','label:'+i,p.label+': '),node('span','value:'+i,p.value)]))));
    children.push(node('pre','content',view.content,[],{tabindex:'0','aria-label':'内容'}));
    if(view.truncated)children.push(node('p','truncated','内容已截断',[],{role:'status'}));
  }
  return {...node('section','semantic',null,children,{'aria-busy':String(state.status==='loading')}),className:'semantic'};
}
self.aiboPresentation={render(input){if(input.surface==='workbench')return self.aiboWorkbench(input,semantic);return input.surface==='semantic'?semantic(input.data):input.surface==='controls'?controls(input.data):null;}};

function collection(view,rows,buttons){return node('table','collection',null,[node('thead','head',null,[node('tr','columns',null,[...view.properties.map(p=>node('th','heading:'+p.key,p.label)),node('th','action-heading','操作')])]),node('tbody','rows',null,rows.map(({item,actions})=>node('tr','item:'+item.id,null,[...view.properties.map(p=>node('td','value:'+item.id+':'+p.key,item.values[p.key]??'')),node('td','actions:'+item.id,null,buttons(actions,'item:'+item.id+':'))],{'aria-selected':String(view.selection===item.id)})))]);}
