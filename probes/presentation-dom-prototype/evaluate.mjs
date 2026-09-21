import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const result = JSON.parse(await readFile('probes/presentation-dom-prototype/dist/tauri-app-result.json','utf8'));
assert.equal(result.completed, true, `incomplete probe: ${result.error}`);
const step = name => { const value = result.checks.find(item => item.step === name); assert.ok(value, name); return value; };
const ipc = step('untrusted IPC and network isolation').result;
assert.ok(ipc.results.every(item => !item.accepted));
assert.equal(ipc.network, 'rejected'); assert.equal(ipc.storageLeak, null); assert.equal(result.forbiddenRequests.length,0);
assert.ok(step('unregistered caller rejected').results.every(item => !item.accepted && item.error === 'ACL denied'));
assert.equal(step('native suspension').noNewMessages, true);
assert.ok(step('loop host heartbeat').advanced >= 10);
assert.equal(step('real Git approval result').result.accepted, true);
assert.equal(result.staged, 'p0-proof.txt');
assert.equal(step('oversized message').result.accepted, false);
const flood = step('2000-message finite flood').result;
assert.equal(flood.fulfilled + flood.rejected, 2000); assert.ok(flood.rejected > 0);
assert.equal(step('crash exact experimental content process').result.injected,true);
assert.equal(step('disposed generation rejected').result.accepted,false);
const host = step('host commands with embedded child');
const closed = step('closed loop after five seconds');
const assessment = {
  probeCompleted: true, p0Passed: false,
  measuredGates: {
    sampledIpcDenied: true,
    allPaintAcknowledgementsWithinTwoSeconds: result.paintTimeouts.length === 0,
    hostCommandCompatibility: host.selection.accepted && host.workspaces.accepted,
    closeTerminatesFaultWithinFiveSeconds: !closed.sample.child.present,
    nativeGitApprovalDuringLoop: step('native approval during loop').input.ok,
    actualManagementAxPressDuringLoop: step('actual App management during loop').input.ok,
  },
  unverified: ['full action authorization','all trusted surfaces and recovery','native IME/input latency','images and memory ceiling','repeated-switch resource baseline','Windows','Linux'],
  note: 'Scenario assertions passing do not imply P0 gates passing; inspect negative measurements and unverified requirements.'
};
await writeFile('probes/presentation-dom-prototype/dist/gate-assessment.json',JSON.stringify(assessment,null,2)+'\n');
console.log(JSON.stringify(assessment));
