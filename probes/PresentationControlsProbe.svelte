<script>
 import {PresentationHost,ModelMatrix,AgentStatusMark} from '$lib/ui-kit';
 let host,active=$state(null),disabled=$state(false),instance;
 const actions=[];
 const input={surface:'workbench',context:{workspaceId:'workspace',sessionId:'session',revision:1},data:null,theme:{}};
 const matrix=$derived({columns:[{id:'high',label:'High',description:null}],rows:[{reference:'model-a',label:'Model A',isDefault:true,active:true,defaultActive:true,cells:[{id:'high',label:'High',description:null,available:true,active:false}]}],defaultLabel:'Default',defaultTitle:'Default',disabled,onSelect:(...selection)=>actions.push(selection)});
 export async function select(value){const next=await host.prepare(value,null,()=>{},new AbortController().signal);next.activate();instance?.dispose();instance=next;active=value;}
 export function setDisabled(value){disabled=value;}
 export function result(){return actions;}
 export function dispose(){instance?.dispose();active=null;instance=null;}
</script>
<section id="trusted"><ModelMatrix {...matrix}/></section>
<PresentationHost bind:this={host} {active} themeId={null} {input} onIntent={()=>{}} onRestore={dispose}>
 <section id="replaceable"><ModelMatrix {...matrix}/><button aria-label="Select row" onclick={()=>actions.push(['row'])}><AgentStatusMark agent="plugin" tone="idle" label="Inherited mark"/></button></section>
</PresentationHost>
