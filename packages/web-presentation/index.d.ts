import type { Snapshot, ActionMessage } from '@aibo/plugin-protocol';
/** Trusted, in-process Web interfaces. Never serialize these as plugin messages. */
export type PresentationProps = {
  snapshot:Snapshot;
  layout:'sidebar'|'central';
  onAction:(message:ActionMessage)=>void;
  focusTarget?:string|null;
  detailPresentation?:'plain'|'numbered';
};
export type MountedPresentation = {update(snapshot:Snapshot,focusTarget?:string|null):void;dispose():Promise<void>};
export type WebPresentationAdapter = {mount(target:HTMLElement,props:PresentationProps):Promise<MountedPresentation>};
