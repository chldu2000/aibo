import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnChangeController, emptyTurnChange } from '../src/lib/app/turn-change-controller.ts';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
function fixture(api = {}) {
  let context = {sessionId:'s',changeSet:{turnId:'t',files:[{path:'one'},{path:'two'}]}}, state;
  const notices=[], errors=[], changed=[], restored=[], calls=[];
  const defaults={getTurnFileDiff:async (_,__,path)=>({path,diff:'+ok'}),applyGitFileAction:async()=>({applied:true}),applyGitHunkAction:async()=>({applied:true}),restoreTurnChangeSet:async()=>({applied:true,restored:['one'],conflicts:[],unsupported:[]}),...api};
  const controller=createTurnChangeController({api:Object.fromEntries(Object.entries(defaults).map(([name,fn])=>[name,(...args)=>{calls.push([name,...args]);return fn(...args);} ])),
    desktop:()=>true,context:()=>context,changed:value=>state=value,error:value=>errors.push(value),notice:(...args)=>notices.push(args),
    workspaceChanged:async id=>changed.push(id),restored:async id=>restored.push(id)});
  return {controller,calls,notices,errors,changed,restored,get state(){return state;},select:sessionId=>{context={...context,sessionId};controller.reset();}};
}
test('turn diff validates membership and identity and ignores late responses after another selection',async()=>{
  const first=deferred(); const f=fixture({getTurnFileDiff:async (_,__,path)=>path==='one'?first.promise:{path:'wrong'}});
  await f.controller.showDiff('s','t','missing'); assert.equal(f.calls.length,0);
  const reading=f.controller.showDiff('s','t','one'); f.select('other');first.resolve({path:'one'});await reading;
  assert.deepEqual(f.state,emptyTurnChange());
  f.select('s');await f.controller.showDiff('s','t','two');assert.match(f.state.error,/identity_mismatch/);assert.equal(f.state.loading,false);
});
test('turn diff requests cannot replace a newer file or report a closed read error',async()=>{
  const first=deferred(), second=deferred();
  const f=fixture({getTurnFileDiff:async (_,__,path)=>path==='one'?first.promise:second.promise});
  const old=f.controller.showDiff('s','t','one'), latest=f.controller.showDiff('s','t','two');
  second.resolve({path:'two'});await latest;first.reject(Error('old failure'));await old;
  assert.equal(f.state.diff.path,'two');assert.equal(f.errors.length,0);
});
test('file and hunk writes keep session and turn identities and finish after navigation',async()=>{
  const pending=deferred();const f=fixture({applyGitFileAction:()=>pending.promise});
  const writing=f.controller.applyFile('s','t','one','stage');f.select('other');pending.resolve({applied:true});await writing;
  assert.deepEqual(f.changed,['s']);assert.deepEqual(f.calls[0],['applyGitFileAction','s','one','stage','t']);
  await f.controller.applyHunk('s','t','two',3,'unstage');assert.deepEqual(f.calls[1],['applyGitHunkAction','s','t','two',3,'unstage']);
  assert.deepEqual(f.notices.at(-1),['hunk 已取消暂存。','success']);
  const denied=fixture({applyGitFileAction:async()=>({applied:false,message:'denied'})});await denied.controller.applyFile('s','t','one','revert');
  assert.deepEqual(denied.changed,[]);assert.deepEqual(denied.errors,['denied']);
});
test('restoration refreshes host history only on success and preserves conflict/unsupported feedback',async()=>{
  const f=fixture();await f.controller.restore('s','t');assert.deepEqual(f.restored,['s']);assert.deepEqual(f.notices,[['已恢复 1 个文件。','success']]);
  for(const result of [{applied:false,restored:[],conflicts:['one'],unsupported:[]},{applied:false,restored:[],conflicts:[],unsupported:['binary']}]){
    const denied=fixture({restoreTurnChangeSet:async()=>result});await denied.controller.restore('s','t');
    assert.equal(denied.notices[0][1],'warning');assert.deepEqual(denied.restored,[]);
  }
});
