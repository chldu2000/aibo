import { createServer } from 'vite';

// Preview fixture shared by built-in appearance probes. The real App owns all
// interactions; this transform supplies only local workspace/session data.
export function createBuiltinWorkbenchServer() {
  return createServer({server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false,watch:null},plugins:[{
  name:'ak-ui-preview-data',enforce:'pre',transform(code,id){
    if(!id.endsWith('/src/App.svelte'))return;
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces.map(item => ({...item,label:'aibo-dev',trust:'trusted'}));
      workspaceSessionMap = { 'preview-workspace': ['a','b'].map((id,index)=>({
        id,workspaceId:'preview-workspace',agent:'third.party.agent',label:index?'完善会话恢复测试':'重构默认视觉体验',
        state:'idle',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:[],createdAt:'2026-09-22',updatedAt:'2026-09-22'
      }))};
      setTimeout(()=>{selectedSessionId='a';sidePanelView='context';},100);
      setTimeout(()=>{timeline=[
        {id:'u1',sessionId:'a',turnId:'turn',role:'user',entryType:'message',content:'使用 ak-ui 改造 Aibo 的默认界面。导航和工作区在同一主题下统一明暗，保留会话与代码变更的工作流。',status:'completed',createdAt:'2026-09-22T14:32:00Z'},
        {id:'a1',sessionId:'a',turnId:'turn',role:'assistant',entryType:'message',content:'## 让复杂的工作，拥有清晰的界面。\\n\\n默认工作台现在使用一套一致的视觉语言。\\n\\n1. **统一视觉层级**：浅色与深色主题保持一致。\\n2. **为内容留出空间**：对话、代码与操作各有清晰的优先级。\\n3. **保留完整工作流**：会话、工具调用、审批和插件仍由宿主管理。',status:'completed',createdAt:'2026-09-22T14:33:00Z'},
        {id:'t1',sessionId:'a',turnId:'turn',role:'tool',entryType:'tool_result',toolName:'read',content:'src/lib/ui-kit/contract.ts\\nsrc/lib/ui-kit/registry.ts',status:'completed',createdAt:'2026-09-22T14:33:01Z',updatedAt:'2026-09-22T14:33:13.400Z'}
      ];attachments = [{id:'image-fixture',sessionId:'a',turnId:null,path:'clipboard-wide.png',mediaType:'image/png',size:2400,source:'picker',sendStrategy:'inline',createdAt:'now'},{id:'file-fixture',sessionId:'a',turnId:null,path:'pnpm-lock.yaml',mediaType:'text/plain',size:1200,source:'picker',sendStrategy:'reference',createdAt:'now'}];},350);`);
  }
}]});
}
