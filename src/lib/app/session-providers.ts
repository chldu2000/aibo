/** Session creation is discovered from capability contracts, never legacy Agent metadata. */
export function sessionProviders(installation: {
  contributions?: { id: string; kind: string; scope: string; metadata: Record<string, unknown> }[];
}): { id: string; displayName: string }[] {
  return (installation.contributions ?? []).flatMap(contribution => {
    if (contribution.kind !== 'capabilityProvider' || contribution.scope !== 'session') return [];
    const operations = contribution.metadata.operations;
    if (!Array.isArray(operations) || !operations.some(operation => operation?.capability?.id === 'aibo.session.open')) return [];
    return [{ id: contribution.id, displayName: typeof contribution.metadata.displayName === 'string' ? contribution.metadata.displayName : contribution.id }];
  });
}
