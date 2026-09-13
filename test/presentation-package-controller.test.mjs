import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentationPackageController } from '../src/lib/app/presentation-package-controller.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
function fixture() {
  const releases=['a','b','c'].map(digest=>({digest,enabled:true,manifest:{id:digest,defaultThemeId:'dark',themes:[{id:'dark'}]}}));
  let saved=null,state;const effects=[],failures=new Map();
  const ports={
    async list(){return releases.filter(r=>r.installed!==false);},
    async read(digest){const release=releases.find(r=>r.digest===digest&&r.enabled&&r.installed!==false);if(!release)throw Error('missing');return{release,resources:{}};},
    async install(){return releases[0];},
    async enable(digest,enabled){releases.find(r=>r.digest===digest).enabled=enabled;if(!enabled&&saved?.digest===digest)saved=null;},
    async uninstall(digest){releases.find(r=>r.digest===digest).installed=false;if(saved?.digest===digest)saved=null;},
    async selection(){return saved;},
    async persist(digest,themeId,expected){assert.equal(saved?.digest??null,expected);saved=digest?{digest,themeId}:null;effects.push(['persist',digest]);},
    async prepare(value,_theme,failure){const id=value.release.digest;failures.set(id,failure);return{activate(){effects.push(['activate',id]);},dispose(){effects.push(['dispose',id]);}};},
    changed(next){state=next;},
  };
  const controller=createPresentationPackageController(ports);
  return{controller,ports,effects,failures,get saved(){return saved;},get state(){return state;}};
}

test('failed candidate and failed persistence preserve the existing mounted selection',async()=>{
  const f=fixture();await f.controller.select('a');const prepare=f.ports.prepare;
  f.ports.prepare=async()=>{throw Error('bad candidate');};
  await assert.rejects(f.controller.select('b'),/bad candidate/);
  assert.equal(f.saved.digest,'a');assert.equal(f.state.active.release.digest,'a');
  f.ports.prepare=prepare;f.ports.persist=async()=>{throw Error('storage unavailable');};
  await assert.rejects(f.controller.select('b'),/storage unavailable/);
  assert.equal(f.state.active.release.digest,'a');assert.ok(f.effects.some(([event,id])=>event==='dispose'&&id==='b'));
  assert.ok(!f.effects.some(([event,id])=>event==='dispose'&&id==='a'));
});

test('superseded preparation is cancelled and never committed',async()=>{
  const f=fixture();await f.controller.select('a');const entered=deferred();const prepare=f.ports.prepare;
  f.ports.prepare=async(value,theme,failure,signal)=>{
    if(value.release.digest==='b'){entered.resolve();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}
    return prepare(value,theme,failure,signal);
  };
  const b=f.controller.select('b');await entered.promise;const c=f.controller.select('c');await Promise.all([b,c]);
  assert.equal(f.saved.digest,'c');assert.ok(!f.effects.some(([event,id])=>event==='persist'&&id==='b'));
});

test('runtime failure restores builtin selection; disable and uninstall cannot leave an active release',async()=>{
  const f=fixture();await f.controller.select('a');f.failures.get('a')(Error('worker stopped'));
  for(let i=0;i<10&&f.saved;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.saved,null);assert.equal(f.state.active,null);
  await f.controller.select('b');await f.controller.enable('b',false);assert.equal(f.state.active,null);
  await f.controller.select('c');await f.controller.uninstall('c');assert.equal(f.state.active,null);
});

test('a broken persisted startup package is cleared and does not retry indefinitely',async()=>{
  const f=fixture();await f.ports.persist('a','dark',null);f.ports.read=async()=>{throw Error('corrupt package');};
  await f.controller.initialize();assert.equal(f.saved,null);assert.match(f.state.error,/corrupt package/);
});

test('late persistent commit after disposal is rolled back without activation',async()=>{
  const f=fixture();const entered=deferred(),finish=deferred(),persist=f.ports.persist;
  f.ports.persist=async(...args)=>{if(args[0]==='b'){entered.resolve();await finish.promise;}return persist(...args);};
  const selection=f.controller.select('b');await entered.promise;f.controller.dispose();finish.resolve();await selection;
  assert.equal(f.saved,null);assert.ok(!f.effects.some(([event])=>event==='activate'));
});
