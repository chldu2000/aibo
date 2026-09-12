import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('packed protocol compiles and imports outside the repository without DOM or framework dependencies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aibo-protocol-package-'));
  const source = path.resolve('packages/plugin-protocol');
  const tsc = path.resolve('node_modules/typescript/bin/tsc');
  const staging = path.join(root, 'staging'), consumer = path.join(root, 'consumer');
  try {
    await mkdir(staging); await mkdir(consumer);
    for (const name of ['package.json', 'README.md']) await copyFile(path.join(source,name),path.join(staging,name));
    execFileSync(process.execPath,[tsc,'-p',path.join(source,'tsconfig.json'),'--outDir',path.join(staging,'dist')],{stdio:'pipe'});
    const packed = JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--offline','--json','--cache',path.join(root,'cache')],{cwd:staging,encoding:'utf8'}))[0];
    assert.ok(packed.files.some(file=>file.path==='dist/semantic.d.ts'));
    assert.ok(packed.files.every(file=>file.path==='package.json'||file.path==='README.md'||/^dist\/[a-z]+\.(?:js|d\.ts)$/.test(file.path)), 'archive only contains public built contracts');
    const installed = path.join(consumer,'node_modules/@aibo/plugin-protocol');
    await mkdir(installed,{recursive:true});
    execFileSync('tar',['-xzf',path.join(staging,packed.filename),'-C',installed,'--strip-components=1']);
    const manifest = JSON.parse(await readFile(path.join(installed,'package.json'),'utf8'));
    assert.equal(manifest.dependencies,undefined); assert.equal(manifest.peerDependencies,undefined);
    await writeFile(path.join(consumer,'consumer.mts'), `
import { SEMANTIC_SCHEMA, type Snapshot } from '@aibo/plugin-protocol/semantic';
import type { PresentationSnapshot } from '@aibo/plugin-protocol/presentation';
import { CORE_SEMANTICS, type RendererDescriptor } from '@aibo/plugin-protocol/renderer';
import type { JsonValue } from '@aibo/plugin-protocol';
const value: JsonValue = { schema: SEMANTIC_SCHEMA };
const descriptor: RendererDescriptor = {id:'dev.example.renderer',version:'1.0.0',semanticVersion:'1.0.0',core:CORE_SEMANTICS,optional:[]};
type Message = PresentationSnapshot<Snapshot>;
// @ts-expect-error The protocol must not require or introduce DOM globals.
type BrowserGlobal = Window;
`);
    await writeFile(path.join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',lib:['ES2022'],types:[],strict:true,noEmit:true},include:['consumer.mts']}));
    execFileSync(process.execPath,[tsc,'-p','tsconfig.json'],{cwd:consumer,stdio:'pipe'});
    execFileSync(process.execPath,['--input-type=module','--eval',`
      import { SEMANTIC_SCHEMA, CORE_SEMANTICS } from '@aibo/plugin-protocol';
      import '@aibo/plugin-protocol/presentation';
      import '@aibo/plugin-protocol/semantic';
      import '@aibo/plugin-protocol/renderer';
      if (SEMANTIC_SCHEMA !== 'aibo.semantic-view/v1' || CORE_SEMANTICS.length !== 4) throw Error('Invalid packaged exports');
    `],{cwd:consumer,stdio:'pipe'});
  } finally { await rm(root,{recursive:true,force:true}); }
});
