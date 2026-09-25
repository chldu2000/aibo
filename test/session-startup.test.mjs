import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sessionCapability} from './helpers/session-capability.mjs';

const profile={interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'on-request',approvalReviewer:'user'};

test('Codex opens and reads models even when the optional quota request never responds', async t=>{
  const f=await sessionCapability(t,'codex',{CODEX_FAKE_HOLD_QUOTA:'1'});
  const timeout=AbortSignal.timeout(1500);
  const timed=p=>Promise.race([p,new Promise((_,reject)=>timeout.addEventListener('abort',()=>reject(Error('quota blocked session readiness')),{once:true}))]);
  const opened=await timed(f.invoke('aibo.session.open',{mode:'create',executionProfile:profile}));
  assert.equal(opened.nativeSessionId,'native-thread');
  assert.equal((await timed(f.invoke('dev.aibo.codex.model.select',{action:'list'}))).current,'gpt-fake');
});

test('Codex shares one native catalog between model, reasoning and tier reads and resets it after restart', async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'aibo-catalog-count-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const log=path.join(directory,'rpc.log');
  const f=await sessionCapability(t,'codex',{CODEX_FAKE_RPC_LOG:log});
  const opened=await f.invoke('aibo.session.open',{mode:'create',executionProfile:profile});
  await f.invoke('dev.aibo.codex.model.select',{action:'list'});
  assert.equal((await f.invoke('dev.aibo.codex.model.reasoning',{action:'list'})).levels.length,2);
  await f.invoke('dev.aibo.codex.model.service-tier',{action:'set',tier:'priority'});
  const count=async()=> (await readFile(log,'utf8')).split('\n').filter(method=>method==='model/list').length;
  assert.equal(await count(),1,'one UI catalog read must not multiply native discovery calls');
  await f.invoke('aibo.session.close');
  await f.invoke('aibo.session.open',{mode:'resume',executionProfile:profile,recovery:opened.recovery});
  await f.invoke('dev.aibo.codex.model.select',{action:'list'});
  assert.equal(await count(),2,'new process must discover its own catalog');
});
