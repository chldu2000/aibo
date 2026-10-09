import {renderSidebar} from './sidebar.js';
import {presentationTranslator} from './i18n.js';
import {node,button,actionFor} from './tree.js';
import {renderNavigation} from './navigation.js';
import {renderConversation} from './conversation.js';
import {renderGit} from './git.js';
import {renderInspector} from './inspector.js';
import {renderCapability} from './capability.js';
export function renderWorkbench(input,renderSemantic){
 const locale=input.locale??'zh-CN',t=presentationTranslator(locale);
 const data=input.data;
 if(!data?.navigation||!data?.conversation||!data?.git||!data?.inspector||!data?.capability)return node('main','workbench:empty',t('external.preparing'),[],{role:'status'});
 const gitActions=data.gitActions??[],inspectorActions=data.inspectorActions??[];
 const toggle=actionFor(gitActions,'togglePanel');
 const view=kind=>actionFor(gitActions,'selectView',kind);
 const toolbar=node('nav','workbench:toolbar',null,[button('workbench:toggle',t('external.sidePanel'),toggle,{'aria-expanded':String(data.inspector.open&&data.layout?.mode!=='focus')}),button('workbench:context',t('side.context'),view('context'),{'aria-pressed':String(data.inspector.activeView==='context')}),button('workbench:git','Git',view('git'),{'aria-pressed':String(data.inspector.activeView==='git')})]);
 if(data.layout){
  const controls=(data.layout.mode==='focus'?[]:['navigation',...(data.layout.auxiliaryOpen?['auxiliary']:[])]).map(target=>{
   const bounds=data.layout[target],action=actionFor(data.layoutActions??[],'resize',target);
   const label=target==='navigation'?t('external.navigationWidth'):t('external.sidePanelWidth');
   return node('label','layout:'+target,null,[node('span','layout:'+target+':label',t('external.widthPixels',{label,width:Math.round(bounds.width)})),
    {...node('input','layout:'+target+':input',null,[],{type:'range','aria-label':label,min:String(bounds.min),max:String(bounds.max),step:'1',value:String(bounds.width),disabled:!action}),...(action?{events:{input:action.token}}:{})},
   ]);
  });
  controls.unshift(...[['standard',t('workbench.standard')],['focus',t('workbench.focus')],['review',t('external.reviewLayout')]].map(([mode,label])=>button('layout:mode:'+mode,label,actionFor(data.layoutActions??[],'selectMode',mode),{'aria-pressed':String((data.layout.mode??'standard')===mode)})));
  toolbar.children.push(node('details','workbench:layout',null,[node('summary','workbench:layout:summary',t('settings.layout')),...controls]));
 }
 const content=data.capability.selected?renderCapability(data.capability,data.capabilityActions??[],renderSemantic,locale):renderConversation(data.conversation,data.conversationActions??[],locale);
 const main={...node('section','workbench:center',null,[toolbar,content,!data.capability.selected?node('details','workbench:capabilities',null,[node('summary','workbench:capabilities-title',t('external.capabilityPlugins')),renderCapability(data.capability,data.capabilityActions??[],renderSemantic,locale)]):null]),className:'workbench-center'+(!data.capability.selected?' conversation-center':'')};
 const navigation=renderNavigation(data.navigation,data.navigationActions??[],locale);
 if(data.layout)navigation.inlineSize=data.layout.navigation.width;
 const splitter=target=>{
  const bounds=data.layout?.[target],action=actionFor(data.layoutActions??[],'resize',target);
  if(!bounds||!action)return null;
  return {...node('button','workbench:splitter:'+target,null,[],{type:'button',role:'separator','aria-orientation':'vertical','aria-label':target==='navigation'?t('external.resizeNavigation'):t('external.resizeSidePanel'),'aria-valuenow':String(bounds.width),'aria-valuemin':String(bounds.min),'aria-valuemax':String(bounds.max)}),className:'workbench-splitter',resize:{token:action.token,value:bounds.width,min:bounds.min,max:bounds.max,direction:(target==='navigation'?1:-1)*(data.layout.mode==='review'?-1:1)}};
 };
 const children=[navigation,splitter('navigation'),main];
 if(data.inspector.open)children.push(splitter('auxiliary'));
 if(data.inspector.open)children.push({...node('aside','workbench:inspector',null,[data.sidebar?renderSidebar(data,renderSemantic,locale):data.inspector.activeView==='git'?renderGit(data.git,gitActions,locale):renderInspector(data.inspector,inspectorActions,locale)]),className:'workbench-inspector',...(data.layout?{inlineSize:data.layout.auxiliary.width}:{})});
 const ordered=data.layout?.mode==='focus'?[main]:data.layout?.mode==='review'?[...children].reverse():children;
 return {...node('div','workbench',null,ordered),className:'workbench'+(data.layout?.mode==='review'?' workbench-review':'')};
}
