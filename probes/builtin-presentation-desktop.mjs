// Native lifecycle of built-in appearances as preinstalled releases: legacy cache migration,
// immutability, hostApi 1.1.0 packages, fallback to the last built-in choice, per-window
// selection, and replacement of built-in rows after a host rebuild. Uses an isolated app identifier.
import {createServer} from 'vite';
import {mkdir,mkdtemp,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {buildPresentationSkins} from './lib/build-presentation-skins.mjs';
import {buildPresentation} from '../packages/presentation-tools/build.mjs';
if(process.platform!=='darwin')throw Error('Native built-in presentation probe currently targets macOS');

const built=await buildPresentationSkins();
const root=await mkdtemp(path.join(tmpdir(),'aibo-builtin-native-'));
// A local package claiming the reserved built-in identity must be refused.
const reserved=path.join(root,'reserved');await mkdir(reserved);
await writeFile(path.join(reserved,'presentation.json'),JSON.stringify({schema:'aibo.presentation-package/v1',id:'dev.aibo.builtin.impostor',version:'1.0.0',displayName:'Impostor',hostApi:'1.1.0',coreSemantics:'1.0.0',snapshotSchemas:['aibo.semantic-view/v1'],resources:[],themes:[{id:'dark',label:'Dark',colorScheme:'dark',tokens:{'--primary':'#123456'}}],defaultThemeId:'dark'}));
// A healthy release whose Worker locks up after activation, forcing a runtime fallback.
const faultSource=path.join(root,'fault-source');await cp(path.join(built.root,'shadcn'),faultSource,{recursive:true});
await writeFile(path.join(faultSource,'skin.js'),(await readFile(path.join(faultSource,'skin.js'),'utf8'))+'\nconst nativeRender=self.aiboPresentation.render;let nativeFaultScheduled=false;self.aiboPresentation.render=input=>{const tree=nativeRender(input);if(input.surface==="workbench"&&!nativeFaultScheduled){nativeFaultScheduled=true;setTimeout(()=>{while(true){}},4000);}return tree;};\n');
const faultManifest=JSON.parse(await readFile(path.join(faultSource,'presentation.json'),'utf8'));faultManifest.version='0.4.9';
await writeFile(path.join(faultSource,'source.json'),JSON.stringify(faultManifest));
const runtimeFault=path.join(root,'runtime-fault');await buildPresentation(path.join(faultSource,'source.json'),runtimeFault);

const stamp=Date.now();
const mainWindowId=`builtin-probe-${stamp}`,secondWindowId=`builtin-probe-second-${stamp}`;
const capability={...JSON.parse(await readFile('src-tauri/capabilities/default.json','utf8')),windows:[mainWindowId,secondWindowId]};
capability.permissions=[...capability.permissions,'core:webview:allow-create-webview-window'];
let phase=0,finish,expected=null,second=null;
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null},plugins:[{name:'builtin-native-probe',configureServer(server){
  const json=(res,value)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  const body=req=>new Promise(resolve=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>resolve(JSON.parse(text)));});
  server.middlewares.use('/__builtin_native_config',(_req,res)=>json(res,{phase,expected,secondWindowId,paths:{shadcn:path.join(built.root,'shadcn'),material3:path.join(built.root,'material3'),reserved,runtimeFault}}));
  server.middlewares.use('/__builtin_native_report',async(req,res)=>{try{finish(await body(req));res.end('ok');}catch{res.statusCode=400;res.end('invalid report');}});
  server.middlewares.use('/__builtin_native_second',async(req,res)=>{if(req.method==='POST'){second=await body(req);res.end('ok');}else json(res,second);});
}}]});
await server.listen();
const identifier=`local.aibo.builtinprobe.${stamp}`;const config=path.join(root,'tauri.json');
await writeFile(config,JSON.stringify({identifier,productName:'Aibo built-in presentation probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${server.httpServer.address().port}`},
  app:{security:{capabilities:[capability]},windows:[{label:mainWindowId,title:'Aibo built-in presentation probe',url:'probes/builtin-presentation-desktop.html',width:1280,height:900}]}}));
const sqlite=(database,sql)=>execFileSync('sqlite3',[database,sql],{encoding:'utf8'}).trim();
const evidence=[];let child;
try{
  for(phase=0;phase<3;phase++){
    console.log('BUILTIN_NATIVE_START '+phase+' '+identifier);
    const report=new Promise(resolve=>finish=resolve);let timer;
    child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{stdio:['ignore','pipe','pipe'],detached:true});
    child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
    try{
      // The first phase includes the native build.
      const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Native probe timeout in phase '+phase)),phase===0?900000:300000)),
        new Promise((_,reject)=>child.on('exit',code=>reject(Error('Tauri exited before report: '+code))))]);
      console.log('BUILTIN_NATIVE_PHASE '+JSON.stringify(result));evidence.push(result);
      if(!result.ok)throw Error(result.error);
      expected={...expected,...result.expected};
    }finally{
      clearTimeout(timer);
      const exited=child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve));
      try{process.kill(-child.pid,'SIGTERM');}catch{}await exited;child=null;
    }
    if(phase===1){
      // Simulate a host rebuild: the ak-ui row becomes an older build, and a kit this build no longer ships appears.
      if(path.basename(path.resolve(expected.dataPath))!==identifier||!/^[a-f0-9]{64}$/.test(expected.akUi))throw Error('unsafe_native_tamper_target');
      const database=path.join(expected.dataPath,'aibo.sqlite3'),old='0'.repeat(64),retired='1'.repeat(64);
      sqlite(database,`PRAGMA foreign_keys=OFF;
        UPDATE presentation_selections SET digest='${old}' WHERE digest='${expected.akUi}';
        UPDATE presentation_releases SET digest='${old}',version='0.0.9' WHERE digest='${expected.akUi}';
        INSERT INTO presentation_releases(digest,plugin_id,version,manifest_json) VALUES('${retired}','dev.aibo.builtin.retired','0.0.1','{}');
        UPDATE presentation_selections SET digest='${retired}',theme_id=NULL WHERE window_id='${secondWindowId}';`);
      evidence.push({tamper:'ak-ui row rewritten as an older build; retired built-in selected by the second window'});
    }
  }
  const database=path.join(expected.dataPath,'aibo.sqlite3');
  const leftovers=sqlite(database,`SELECT COUNT(*) FROM presentation_releases WHERE digest IN ('${'0'.repeat(64)}','${'1'.repeat(64)}') OR plugin_id='dev.aibo.builtin.retired';`);
  const secondSelection=sqlite(database,`SELECT COUNT(*) FROM presentation_selections WHERE window_id='${secondWindowId}';`);
  const mainSelection=sqlite(database,`SELECT digest||'|'||IFNULL(theme_id,'') FROM presentation_selections WHERE window_id='${mainWindowId}';`);
  if(leftovers!=='0')throw Error('stale or retired built-in rows remain: '+leftovers);
  if(secondSelection!=='0')throw Error('selection of a retired built-in survived startup');
  if(mainSelection!==`${expected.akUi}|light`)throw Error('rebuilt ak-ui selection not migrated: '+mainSelection);
  evidence.push({database:'no stale or retired built-in rows; retired selection removed; main window migrated to the rebuilt ak-ui release with its theme'});
  const result={ok:true,platform:process.platform,architecture:process.arch,identifier,evidence,
    interaction:'scripted native host DOM clicks and real Tauri IPC in WKWebView; physical input and screen reader not claimed'};
  await writeFile('/tmp/aibo-builtin-presentation-native-result.json',JSON.stringify(result,null,2)+'\n');
  console.log('BUILTIN_NATIVE_RESULT '+JSON.stringify(result));
}finally{
  if(child)try{process.kill(-child.pid,'SIGTERM');}catch{}
  await server.close();await built.dispose();await rm(root,{recursive:true,force:true});
  console.log('Isolated application identifier: '+identifier);
}
