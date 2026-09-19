import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionControlOptions, selectedSessionControls} from '../src/lib/app/session-access-profile.ts';
const options = [
  {id:'team-sandbox',kind:'permission',label:'Team sandbox',description:'Team policy',profile:{filesystemPolicy:'workspace-write'}},
  {id:'review-first',kind:'mode',label:'Review first',description:'Review mode',profile:{interactionMode:'plan'}},
];

test('session control labels, IDs and ordering come from the plugin without identity branches',()=>{
  assert.deepEqual(sessionControlOptions({sessionId:'s',sessionControls:options},'s'),options);
  assert.deepEqual(sessionControlOptions({sessionId:'other',sessionControls:options},'s'),[]);
  assert.deepEqual(sessionControlOptions({sessionId:'s',sessionControls:options},null),[]);
  assert.deepEqual(sessionControlOptions({sessionId:'s'},'s'),[]);
});

test('permissions and modes have independent selected states based on declared profile fields',()=>{
  assert.deepEqual(selectedSessionControls(options,{filesystemPolicy:'workspace-write',interactionMode:'plan'}),options);
  assert.deepEqual(selectedSessionControls(options,{filesystemPolicy:'read-only',interactionMode:'plan'}),[options[1]]);
  assert.deepEqual(selectedSessionControls(options,{filesystemPolicy:'read-only',interactionMode:'ask'}),[]);
  assert.deepEqual(selectedSessionControls(options,null),[]);
  assert.deepEqual(selectedSessionControls([...options,{...options[0],id:'duplicate-policy'}],{filesystemPolicy:'workspace-write',interactionMode:'ask'}),[options[0]]);
});
