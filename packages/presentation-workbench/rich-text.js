import {node,button,actionFor} from './tree.js';
import {parseMarkdown,inlineSegments,displayMarkdown} from './markdown.js';
export function renderRichText(content,key,entryId,actions){
 const inline=(value,prefix)=>inlineSegments(value).map((segment,index)=>{
  const id=prefix+':'+index;
  if(segment.kind==='link'){
   const action=actions.find(action=>action.operation==='openLink'&&action.args[0]===entryId&&action.args[2]===segment.href);
   return {...button(id,segment.value,action,{role:'link',title:segment.href}),className:'markdown-link'};
  }
  return node(segment.kind==='code'?'code':segment.kind==='strong'?'strong':'span',id,segment.value);
 });
 const blocks=parseMarkdown(displayMarkdown(content)).map((block,index)=>{
  const id=key+':block:'+index;
  if(block.kind==='code')return {...node('section',id,null,[node('header',id+':toolbar',null,[node('span',id+':language',block.language),button(id+':copy','复制代码',actionFor(actions,'copyCode',entryId,String(index)))]),node('pre',id+':pre',null,[node('code',id+':code',block.lines.join('\n'))],{tabindex:'0'})]),className:'markdown-code-block'};
  if(block.kind==='list')return node('ul',id,null,block.lines.map((line,i)=>node('li',id+':line:'+i,null,inline(line,id+':line:'+i+':inline'))));
  return {...node(block.kind==='heading'?'h3':'p',id,null,inline(block.lines[0],id+':inline')),className:block.kind==='heading'?'markdown-heading heading-'+block.level:'markdown-paragraph'};
 });
 return {...node('div',key,null,blocks),className:'markdown-content'};
}
