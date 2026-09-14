import readline from 'node:readline';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url),'utf8'));
let privateData;
for await (const line of readline.createInterface({input:process.stdin})) {
  const message=JSON.parse(line),p=message.params;
  let result;
  if(message.method==='capability.initialize') {
    privateData=p.privateData;
    result={protocol:'2.0',pluginId:manifest.pluginId,pluginVersion:manifest.version,generationId:p.generationId,operations:manifest.contributions.flatMap(c=>(c.operations??[]).map(o=>({capability:o.capability.id,version:o.capability.version,operationId:o.id})))};
  } else if(message.method==='capability.invoke') {
    const declaration=manifest.contributions.find(c=>c.provider?.capability===p.capability);
    result={invocationId:p.invocationId,generationId:p.generationId,output:{
      state:{status:'ready',message:'Read-only configuration and inspection'},
      view:{kind:declaration.semanticType,itemId:p.capability,properties:[{label:'Scope',value:p.scope.kind},{label:'Storage format',value:String(privateData.formatVersion)}],content:'CATALOG_OK',truncated:false},
      actions:[{id:'refresh',label:'刷新',intent:'refresh',enabled:true}]
    }};
  } else continue;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');
}
