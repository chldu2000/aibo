export const node=(tag,key,text,children=[],attrs={})=>({tag,key,...(text==null?{}:{text:String(text)}),children:children.filter(Boolean),attrs});
export const button=(key,label,action,attrs={})=>({...node('button',key,label,[],{type:'button',disabled:!action,...attrs}),...(action?{events:{[action.event]:action.token}}:{})});
export const field=(key,label,value,action,multiline=false)=>node('label',key,null,[node('span',key+':label',label),{...node(multiline?'textarea':'input',key+':input',null,[],{'aria-label':label,value:value??'',disabled:!action,...(multiline?{rows:'4'}:{type:'text'})}),...(action?{events:{[action.event]:action.token}}:{})}]);
export const section=(key,title,children)=>({...node('section',key,null,[node('h2',key+':title',title),...children]),className:key});
export const text=(key,value)=>value==null||value===''?null:node('p',key,value);
export const actionFor=(actions,operation,...args)=>actions.find(action=>action.operation===operation&&args.every((value,index)=>action.args?.[index]===value));
