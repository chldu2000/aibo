import type { PresentationContext } from '../../../packages/plugin-protocol/src/presentation-runtime';
export type PresentationViewState = {
  focus: {key:string;selection:[number,number]|null}|null;
  scroll: {key:string;x:number;y:number}[];
  window: [number,number];
  disclosures: {key:string;open:boolean}[];
};
/** Window-local visual state, bounded and independent of plugin identity or business drafts. */
export function createPresentationViewStateStore(limit=32){
 limit=Math.max(1,Math.min(128,Math.floor(limit)||32));
 const states=new Map<string,PresentationViewState>();
 const scope=(context:PresentationContext)=>JSON.stringify([context.workspaceId,context.sessionId]);
 const key=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256;
 const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=10000000;
 function valid(value:unknown):value is PresentationViewState{
  if(!value||typeof value!=='object')return false;
  const v=value as PresentationViewState;
  return Array.isArray(v.window)&&v.window.length===2&&v.window.every(number)
   &&(v.focus===null||Boolean(v.focus&&key(v.focus.key)&&(v.focus.selection===null||(Array.isArray(v.focus.selection)&&v.focus.selection.length===2&&v.focus.selection.every(n=>number(n)&&Number.isInteger(n)&&n>=0)))))
   &&Array.isArray(v.scroll)&&v.scroll.length<=1024&&v.scroll.every(p=>p&&key(p.key)&&number(p.x)&&number(p.y))
   &&Array.isArray(v.disclosures)&&v.disclosures.length<=1024&&v.disclosures.every(p=>p&&key(p.key)&&typeof p.open==='boolean');
 }
 return {
  read(context:PresentationContext){const value=states.get(scope(context));return value?structuredClone(value):undefined;},
  write(context:PresentationContext,value:unknown){if(!valid(value))return;const id=scope(context);states.delete(id);states.set(id,structuredClone({focus:value.focus?{key:value.focus.key,selection:value.focus.selection}:null,scroll:value.scroll.map(({key,x,y})=>({key,x,y})),window:value.window,disclosures:value.disclosures.map(({key,open})=>({key,open}))}));while(states.size>limit)states.delete(states.keys().next().value!);},
  clear(){states.clear();},
 };
}
