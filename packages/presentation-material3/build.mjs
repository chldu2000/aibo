import {readFile,writeFile,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildPresentation} from '@aibo/presentation-tools/build';
const metadata=JSON.parse(await readFile(new URL('./themes.json',import.meta.url),'utf8'));
const version=process.argv[3]??'0.1.0';
const output=process.argv[2]??`dist/${metadata.id}-${version}`;
const staging=await mkdtemp(path.join(tmpdir(),'aibo-skin-source-'));
try {
  for(const name of ['skin.js','skin.css'])await copyFile(new URL(name,import.meta.url),path.join(staging,name));
  const manifest={schema:'aibo.presentation-package/v1',id:`dev.aibo.presentation.${metadata.id}`,version,displayName:metadata.label,hostApi:'1.0.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1','aibo.semantic-view/v1.1','aibo.semantic-view/experimental-v1'],entry:'skin.js',surfaces:['controls','semantic'],defaultThemeId:metadata.defaultThemeId,themes:metadata.themes.map(({id,label,colorScheme,tokens})=>({id,label,colorScheme,tokens:Object.fromEntries(Object.entries(tokens).map(([key,value])=>[key,value.replaceAll("'",'')]))})),resources:[{path:'skin.js',mediaType:'text/javascript'},{path:'skin.css',mediaType:'text/css'}]};
  const config=path.join(staging,'source.json');await writeFile(config,JSON.stringify(manifest));
  await buildPresentation(config,output);console.log(path.resolve(output));
} finally {await rm(staging,{recursive:true,force:true});}
