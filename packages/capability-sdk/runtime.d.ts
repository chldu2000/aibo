import type { JsonValue, CapabilityInitialization, CapabilityInvocation, CapabilityOperation, CapabilityCallTarget, CapabilityResult } from '@aibo/plugin-protocol';
/** Structural cancellation port; no DOM or Node type library is required. */
export interface CancellationSignal {
  readonly aborted:boolean;
  readonly reason:unknown;
  addEventListener(type:'abort',listener:()=>void,options?:{once?:boolean}):void;
  removeEventListener(type:'abort',listener:()=>void):void;
}
export type InvocationTools = {initialization:CapabilityInitialization;signal:CancellationSignal;call(target:CapabilityCallTarget):Promise<CapabilityResult>};
export type CapabilityOptions = {pluginId:string;pluginVersion:string;contributionId:string;operations:CapabilityOperation[];invoke(request:CapabilityInvocation,tools:InvocationTools):JsonValue|Promise<JsonValue>};
export function createCapabilityRuntime(options:CapabilityOptions & {send(message:JsonValue):void}):{receive(message:unknown):Promise<void>;close(reason?:string):void};
