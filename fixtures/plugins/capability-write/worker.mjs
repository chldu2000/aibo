import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
// Tests supply a marker outside the installed package to detect even process startup.
if (process.argv[2]) appendFileSync(process.argv[2], 'started\n');
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params: p } = JSON.parse(line);
  if (method === 'capability.initialize') {
    const contribution = manifest.contributions.find(item => item.id === p.contributionId);
    reply(id, { protocol: '2.0', pluginId: manifest.pluginId, pluginVersion: manifest.version, generationId: p.generationId,
      operations: contribution.operations.map(op => ({ capability: op.capability.id, version: op.capability.version, operationId: op.id })) });
  } else if (method === 'capability.invoke') {
    appendFileSync(path.join(p.context.workspacePath, 'effect.txt'), p.input.value + '\n');
    if (p.input.mode === 'crash') process.exit(1);
    if (p.input.mode === 'slow') {
      spawn(process.execPath, ['-e', 'setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"late"),3000)', path.join(p.context.workspacePath, 'late.txt')], { stdio: 'ignore' });
    }
    setTimeout(() => reply(id, { invocationId: p.invocationId, generationId: p.generationId,
      output: p.input.mode === 'invalid-output' ? { invalid: true } : { value: p.input.value, caller: p.context.originalCaller.id, permissions: p.context.permissions, chainLength: p.context.callChain.length } }), p.input.mode === 'slow' ? 5000 : 0);
  }
});
