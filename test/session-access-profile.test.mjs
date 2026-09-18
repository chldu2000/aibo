import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionAccessProfile} from '../src/lib/app/session-access-profile.ts';
const native=['ask-for-approval','approve-for-me','full-access','plan'];

test('host-authorized native presets preserve approval reviewer semantics',()=>{
  assert.deepEqual(Object.fromEntries(native.slice(0,3).map(mode=>{
    const p=sessionAccessProfile(native,mode);
    return [mode,[p.approvalPolicy,p.approvalReviewer,p.filesystemPolicy]];
  })),{
    'ask-for-approval':['on-request','user','workspace-write'],
    'approve-for-me':['on-request','auto-review','workspace-write'],
    'full-access':['never','none','danger-full-access'],
  });
});

test('unnegotiated and unsupported access modes cannot inherit native authority',()=>{
  const current=sessionAccessProfile(native,'full-access');
  assert.throws(()=>sessionAccessProfile(['read-only'],'full-access',current),/capability_unsupported/);
  assert.throws(()=>sessionAccessProfile([],'read-only'),/capability_unsupported/);
  for(const mode of ['read-only','plan','workspace-write']){
    const next=sessionAccessProfile(['read-only','plan','workspace-write'],mode,current);
    assert.equal(next.networkPolicy,'disabled');
    assert.equal(next.approvalReviewer, mode==='workspace-write'?'user':'none');
    assert.equal(next.filesystemPolicy, mode==='workspace-write'?'workspace-write':'read-only');
  }
});
