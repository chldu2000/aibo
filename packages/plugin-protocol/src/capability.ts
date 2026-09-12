import type { JsonValue } from './semantic.js';
export const CAPABILITY_RUNTIME_PROTOCOL = '2.0';
export type CapabilityScope = {kind:'application'} | {kind:'workspace'|'session';id:string};
export type CapabilityRequest = {scope:CapabilityScope;capability:string;version:string;requestId:string;turnId?:string;input:JsonValue};
export type CapabilityResult = {instanceId:string;invocationId:string;installationId:string;generationId:string;output:JsonValue};
export type CapabilityFailure = {code:string;message:string;invocationId:string|null};
export type CapabilityOperation = {capability:string;version:string;operationId:string};
export type CapabilityInitialization = {protocol:'2.0';instanceId:string;generationId:string;installationId:string;pluginId:string;pluginVersion:string;contributionId:string;privateData:{path:string;formatVersion:1}};
export type CapabilityInvocation = {
  invocationId:string;instanceId:string;generationId:string;contributionId:string;
  capability:string;contractVersion:string;operationId:string;scope:CapabilityScope;deadlineUnixMs:number;
  context:{turnId:string|null;workspaceId:string|null;workspacePath:string|null;originalCaller:{kind:'window';id:string};permissions:string[];callChain:{invocationId:string;installationId:string;contributionId:string}[]};
  input:JsonValue;
};
export type CapabilityCallTarget = {pluginId:string;contributionId:string;capability:string;version:string;input:JsonValue};
