import {node,button,actionFor} from './tree.js';
import {renderNavigation} from './navigation.js';
import {renderConversation} from './conversation.js';
import {renderGit} from './git.js';
import {renderInspector} from './inspector.js';
import {renderCapability} from './capability.js';
export function renderWorkbench(input,renderSemantic){
 const data=input.data;
 if(!data?.navigation||!data?.conversation||!data?.git||!data?.inspector||!data?.capability)return node('main','workbench:empty','正在准备工作台',[],{role:'status'});
 const gitActions=data.gitActions??[],inspectorActions=data.inspectorActions??[];
 const toggle=actionFor(gitActions,'togglePanel');
 const view=kind=>actionFor(gitActions,'selectView',kind);
 const toolbar=node('nav','workbench:toolbar',null,[button('workbench:toggle','侧边面板',toggle,{'aria-expanded':String(data.inspector.open)}),button('workbench:context','上下文',view('context'),{'aria-pressed':String(data.inspector.activeView==='context')}),button('workbench:git','Git',view('git'),{'aria-pressed':String(data.inspector.activeView==='git')})]);
 const content=data.capability.selected?renderCapability(data.capability,data.capabilityActions??[],renderSemantic):renderConversation(data.conversation,data.conversationActions??[]);
 const main={...node('section','workbench:center',null,[toolbar,content,!data.capability.selected?node('details','workbench:capabilities',null,[node('summary','workbench:capabilities-title','能力插件'),renderCapability(data.capability,data.capabilityActions??[],renderSemantic)]):null]),className:'workbench-center'};
 const children=[renderNavigation(data.navigation,data.navigationActions??[]),main];
 if(data.inspector.open)children.push({...node('aside','workbench:inspector',null,[data.inspector.activeView==='git'?renderGit(data.git,gitActions):renderInspector(data.inspector,inspectorActions)]),className:'workbench-inspector'});
 return {...node('div','workbench',null,children),className:'workbench'};
}
