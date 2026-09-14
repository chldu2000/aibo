import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { buildExternalPlugin } from '../probes/build-external-plugin.mjs';

test('external plugin archive contains compiled code and vendored SDKs without build-directory dependencies',async()=>{
  const built=await buildExternalPlugin();
  try {
    assert.ok(!built.packagePath.startsWith(process.cwd()+path.sep));
    const manifest=JSON.parse(await readFile(path.join(built.packagePath,'package.json'),'utf8'));
    assert.deepEqual(manifest.dependencies,{'@aibo/capability-runtime':'0.1.0','@aibo/plugin-protocol':'0.1.0'});
    for(const file of built.evidence.files) {
      const filename=path.join(built.packagePath,file);
      assert.equal((await lstat(filename)).isSymbolicLink(),false);
      assert.equal((await readFile(filename,'utf8')).includes(built.root),false,`build path leaked into ${file}`);
    }
    const plugin=JSON.parse(await readFile(path.join(built.packagePath,'plugin.json'),'utf8'));
    assert.equal(plugin.entrypoint.executable,'dist/worker.js');
    assert.ok(built.evidence.files.includes('node_modules/@aibo/capability-runtime/runtime.mjs'));
  } finally {await rm(built.root,{recursive:true,force:true});}
});
