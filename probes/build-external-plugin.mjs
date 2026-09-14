import { mkdtemp, mkdir, copyFile, cp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Build actual SDK tarballs and a separate consumer; no workspace links or app imports. */
export async function buildExternalPlugin() {
  const root=await mkdtemp(path.join(tmpdir(),'aibo-external-plugin-'));
  const cache=path.join(root,'npm-cache');
  const tsc=path.resolve('node_modules/typescript/bin/tsc');
  const protocol=path.join(root,'protocol'),sdk=path.join(root,'sdk'),consumer=path.join(root,'consumer');
  await mkdir(protocol);await mkdir(sdk);
  const pack=directory=>JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--cache',cache],{cwd:directory,encoding:'utf8'}))[0];
  for(const name of ['package.json','README.md']) await copyFile(path.resolve('packages/plugin-protocol',name),path.join(protocol,name));
  execFileSync(process.execPath,[tsc,'-p',path.resolve('packages/plugin-protocol/tsconfig.json'),'--outDir',path.join(protocol,'dist')]);
  const protocolTar=path.join(protocol,pack(protocol).filename);
  for(const name of ['package.json','README.md','runtime.mjs','stdio.mjs','runtime.d.ts','stdio.d.ts']) await copyFile(path.resolve('packages/capability-runtime',name),path.join(sdk,name));
  const sdkTar=path.join(sdk,pack(sdk).filename);
  await cp(path.resolve('examples/capability-plugin'),consumer,{recursive:true});
  execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',cache,protocolTar,sdkTar],{cwd:consumer,stdio:'pipe'});
  await copyFile(path.resolve('examples/capability-plugin/package.json'),path.join(consumer,'package.json'));
  execFileSync(process.execPath,[tsc,'-p','tsconfig.json'],{cwd:consumer,stdio:'pipe'});
  const archive=pack(consumer);
  if(!archive.files.some(file=>file.path==='dist/worker.js') || !archive.files.some(file=>file.path==='node_modules/@aibo/capability-runtime/stdio.mjs')) throw Error('External archive is missing its worker or SDK');
  if(archive.files.some(file=>/svelte|\.css$|\.tsx?$/.test(file.path.replace(/\.d\.ts$/,'.types')))) throw Error('External runtime archive contains frontend or uncompiled source');
  const packagePath=path.join(root,'unpacked');await mkdir(packagePath);
  execFileSync('tar',['-xzf',path.join(consumer,archive.filename),'-C',packagePath,'--strip-components=1']);
  const evidence={externalDirectory:true,offlineSdkTarballs:true,compiledWithoutDom:true,bundledRuntime:true,files:archive.files.map(file=>file.path)};
  await writeFile(path.join(root,'build-evidence.json'),JSON.stringify(evidence,null,2));
  return {root,packagePath,evidence};
}
