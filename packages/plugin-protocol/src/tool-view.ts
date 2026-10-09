/** Independent tool applications; not a Presentation Worker or Agent capability. */
export type ToolViewContribution = {
  kind: 'toolView'; id: string; scope: 'workspace'; required: true; title: string;
  contractVersion: '1.0.0'; frontend: string; backend: string; permissions: ['local.process'];
};
export type ToolViewBackendRequest = {
  protocol: 'aibo.tool-view/1'; method: 'initialize' | 'request' | 'status' | 'shutdown'; params: unknown;
};
export type ToolViewBackendResponse = { protocol: 'aibo.tool-view/1' } & ({result: unknown} | {error: string});
export type ToolViewInitialize = {workspacePath: string; workspaceId: string; windowId: string};
export type ToolViewStatus = {active: number};
