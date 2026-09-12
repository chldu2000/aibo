import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

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
    const sdkSource=path.resolve('packages/capability-runtime'),sdkStaging=path.join(root,'sdk');
    await mkdir(sdkStaging);
    for(const name of ['package.json','README.md','runtime.mjs','stdio.mjs','runtime.d.ts','stdio.d.ts']) await copyFile(path.join(sdkSource,name),path.join(sdkStaging,name));
    const sdkPacked=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--offline','--json','--cache',path.join(root,'cache')],{cwd:sdkStaging,encoding:'utf8'}))[0];
    const sdkInstalled=path.join(consumer,'node_modules/@aibo/capability-runtime');await mkdir(sdkInstalled,{recursive:true});
    execFileSync('tar',['-xzf',path.join(sdkStaging,sdkPacked.filename),'-C',sdkInstalled,'--strip-components=1']);
    const webStaging=path.join(root,'web');await mkdir(webStaging);
    for(const name of ['package.json','README.md','index.d.ts']) await copyFile(path.resolve('packages/web-presentation',name),path.join(webStaging,name));
    const webPacked=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--offline','--json','--cache',path.join(root,'cache')],{cwd:webStaging,encoding:'utf8'}))[0];
    assert.deepEqual(webPacked.files.map(file=>file.path).sort(),['README.md','index.d.ts','package.json']);
    const webInstalled=path.join(consumer,'node_modules/@aibo/web-presentation');await mkdir(webInstalled,{recursive:true});
    execFileSync('tar',['-xzf',path.join(webStaging,webPacked.filename),'-C',webInstalled,'--strip-components=1']);
    await writeFile(path.join(consumer,'consumer.mts'), `
import { SEMANTIC_SCHEMA, type Snapshot } from '@aibo/plugin-protocol/semantic';
import type { PresentationSnapshot } from '@aibo/plugin-protocol/presentation';
import { CORE_SEMANTICS, type RendererDescriptor } from '@aibo/plugin-protocol/renderer';
import type { JsonValue } from '@aibo/plugin-protocol';
import { createCapabilityRuntime } from '@aibo/capability-runtime';
import { serveCapability } from '@aibo/capability-runtime/stdio';
const runtimeOptions = {pluginId:'dev.example.echo',pluginVersion:'1.0.0',contributionId:'dev.example.echo.worker',operations:[],invoke:async()=>null};
createCapabilityRuntime({...runtimeOptions,send(message:JsonValue){}});
type StdioEntry = typeof serveCapability;
const value: JsonValue = { schema: SEMANTIC_SCHEMA };
const descriptor: RendererDescriptor = {id:'dev.example.renderer',version:'1.0.0',semanticVersion:'1.0.0',core:CORE_SEMANTICS,optional:[]};
type Message = PresentationSnapshot<Snapshot>;
// @ts-expect-error The protocol must not require or introduce DOM globals.
type BrowserGlobal = Window;
`);
    await writeFile(path.join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',lib:['ES2022'],types:[],strict:true,noEmit:true},include:['consumer.mts']}));
    execFileSync(process.execPath,[tsc,'-p','tsconfig.json'],{cwd:consumer,stdio:'pipe'});
    await writeFile(path.join(consumer,'web-consumer.mts'),`
import type { WebPresentationAdapter } from '@aibo/web-presentation';
const adapter: WebPresentationAdapter = { async mount(target, props) {
  target.textContent = props.snapshot.state.message;
  return {update(snapshot){ target.textContent = snapshot.state.message; },async dispose(){target.replaceChildren();}};
}};
`);
    const webConfig={compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',lib:['ES2022'],types:[],strict:true,noEmit:true},include:['web-consumer.mts']};
    await writeFile(path.join(consumer,'web-tsconfig.json'),JSON.stringify(webConfig));
    const withoutDom=spawnSync(process.execPath,[tsc,'-p','web-tsconfig.json'],{cwd:consumer,encoding:'utf8'});
    assert.notEqual(withoutDom.status,0,'the Web contract must be an explicit DOM opt-in');
    assert.match(withoutDom.stdout,/HTMLElement/);
    webConfig.compilerOptions.lib.push('DOM');
    await writeFile(path.join(consumer,'web-tsconfig.json'),JSON.stringify(webConfig));
    execFileSync(process.execPath,[tsc,'-p','web-tsconfig.json'],{cwd:consumer,stdio:'pipe'});
    execFileSync(process.execPath,['--input-type=module','--eval',`
      import { SEMANTIC_SCHEMA, CORE_SEMANTICS } from '@aibo/plugin-protocol';
      import '@aibo/plugin-protocol/presentation';
      import '@aibo/plugin-protocol/semantic';
      import '@aibo/plugin-protocol/renderer';
      import { createCapabilityRuntime } from '@aibo/capability-runtime';
      import { serveCapability } from '@aibo/capability-runtime/stdio';
      if(typeof createCapabilityRuntime !== 'function' || typeof serveCapability !== 'function') throw Error('Missing SDK exports');
      if (SEMANTIC_SCHEMA !== 'aibo.semantic-view/v1' || CORE_SEMANTICS.length !== 4) throw Error('Invalid packaged exports');
    `],{cwd:consumer,stdio:'pipe'});
  } finally { await rm(root,{recursive:true,force:true}); }
});
