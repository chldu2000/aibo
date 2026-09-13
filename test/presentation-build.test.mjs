import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {buildPresentation} from '../packages/presentation-tools/build.mjs';
import {verifyPresentationPackage} from '../src/lib/presentation-runtime/package.ts';

test('packed builder builds theme and executable releases outside the repository with host integrity verification',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'aibo-presentation-build-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--offline','--json','--pack-destination',root,'--cache',path.join(root,'cache')],{cwd:path.resolve('packages/presentation-tools'),encoding:'utf8'}))[0];
  execFileSync('tar',['-xzf',path.join(root,packed.filename),'-C',root]);
  const base=JSON.parse(await readFile('examples/presentation-theme/presentation.source.json','utf8'));
  const config=path.join(root,'source.json'),cli=path.join(root,'package/build.mjs');
  await writeFile(config,JSON.stringify(base));
  execFileSync(process.execPath,[cli,config,path.join(root,'theme')],{cwd:root});
  assert.deepEqual((await verifyPresentationPackage(await readFile(path.join(root,'theme/presentation.json'),'utf8'),async()=>assert.fail())).manifest,base);
  const script='globalThis.aiboPresentation={render:()=>({tag:"main",text:"Example"})};';
  await writeFile(path.join(root,'skin.js'),script);
  await writeFile(config,JSON.stringify({...base,version:'1.0.1',entry:'skin.js',surfaces:['workbench'],resources:[{path:'skin.js',mediaType:'text/javascript'}]}));
  execFileSync(process.execPath,[cli,config,path.join(root,'full')],{cwd:root});
  const source=await readFile(path.join(root,'full/presentation.json'),'utf8');
  const verified=await verifyPresentationPackage(source,name=>readFile(path.join(root,'full',name)));
  assert.equal(verified.manifest.version,'1.0.1');
  assert.equal(Buffer.from(verified.resources.get('skin.js')).toString(),script);
  await assert.rejects(buildPresentation(config,path.join(root,'full')),/output_exists/);
  assert.equal(await readFile(path.join(root,'full/presentation.json'),'utf8'),source);
  await writeFile(path.join(root,'full/skin.js'),'tampered');
  await assert.rejects(verifyPresentationPackage(source,name=>readFile(path.join(root,'full',name))),/mismatch/);
});

test('builder rejects traversal, symlink resources and invalid themes before publishing output',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'aibo-presentation-invalid-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const base=JSON.parse(await readFile('examples/presentation-theme/presentation.source.json','utf8'));
  const config=path.join(root,'source.json'),output=path.join(root,'output');
  for(const name of ['../escape.js','/absolute.js']){
    await writeFile(config,JSON.stringify({...base,entry:name,surfaces:['workbench'],resources:[{path:name,mediaType:'text/javascript'}]}));
    await assert.rejects(buildPresentation(config,output),/invalid_presentation_manifest/);
  }
  await writeFile(path.join(root,'real.js'),'example');await symlink('real.js',path.join(root,'link.js'));
  await writeFile(config,JSON.stringify({...base,entry:'link.js',surfaces:['workbench'],resources:[{path:'link.js',mediaType:'text/javascript'}]}));
  await assert.rejects(buildPresentation(config,output),/symlink/);
  await writeFile(config,JSON.stringify({...base,themes:[{...base.themes[0],tokens:{'--primary':'url(https://example.com)'}}]}));
  await assert.rejects(buildPresentation(config,output),/unsafe_presentation_token/);
  await assert.rejects(readFile(path.join(output,'presentation.json')),/ENOENT/);
});
