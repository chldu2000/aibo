<script>
 import {PresentationHost,ModelMatrix,AgentStatusMark,FileChangeMark,SessionControlMark,Select,ModelContextSelect,AttachmentList,GoalBar,SubagentCard} from '$lib/ui-kit';
 let host,active=$state(null),disabled=$state(false),instance;
 const actions=[];
 let choice=$state('a');
 const initialAttachments=()=>[{id:'one',path:'/Users/probe/Library/Application Support/aibo/clip/shot.png',mediaType:'image/png',sizeLabel:'2 KB'},{id:'two',path:'src/notes.md',mediaType:'text/markdown'}];
 let attachments=$state(initialAttachments());
 export function resetAttachments(){attachments=initialAttachments();}
 export function addAttachments(count){attachments=[...attachments,...Array.from({length:count},(_,i)=>({id:'extra-'+attachments.length+'-'+i,path:`src/file-${attachments.length+i}.ts`,mediaType:'text/typescript'}))];}
 let mark=$state({agent:'plugin',tone:'idle',label:'Inherited mark'});
 import codex from '../src-tauri/capability-plugins/codex/plugin.json';
 import pi from '../src-tauri/capability-plugins/pi/plugin.json';
 export function setMark(agent,tone){mark={agent,tone,label:agent+' '+tone,icon:({codex,pi})[agent]?.contributions[0].icon};}
 const input={surface:'workbench',context:{workspaceId:'workspace',sessionId:'session',revision:1},data:null,theme:{}};
 const matrix=$derived({columns:[{id:'high',label:'High',description:null}],rows:[{reference:'model-a',label:'Model A',isDefault:true,active:true,defaultActive:true,cells:[{id:'high',label:'High',description:null,available:true,active:false}]}],defaultLabel:'Default',defaultTitle:'Default',disabled,onSelect:(...selection)=>actions.push(selection)});
 export async function select(value){const next=await host.prepare(value,null,()=>{},new AbortController().signal);next.activate();instance?.dispose();instance=next;active=value;}
 export function setDisabled(value){disabled=value;}
 export function setChoice(value){choice=value;}
 export function result(){return actions;}
 export function dispose(){instance?.dispose();active=null;instance=null;}
</script>
<section id="trusted"><ModelMatrix {...matrix}/></section>
<PresentationHost bind:this={host} {active} themeId={null} {input} onIntent={()=>{}} onRestore={dispose}>
 <section id="replaceable"><ModelMatrix {...matrix}/><button aria-label="Select row" onclick={()=>actions.push(['row'])}><AgentStatusMark {...mark}/></button>
  <p id="selects"><Select aria-label="Probe select" value={choice} options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta'},{value:'c',label:'Gamma',disabled:true}]} onSelect={value=>{choice=value;actions.push(['select',value]);}}/>
   <ModelContextSelect options={[{id:'std',label:'272K',description:null,tokens:272000},{id:'max',label:'1M',description:null,tokens:1000000}]} current="std" disabled={false} onSelect={id=>{actions.push(['context',id]);}}/></p>
  <div id="content-controls" style="width:520px">
   <AttachmentList items={attachments} onRemove={id=>{attachments=attachments.filter(item=>item.id!==id);actions.push(['remove',id]);}}/>
   <GoalBar objective="Ship the release" statusLabel="运行中" usageLabel="1 / 10" onPause={()=>actions.push(['pause'])} onClear={()=>actions.push(['clear'])}/>
   <SubagentCard name="Explorer" task="Map code" statusLabel="完成" activity="read 3 files" failed={false} onOpen={()=>actions.push(['open'])}/>
  </div>
  <p id="marks"><FileChangeMark kind="conflicted"/><FileChangeMark kind="added" decorative/><SessionControlMark control={{kind:'mode',profile:{interactionMode:'plan'}}}/></p></section>
</PresentationHost>
