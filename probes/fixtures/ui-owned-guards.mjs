export const ownedGuardCases = [
  ['builtin', 'native.presentation.unavailable'],
  ['theme', 'presentation.invalidTheme'],
  ['identity', 'presentation.rendererIdentity'],
  ['core', 'presentation.rendererCore'],
  ['limit', 'presentation.rendererLimit'],
  ['schemas', 'presentation.rendererSchemas'],
  ['optional', 'presentation.rendererOptional'],
  ['version', 'presentation.snapshotVersion'],
  ['state', 'presentation.invalidState'],
  ['project', 'error.projectActionIdentity'],
  ['diff', 'error.turnDiffIdentity'],
];

// Exercise production producers with isolated data. The probe supplies only their ports.
export async function exerciseOwnedGuard(kind, snapshot) {
  const descriptor = {id:'dev.test.renderer',version:'1.0.0',semanticVersion:'1.0.0',core:['collection','detail','settings','inspector'],optional:[]};
  let canonical = null;
  try {
    if (kind === 'builtin' || kind === 'theme') {
      const {builtinAppearance} = await import('/src/lib/app/builtin-presentation.ts');
      const kit = {id:'probe',packageId:'dev.test.probe',defaultThemeId:'light',themes:[{id:'light'}]};
      const release = {source:kind === 'builtin' ? 'local' : 'builtin',manifest:{id:kit.packageId}};
      canonical = {release,kit};
      builtinAppearance(release,'missing',[kit]);
    } else if (kind === 'version') {
      const {choosePresentation} = await import('/src/lib/app/renderer-negotiation.ts');
      const input = {...structuredClone(snapshot),schema:'aibo.semantic-view/v1.1'};
      canonical = {descriptor,input};
      choosePresentation(descriptor,input);
    } else if (kind === 'state') {
      const {createViewStateStore} = await import('/src/lib/app/view-state-storage.ts');
      const storage = new Map();
      const store = createViewStateStore({getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},'guard',()=>99);
      const scope = {workspaceId:'workspace 原文',contributionId:'contribution 原文'};
      const valid = {selection:'item 原文',detail:null,offset:3,layout:'central'};
      store.write(scope,valid);
      const before = [...storage];
      try { store.write(scope,{...valid,offset:10000}); }
      catch (error) { canonical = {before,after:[...storage],restored:store.read(scope),valid}; throw error; }
    } else if (kind === 'project') {
      const {createProjectEditorController} = await import('/src/lib/app/project-editor-controller.ts');
      const action = {id:'action',workspaceId:'workspace',name:'动作原文',kind:'test',program:'node',args:[],cwd:'.',enabled:false};
      let editor; const calls = [];
      const controller = createProjectEditorController({workspace:()=>action.workspaceId,actions:()=>[action],changed:(_id,value)=>editor=value,saved:()=>calls.push('accepted'),save:async input=>{calls.push(input);return {...action,id:'foreign'};}});
      controller.edit(action.id); controller.change('name','草稿原文'); await controller.save();
      return {display:editor.error,canonical:{action,editor,calls}};
    } else if (kind === 'diff') {
      const {createTurnChangeController} = await import('/src/lib/app/turn-change-controller.ts');
      const context = {sessionId:'session',changeSet:{turnId:'turn',files:[{path:'原文.txt'}]}};
      const response = {path:'foreign.txt',diff:'provider 原文'};
      let state; let display; const calls = [];
      const controller = createTurnChangeController({desktop:()=>true,context:()=>context,changed:value=>state=value,error:value=>display=value,notice:()=>calls.push('notice'),workspaceChanged:async()=>calls.push('write'),restored:async()=>calls.push('restore'),api:{getTurnFileDiff:async(...args)=>{calls.push(args);return response;}}});
      await controller.showDiff('session','turn','原文.txt');
      return {display,canonical:{context,response,state,calls}};
    } else {
      const {validateRenderer} = await import('/src/lib/app/renderer-descriptor.ts');
      const changes = {identity:{id:'bad id'},core:{core:[]},limit:{optional:Array(33).fill({})},schemas:{snapshotSchemas:[]},optional:{optional:[{id:'foreign.graph',version:'1.0.0',semantic:'collection'}]}};
      const input = {...descriptor,...changes[kind]}; canonical = input; validateRenderer(input);
    }
  } catch (error) {
    return {error,diagnostic:error.message,display:error.localized,canonical};
  }
  throw Error('Guard fixture unexpectedly accepted its input: '+kind);
}
