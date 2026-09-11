import { createInterface } from 'node:readline';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
if (process.argv[2]) appendFileSync(process.argv[2], 'started\n');
const pending = new Map();
let contribution;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const output = p => ({ trace: [manifest.pluginId], caller: p.context.originalCaller.id, permissions: p.context.permissions, chain: JSON.stringify(p.context.callChain), deadline: p.deadlineUnixMs });
const reply = (id, p, value) => send({ id, result: { invocationId: p.invocationId, generationId: p.generationId, output: value } });
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line); const { id, method, params: p } = message;
  if (method === 'capability.initialize') {
    contribution = manifest.contributions.find(item => item.id === p.contributionId);
    send({ id, result: { protocol: '2.0', pluginId: manifest.pluginId, pluginVersion: manifest.version, generationId: p.generationId, operations: contribution.operations.map(op => ({ capability: op.capability.id, version: op.capability.version, operationId: op.id })) } });
  } else if (method === 'capability.invoke') {
    if (p.context.permissions.includes('workspace.write')) appendFileSync(path.join(p.context.workspacePath, `${manifest.pluginId}.txt`), p.input.value + '\n');
    const dependency = manifest.packageDependencies?.find(item => item.contributionIds.includes(contribution.id));
    if (!dependency) {
      if (p.input.mode === 'crash' || p.input.mode === 'ignore-unknown') process.exit(1);
      if (p.input.mode === 'slow') spawn(process.execPath, ['-e', 'setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"late"),3000)', path.join(p.context.workspacePath, 'late.txt')], { stdio: 'ignore' });
      setTimeout(() => reply(id, p, p.input.mode === 'invalid-output' ? { invalid: true } : output(p)), p.input.mode === 'slow' ? 5000 : 0);
      return;
    }
    const childId = `child-${p.invocationId}`;
    const params = { invocationId: p.invocationId, generationId: p.generationId, pluginId: dependency.pluginId, contributionId: `${dependency.pluginId}.worker`, capability: `${dependency.pluginId}.run`, version: '1.0.0', input: p.input };
    if (p.context.callChain.length === 1) {
      if (p.input.mode === 'forged') params.generationId = 'wrong-generation';
      if (p.input.mode === 'undeclared') params.pluginId = 'dev.aibo.undeclared';
    }
    const call = { id: childId, method: 'capability.call', params };
    pending.set(childId, { id, p, call }); send(call);
    if (p.input.mode === 'parent-crash' && p.context.callChain.length === 1) setTimeout(() => process.exit(1), 200);
  } else if (pending.has(id)) {
    const { id: parentId, p, call } = pending.get(id); pending.delete(id);
    if (p.input.mode === 'duplicate') { send(call); return; }
    if (p.input.mode === 'ignore-unknown') writeFileSync(path.join(p.context.workspacePath, 'parent-continued.txt'), 'incorrectly resumed');
    if (message.result?.ok) { const value = message.result.response.output; value.trace.unshift(manifest.pluginId); reply(parentId, p, value); }
    else { const value = output(p); value.trace.push(`error:${message.result?.error?.code}`); reply(parentId, p, value); }
  }
});
