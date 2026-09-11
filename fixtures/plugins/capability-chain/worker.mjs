import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
const pending = new Map();
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
let contribution;
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  const { id, method, params: p } = message;
  if (method === 'capability.initialize') {
    contribution = manifest.contributions.find(item => item.id === p.contributionId);
    send({ id, result: { protocol: '2.0', pluginId: manifest.pluginId, pluginVersion: manifest.version, generationId: p.generationId, operations: contribution.operations.map(op => ({ capability: op.capability.id, version: op.capability.version, operationId: op.id })) } });
  } else if (method === 'capability.invoke') {
    const dependency = manifest.packageDependencies?.find(item => item.contributionIds.includes(contribution.id));
    if (!dependency) {
      setTimeout(() => send({ id, result: { invocationId: p.invocationId, generationId: p.generationId, output: { value: JSON.stringify({ value: p.input.value, caller: p.context.originalCaller, chain: p.context.callChain, permissions: p.context.permissions, deadline: p.deadlineUnixMs }), workspacePath: p.context.workspacePath } } }), p.input.delayMs ?? 0);
      return;
    }
    const params = { invocationId: p.invocationId, generationId: p.generationId, pluginId: dependency.pluginId, contributionId: `${dependency.pluginId}.read`, capability: `${dependency.pluginId}.echo`, version: '1.0.0', input: p.input };
    if (p.context.callChain.length === 1) {
      if (p.input.mode === 'stale') params.generationId = 'old-generation';
      if (p.input.mode === 'undeclared') params.pluginId = 'dev.aibo.other';
      if (p.input.mode === 'scope') params.scope = { kind: 'application' };
    }
    const childId = `child-${p.invocationId}`;
    pending.set(childId, { id, p });
    send({ id: childId, method: 'capability.call', params });
    if (p.input.mode === 'parent-crash' && p.context.callChain.length === 1) setTimeout(() => process.exit(1), 200);
  } else if (pending.has(id)) {
    const { id: parentId, p } = pending.get(id);
    pending.delete(id);
    if (message.result?.ok) send({ id: parentId, result: { invocationId: p.invocationId, generationId: p.generationId, output: message.result.response.output } });
    else send({ id: parentId, error: { code: -32000, message: 'Dependency rejected', data: { kind: message.result?.error.code ?? 'provider_unavailable' } } });
  }
});
