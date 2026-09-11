import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url),'utf8'));
let generation;
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
createInterface({input:process.stdin}).on('line',line=>{
  const {id,method,params:p}=JSON.parse(line);
  if(method==='capability.initialize') {
    generation=p.generationId;
    const contribution=manifest.contributions.find(item=>item.id===p.contributionId);
    reply(id,{protocol:'2.0',pluginId:manifest.pluginId,pluginVersion:manifest.version,generationId:generation,operations:contribution.operations.map(op=>({capability:op.capability.id,version:op.capability.version,operationId:op.id}))});
  } else if(method==='capability.invoke') {
    if(p.input.mode==='crash')process.exit(1);
    setTimeout(()=>reply(id,{invocationId:p.invocationId,generationId:p.input.mode==='wrong-generation'?'old-generation':generation,output:p.input.mode==='wrong-output'?{unexpected:true}:{value:p.input.value,workspacePath:p.context.workspacePath}}),p.input.delayMs??0);
  }
});
