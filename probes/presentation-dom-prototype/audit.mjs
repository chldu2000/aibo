import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const read = path => readFile(path, 'utf8');
const policies = JSON.parse(await read('probes/presentation-dom-prototype/action-policy.json'));
const counts = {};
for (const [domain, mapping] of Object.entries(policies)) {
  const source = await read(`packages/plugin-protocol/src/presentation-${domain}.ts`);
  const union = ['conversation', 'navigation'].includes(domain)
    ? source.match(new RegExp(`export type Presentation${domain[0].toUpperCase()+domain.slice(1)}Operation\\s*=([^;]+);`))[1]
    : source.match(/operation\s*:([^;]+);/)[1];
  const operations = [...union.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(Object.keys(mapping).sort(), operations.sort(), `${domain}: every operation must have an explicit proposed policy`);
  counts[domain] = operations.length;
}
const lib = await read('src-tauri/src/lib.rs');
const existing = lib.match(/let standard:[\s\S]*?tauri::generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(x => x.trim().split('::').at(-1)).filter(Boolean);
const permissions = await read('src-tauri/p0-permissions/host.toml');
const allowed = [...permissions.match(/commands.allow = \[([\s\S]*?)\]/)[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
assert.deepEqual(allowed.sort(), [...existing, 'p0_mount', 'p0_deliver', 'p0_control', 'p0_inspect'].sort());
const child = permissions.split('identifier = "p0-document-bridge"')[1];
assert.deepEqual([...child.match(/commands.allow = \[([\s\S]*?)\]/)[1].matchAll(/"([^"]+)"/g)].map(x => x[1]), ['p0_post']);
const result = { kind: 'static coverage audit; not execution authorization proof', operations: counts, totalOperations: Object.values(counts).reduce((a,b)=>a+b,0), existingHostCommands: existing.length, documentCommands: ['p0_post'], productionActionPolicyImplemented: false };
await writeFile('probes/presentation-dom-prototype/dist/action-audit.json', JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
