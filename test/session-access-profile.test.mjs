import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionAccessProfile} from '../src/lib/app/session-access-profile.ts';

test('Codex access presets map to native approval reviewer semantics',()=>{
  assert.deepEqual(
    Object.fromEntries(['ask-for-approval','approve-for-me','full-access'].map(mode=>{
      const profile=sessionAccessProfile('codex',mode);
      return [mode,[profile.approvalPolicy,profile.approvalReviewer,profile.filesystemPolicy]];
    })),
    {
      'ask-for-approval':['on-request','user','workspace-write'],
      'approve-for-me':['on-request','auto-review','workspace-write'],
      'full-access':['never','none','danger-full-access'],
    },
  );
});

test('non-Codex access never inherits the native auto reviewer',()=>{
  const current=sessionAccessProfile('codex','approve-for-me');
  assert.equal(sessionAccessProfile('pi','workspace-write',current).approvalReviewer,'user');
  assert.equal(sessionAccessProfile('plugin','read-only',current).approvalReviewer,'none');
});
