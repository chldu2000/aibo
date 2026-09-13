import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export async function buildPresentationSkins(){
  const root=await mkdtemp(path.join(tmpdir(),'aibo-independent-skins-'));
  try {
    for(const name of ['presentation-tools','presentation-shadcn','presentation-material3']) {
      const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--offline','--json','--pack-destination',root,'--cache',path.join(root,'cache')],{cwd:path.resolve('packages',name),encoding:'utf8'}))[0];
      const installed=path.join(root,'node_modules/@aibo',name);await mkdir(installed,{recursive:true});
      execFileSync('tar',['-xzf',path.join(root,packed.filename),'-C',installed,'--strip-components=1']);
    }
    const packages=[];
    for(const skin of ['shadcn','material3']) {
      const output=path.join(root,skin);
      execFileSync(process.execPath,[path.join(root,'node_modules/@aibo/presentation-'+skin+'/build.mjs'),output,'0.1.0'],{cwd:root,stdio:'pipe'});
      const source=await readFile(path.join(output,'presentation.json'),'utf8'),manifest=JSON.parse(source),resources={};
      for(const resource of manifest.resources)resources[resource.path]=(await readFile(path.join(output,resource.path))).toString('base64');
      packages.push({release:{digest:createHash('sha256').update(source).digest('hex'),enabled:true,manifest},resources});
    }
    return {root,packages,dispose:()=>rm(root,{recursive:true,force:true})};
  } catch(error) {await rm(root,{recursive:true,force:true});throw error;}
}
