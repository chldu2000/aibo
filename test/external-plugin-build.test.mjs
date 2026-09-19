import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { buildExternalPlugin } from '../probes/build-external-plugin.mjs';

test('external plugin archive contains compiled code without SDK copies or build-directory dependencies',async()=>{
  const built=await buildExternalPlugin();
  try {
    assert.ok(!built.packagePath.startsWith(process.cwd()+path.sep));
    const manifest=JSON.parse(await readFile(path.join(built.packagePath,'package.json'),'utf8'));
    assert.deepEqual(manifest.devDependencies,{'@aibo/capability-runtime':'0.1.0','@aibo/plugin-protocol':'0.1.0'});
    for(const file of built.evidence.files) {
      const filename=path.join(built.packagePath,file);
      assert.equal((await lstat(filename)).isSymbolicLink(),false);
      assert.equal((await readFile(filename,'utf8')).includes(built.root),false,`build path leaked into ${file}`);
    }
    const plugin=JSON.parse(await readFile(path.join(built.packagePath,'plugin.json'),'utf8'));
    assert.equal(plugin.entrypoint.executable,'dist/worker.js');
    assert.equal(manifest.dependencies, undefined);
    assert.deepEqual(plugin.hostSdk, {min:'0.1.0',maxExclusive:'0.2.0'});
    assert.ok(built.evidence.files.every(file=>!file.startsWith('node_modules/')));
  } finally {await rm(built.root,{recursive:true,force:true});}
});
