import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStartupController} from '../src/lib/app/session-startup-controller.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture(){
 const native=deferred(), sessions=new Map();let selected=null,workspace='w',creating=false,error=null;
 const starting={id:'s',workspaceId:'w',agent:'external',pluginInstallationId:'p',state:'starting',archived:false,capabilities:[]};
 const controller=createSessionStartupController({prepare:async()=>starting,start:()=>native.promise,
 getWorkspaceId:()=>workspace,getSessionId:()=>selected,findSession:id=>sessions.get(id),putSession:s=>sessions.set(s.id,s),selectSession:id=>selected=id,
 setCreating:value=>creating=value,setError:value=>error=value,setNotice(){},refreshProfile(){}});
 return {controller,native,sessions,starting,get selected(){return selected},get creating(){return creating},get error(){return error},navigate(){workspace='other';selected='other'}};
}
test('slow native startup exposes a host session immediately and does not lock navigation',async()=>{
 const f=fixture(),pending=f.controller.create('w','external','p');await Promise.resolve();
 assert.equal(f.selected,'s');assert.equal(f.creating,false);assert.equal(f.sessions.get('s').state,'starting');
 f.navigate();f.native.resolve({...f.starting,state:'idle',capabilities:['turn.send']});await pending;
 assert.equal(f.selected,'other');assert.equal(f.sessions.get('s').state,'idle');
});
test('startup failure stays attached to the original session and late success cannot restore a removed session',async()=>{
 const f=fixture(),pending=f.controller.create('w','external','p');await Promise.resolve();f.native.reject(Error('authentication failed'));await pending;
 assert.equal(f.sessions.size,1);assert.equal(f.sessions.get('s').state,'failed');assert.match(f.error,/authentication failed/);
 const removed=fixture(),work=removed.controller.create('w','external','p');await Promise.resolve();removed.sessions.delete('s');removed.native.resolve({...removed.starting,state:'idle'});await work;
 assert.equal(removed.sessions.size,0);
});

test('late startup completion cannot overwrite a newer session state',async()=>{
 const f=fixture(),pending=f.controller.create('w','external','p');await Promise.resolve();
 f.sessions.set('s',{...f.starting,state:'running'});f.native.resolve({...f.starting,state:'idle'});await pending;
 assert.equal(f.sessions.get('s').state,'running');
});

test('preparing a provider session preserves its binding and cannot steal a newer workspace selection', async () => {
  const prepared = deferred(), sessions = new Map(), calls = [];
  let workspace = 'original', selected = null;
  const session = { id: 'created', workspaceId: 'original', agent: 'external.contribution', pluginInstallationId: 'pinned-release', state: 'starting', archived: false };
  const controller = createSessionStartupController({
    prepare: (...args) => { calls.push(args); return prepared.promise; },
    start: async id => { assert.equal(id, session.id); return { ...session, state: 'idle' }; },
    getWorkspaceId: () => workspace, getSessionId: () => selected,
    findSession: id => sessions.get(id), putSession: value => sessions.set(value.id, value),
    selectSession: id => { selected = id; }, setCreating() {}, setError(error) { if (error) assert.fail(error); }, setNotice() {}, refreshProfile() {},
  });
  const pending = controller.create('original', 'external.contribution', 'pinned-release');
  assert.deepEqual(calls, [['original', 'external.contribution', 'pinned-release']]);
  workspace = 'other'; selected = 'other-session'; prepared.resolve(session);
  await pending;
  assert.equal(selected, 'other-session');
  assert.equal(sessions.get('created').pluginInstallationId, 'pinned-release');
  assert.equal(sessions.get('created').state, 'idle');
});
