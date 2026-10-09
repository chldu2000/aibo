/** Backend lifetime belongs to the window, never to a mounted iframe or chat. */
export type ToolViewTarget = { installationId: string; contributionId: string };
export type ToolViewHandle = { id: string; url: string };
export type ToolViewPort = {
  open(workspaceId: string, installationId: string, contributionId: string): Promise<ToolViewHandle>;
  request(id: string, request: unknown): Promise<unknown>;
  close(id: string): Promise<boolean>;
};
export function createToolViewController(port: ToolViewPort) {
  const instances = new Map<string, Promise<ToolViewHandle>>();
  const key = (workspace: string, target: ToolViewTarget) => JSON.stringify([workspace, target.installationId, target.contributionId]);
  return {
    open(workspace: string, target: ToolViewTarget) {
      const identity = key(workspace, target);
      let pending = instances.get(identity);
      if (!pending) {
        pending = port.open(workspace, target.installationId, target.contributionId);
        instances.set(identity, pending);
        void pending.catch(() => { if (instances.get(identity) === pending) instances.delete(identity); });
      }
      return pending;
    },
    request: port.request,
    async close(workspace: string, target: ToolViewTarget) {
      const identity = key(workspace, target), pending = instances.get(identity);
      if (!pending) return true;
      const handle = await pending.catch(() => null);
      if (handle && !await port.close(handle.id)) return false;
      instances.delete(identity); return true;
    },
    reconcile(installationIds: string[]) {
      for (const identity of instances.keys()) if (!installationIds.includes(JSON.parse(identity)[1])) instances.delete(identity);
    },
    forget(installationId: string) {
      for (const identity of instances.keys()) if (JSON.parse(identity)[1] === installationId) instances.delete(identity);
    },
  };
}
