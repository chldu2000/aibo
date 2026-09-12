import { serveCapability } from '@aibo/capability-runtime/stdio';
import type { Snapshot } from '@aibo/plugin-protocol';

serveCapability({
  pluginId:'dev.example.greeting',pluginVersion:'1.0.0',contributionId:'dev.example.greeting.provider',
  operations:[{capability:'dev.example.greeting.read',version:'1.0.0',operationId:'dev.example.greeting.read'}],
  async invoke(request) {
    const output: Pick<Snapshot,'state'|'view'|'actions'> = {
      state:{status:'ready',message:'Built outside the Aibo repository'},
      view:{kind:'detail',itemId:'greeting',properties:[{label:'Scope',value:request.scope.kind}],content:'EXTERNAL_SDK_OK',truncated:false},
      actions:[{id:'refresh',label:'刷新',intent:'refresh',enabled:true}],
    };
    return output;
  },
});
