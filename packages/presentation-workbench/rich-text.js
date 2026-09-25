import {node,button,actionFor} from './tree.js';
import {parseMarkdown,displayMarkdown} from './markdown.js';
import {highlightCode} from './code-highlight.js';

export function renderRichText(content,key,entryId,actions) {
  const inline = (segments,prefix) => segments.map((segment,index) => {
    const id = prefix+':'+index;
    if (segment.kind === 'link') {
      const action = actions.find(action => action.operation === 'openLink' && action.args[0] === entryId && action.args[2] === segment.href);
      return {...button(id,null,action,{role:'link',title:segment.href}),children:inline(segment.children,id+':label'),className:'markdown-link'};
    }
    const tag = {code:'code',strong:'strong',em:'em',del:'del'}[segment.kind] ?? 'span';
    return {...node(tag,id,segment.children ? null : segment.value,segment.children ? inline(segment.children,id) : []),
      ...(segment.kind === 'del' ? {className:'markdown-deleted'} : {})};
  });
  const highlighted = (segments,prefix) => segments.map((segment,index) => ({
    ...node('span',prefix+':'+index,segment.value,segment.children ? highlighted(segment.children,prefix+':'+index) : []),
    ...(segment.className ? {className:segment.className} : {}),
  }));
  const blocks = values => values.map(block => {
    const id = key+':block:'+block.index;
    if (block.kind === 'code') return {...node('section',id,null,[
      node('header',id+':toolbar',null,[node('span',id+':language',block.language),button(id+':copy','复制代码',actionFor(actions,'copyCode',entryId,String(block.index)))]),
      node('pre',id+':pre',null,[node('code',id+':code',null,highlighted(highlightCode(block.lines.join('\n'),block.language),id+':highlight'))],{tabindex:'0','aria-label':'代码块'}),
    ]),className:'markdown-code-block'};
    if (block.kind === 'list') return {...node(block.ordered ? 'ol' : 'ul',id,null,block.items.map((item,i) => {
      const itemId = id+':item:'+i;
      return {...node('li',itemId,null,[
        item.checked !== null ? {...node('span',itemId+':check',item.checked ? '☑' : '☐',[],{role:'img','aria-label':item.checked ? '已完成' : '未完成'}),className:'markdown-task-check'} : null,
        {...node('div',itemId+':content',null,blocks(item.blocks)),className:'markdown-list-content'},
      ]),className:item.checked !== null ? 'markdown-task' : ''};
    }),block.ordered ? {start:String(block.start)} : {}),className:'markdown-list'};
    if (block.kind === 'quote') return {...node('blockquote',id,null,blocks(block.blocks)),className:'markdown-quote'};
    if (block.kind === 'rule') return {...node('hr',id),className:'markdown-rule'};
    if (block.kind === 'table') {
      const row = (cells,rowId,tag) => node('tr',rowId,null,cells.map((cell,column) => ({
        ...node(tag,rowId+':'+column,null,inline(cell,rowId+':'+column+':inline'),tag === 'th' ? {scope:'col'} : {}),
        className:'markdown-align-'+(block.align[column] ?? 'left'),
      })));
      return {...node('div',id,null,[{...node('table',id+':table',null,[
        node('thead',id+':head',null,[row(block.header,id+':header','th')]),
        node('tbody',id+':body',null,block.rows.map((cells,i) => row(cells,id+':row:'+i,'td'))),
      ]),className:'markdown-table'}],{role:'region',tabindex:'0','aria-label':'表格，可横向滚动'}),className:'markdown-table-scroll'};
    }
    const heading = block.kind === 'heading';
    return {...node(heading ? 'h'+block.level : 'p',id,null,inline(block.segments,id+':inline')),
      className:heading ? 'markdown-heading markdown-heading-'+block.level : 'markdown-paragraph'};
  });
  return {...node('div',key,null,blocks(parseMarkdown(displayMarkdown(content)))),className:'markdown-content'};
}
