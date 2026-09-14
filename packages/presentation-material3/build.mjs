import {readFile,writeFile,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {workbenchSource} from '@aibo/presentation-workbench/bundle';
import {buildPresentation} from '@aibo/presentation-tools/build';
const metadata=JSON.parse(await readFile(new URL('./themes.json',import.meta.url),'utf8'));
const packageVersion=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8')).version;
const version=process.argv[3]??packageVersion;
const output=process.argv[2]??`dist/${metadata.id}-${version}`;
const staging=await mkdtemp(path.join(tmpdir(),'aibo-skin-source-'));
try {
  const paths={};
  for(const [agent,file] of [['codex','openai.svg'],['pi','pi.svg']]) {
    const svg=await readFile(new URL('assets/'+file,import.meta.url),'utf8');
    const value=svg.match(/<path d="([^"]+)"/u)?.[1];
    if(!value)throw Error('missing_agent_vector_path');
    paths[agent]=value;
  }
  const script=await readFile(new URL('skin.js',import.meta.url),'utf8');
  await writeFile(path.join(staging,'skin.js'),'const agentPaths='+JSON.stringify(paths)+';\n'+await workbenchSource()+script);
  await copyFile(new URL('skin.css',import.meta.url),path.join(staging,'skin.css'));
  const manifest={schema:'aibo.presentation-package/v1',id:`dev.aibo.presentation.${metadata.id}`,version,displayName:metadata.label,hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1','aibo.semantic-view/v1.1','aibo.semantic-view/experimental-v1'],entry:'skin.js',surfaces:(process.argv[4]??'controls,semantic,workbench').split(','),defaultThemeId:metadata.defaultThemeId,themes:metadata.themes.map(({id,label,colorScheme,tokens})=>({id,label,colorScheme,tokens:Object.fromEntries(Object.entries(tokens).map(([key,value])=>[key,value.replaceAll("'",'')]))})),resources:[{path:'skin.js',mediaType:'text/javascript'},{path:'skin.css',mediaType:'text/css'}]};
  const config=path.join(staging,'source.json');await writeFile(config,JSON.stringify(manifest));
  await buildPresentation(config,output);console.log(path.resolve(output));
} finally {await rm(staging,{recursive:true,force:true});}
