// Real Pi AgentSession and model catalog; intercept only credentials and transport.
export * from '@earendil-works/pi-coding-agent';
import * as sdk from '@earendil-works/pi-coding-agent';
import {appendFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const sdkRoot=realpathSync(new URL('../../node_modules/@earendil-works/pi-coding-agent',import.meta.url));
const {createAssistantMessageEventStream}=await import(pathToFileURL(path.join(sdkRoot,'../pi-ai/dist/utils/event-stream.js')));
export const ModelRuntime={async create(){
  const runtime=await sdk.ModelRuntime.create({modelsPath:null,authPath:path.join(process.env.AIBO_CONTEXT_TEST_DIR,'auth.json'),allowModelNetwork:false});
  const model=runtime.getModel('openai','gpt-5.6-sol');
  runtime.checkAuth=async()=>true;
  runtime.hasConfiguredAuth=()=>true;
  runtime.getAuth=async()=>({auth:{apiKey:'fixture-only'}});
  runtime.getAvailableSnapshot=()=>[model];
  runtime.streamSimple=(model,context)=>{
    appendFileSync(path.join(process.env.AIBO_CONTEXT_TEST_DIR,'requests.jsonl'),JSON.stringify({model:model.id,provider:model.provider,baseUrl:model.baseUrl,contextWindow:model.contextWindow,messages:context.messages.length})+'\n');
    const stream=createAssistantMessageEventStream();
    const message={role:'assistant',content:[{type:'text',text:'OK'}],api:model.api,provider:model.provider,model:model.id,
      usage:{input:10,output:1,cacheRead:0,cacheWrite:0,totalTokens:11,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()};
    stream.push({type:'done',reason:'stop',message});stream.end(message);return stream;
  };
  return runtime;
}};
export async function createAgentSession(options){
  return sdk.createAgentSession({...options,agentDir:process.env.AIBO_CONTEXT_TEST_DIR,
    model:options.modelRuntime.getModel('openai','gpt-5.6-sol'),
    settingsManager:sdk.SettingsManager.inMemory({retry:{enabled:false}})});
}
