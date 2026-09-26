import type { InvocationTools } from './runtime.js';
import type { CapabilityInvocation } from '@aibo/plugin-protocol';
export type HostToolDefinition = {name:string;description:string;inputSchema:Record<string,unknown>;outputSchema?:Record<string,unknown>;annotations?:Record<string,unknown>};
export function hostToolDefinitions(context: unknown): HostToolDefinition[];
export function createHostToolChannel(): {
  begin(request:CapabilityInvocation, tools:Pick<InvocationTools,'signal'|'emit'>, nativeSessionId:()=>string|null):()=>void;
  call(name:string,input:unknown):Promise<unknown>;
  respond(input:{requestId:string;result?:unknown;error?:string}):{resolved:true};
};
export function createHostToolMcpBridge(options:{definitions:HostToolDefinition[];call(name:string,input:unknown):Promise<unknown>}):Promise<{
  ready:Promise<void>;configuration:{name:string;command:string;args:string[];env:Record<string,string>};close():Promise<void>;
}>;
