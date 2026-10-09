import assert from 'node:assert/strict';
import test from 'node:test';
import { translateMessage } from '../packages/i18n/index.js';
import { createServer } from 'vite';

test('a terminal plugin turn immediately makes the conversation composer editable', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const [{ handleAgentEvent }, { isSessionRunning }] = await Promise.all([
      server.ssrLoadModule('/src/lib/app/agent-event-handler.ts'),
      server.ssrLoadModule('/src/lib/app/session-state.ts'),
    ]);
    let sessions = [{
      id: 'session',
      workspaceId: 'workspace',
      agent: 'dev.aibo.codex.agent',
      state: 'running',
      archived: false,
    }];
    const event = {
      eventId: 'event',
      workspaceId: 'workspace',
      sessionId: 'session',
      turnId: 'turn',
      type: 'turn.completed',
      occurredAt: '2026-09-12T10:00:00.000Z',
      source: { agentId: 'dev.aibo.codex.agent' },
      correlation: null,
      payload: { status: 'completed' },
    };
    handleAgentEvent(event, {
      selectedSessionId: 'session',
      selectedAgent: 'codex',
      timeline: [],
      pendingApprovals: [],
      pendingUserInputs: [],
      lastSubmittedPrompt: null,
      setAgentActivity() {},
      updateWorkspaceSessions(workspaceId, update) {
        assert.equal(workspaceId, 'workspace');
        sessions = update(sessions);
      },
      setPendingApprovals() {},
      setPendingUserInputs() {},
      setUsageSnapshot() {},
      setQueueSnapshot() {},
      setTimeline() {},
      refreshTimeline() {},
      setRetry() {},
      setNotice() {},
      refreshSessions() {},
      refreshTurnChangeSet() {},
      refreshArtifacts() {},
      refreshWorkspaceChanges() {},
    });

    assert.equal(sessions[0].state, 'idle');
    assert.equal(isSessionRunning(sessions[0]), false);
  } finally {
    await server.close();
  }
});

test('usage events retain their session identity at the host state seam', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { handleAgentEvent } = await server.ssrLoadModule('/src/lib/app/agent-event-handler.ts');
    let received = null;
    handleAgentEvent({
      eventId: 'usage-event', workspaceId: 'workspace', sessionId: 'session-a', turnId: 'turn',
      type: 'usage.updated', occurredAt: '2026-09-14T00:00:00.000Z', source: {}, correlation: null,
      payload: { usage: { total: 1200 } },
    }, {
      selectedSessionId: 'session-b', selectedAgent: 'codex', timeline: [], pendingApprovals: [], pendingUserInputs: [], lastSubmittedPrompt: null,
      setAgentActivity() {}, updateWorkspaceSessions() {}, setPendingApprovals() {}, setPendingUserInputs() {},
      setUsageSnapshot(sessionId, usage) { received = { sessionId, usage }; },
      setQueueSnapshot() {}, setTimeline() {}, setRetry() {}, setNotice() {}, refreshSessions() {},
    });
    assert.deepEqual(received, { sessionId: 'session-a', usage: { total: 1200 } });
  } finally {
    await server.close();
  }
});

for (const type of ['turn.completed', 'session.state_changed']) {
  test(`${type} clears stale tool execution when the composer becomes idle`, async () => {
    const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
    try {
      const { handleAgentEvent } = await server.ssrLoadModule('/src/lib/app/agent-event-handler.ts');
      let active = true;
      let timeline = [{ id: 'tool', sessionId: 'session', turnId: 'turn', role: 'tool', status: 'streaming' }];
      handleAgentEvent({
        eventId: 'end', workspaceId: 'workspace', sessionId: 'session', turnId: 'turn',
        type, occurredAt: '2026-09-16T00:00:00.000Z', source: {}, correlation: null,
        payload: type === 'turn.completed' ? { status: 'completed' } : { state: 'idle' },
      }, {
        selectedSessionId: 'session', selectedAgent: 'codex', timeline, pendingApprovals: [], pendingUserInputs: [], lastSubmittedPrompt: null,
        setAgentActivity(id, value) { active = value; }, updateWorkspaceSessions() {}, setPendingApprovals() {}, setPendingUserInputs() {},
        setUsageSnapshot() {}, setQueueSnapshot() {}, setTimeline(value) { timeline = value; }, setRetry() {}, setNotice() {}, refreshSessions() {},
      });
      assert.equal(active, false, 'idle composer must not retain an execution activity override');
      assert.equal(timeline.some(item => item.status === 'streaming'), false, 'ended turn must not retain a streaming tool indicator');
    } finally { await server.close(); }
  });
}

test('a host-committed control change refreshes the selected session profile and timeline', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { handleAgentEvent } = await server.ssrLoadModule('/src/lib/app/agent-event-handler.ts');
    const calls = [];
    const context = {
      selectedSessionId: 'session', selectedAgent: 'Claude Code', timeline: [], pendingApprovals: [], pendingUserInputs: [], lastSubmittedPrompt: null,
      setAgentActivity() {}, updateWorkspaceSessions() {}, setPendingApprovals() {}, setPendingUserInputs() {}, setUsageSnapshot() {}, setQueueSnapshot() {},
      setTimeline() {}, setRetry() {}, refreshSessions() {},
      refreshTimeline: id => calls.push(['timeline', id]), refreshExecutionProfile: id => calls.push(['profile', id]), setNotice: (text, type) => calls.push(['notice', translateMessage('zh-CN',text), type]),
    };
    const event = { eventId: 'e', workspaceId: 'workspace', sessionId: 'session', turnId: 'turn', type: 'session.control_changed', occurredAt: '2026-09-27T10:00:00.000Z',
      source: {}, correlation: { requestId: 'r' }, payload: { controlId: 'auto', previousControlId: 'plan', label: 'Auto', cause: 'approval', requestId: 'r' } };
    handleAgentEvent(event, context);
    assert.deepEqual(calls, [['profile', 'session'], ['timeline', 'session'], ['notice', '已切换到 Auto。', 'success']]);
    calls.length = 0;
    handleAgentEvent({ ...event, payload: { ...event.payload, contextReset: true } }, context);
    assert.deepEqual(calls.at(-1), ['notice', '已清空上下文并切换到 Auto。', 'success']);
    calls.length = 0;
    handleAgentEvent({ ...event, sessionId: 'other' }, context);
    assert.deepEqual(calls, [], 'background sessions reload their profile when selected');
    handleAgentEvent({ ...event, type: 'adapter.warning', payload: { kind: 'session.binding_recovered' } }, context);
    assert.equal(calls.at(-1)[2], 'warning', 'recovered thread reports a warning instead of success');
    calls.length = 0;
    handleAgentEvent({ ...event, type: 'adapter.crashed', payload: { reason: 'process exited' } }, context);
    assert.equal(calls.at(-1)[2], 'error', 'an exited agent is an error notification');
  } finally {
    await server.close();
  }
});

test('compaction state follows session events independently of activity labels', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {handleAgentEvent} = await server.ssrLoadModule('/src/lib/app/agent-event-handler.ts');
    const compacting = new Set();
    const context = {
      selectedSessionId:'selected', selectedAgent:'Provider', timeline:[], pendingApprovals:[], pendingUserInputs:[], lastSubmittedPrompt:null,
      setAgentActivity(){}, updateWorkspaceSessions(){}, setPendingApprovals(){}, setPendingUserInputs(){}, setUsageSnapshot(){},
      setQueueSnapshot(){}, setTimeline(){}, setRetry(){}, setNotice(){}, refreshSessions(){},
      setContextCompacting(id,active){if(active)compacting.add(id);else compacting.delete(id);},
    };
    const emit = (sessionId,type,payload={}) => handleAgentEvent({eventId:'event',workspaceId:'w',sessionId,turnId:'turn',type,
      occurredAt:'2026-10-09T00:00:00Z',source:{agentId:'provider'},correlation:null,payload},context);
    emit('selected','compaction.started');
    emit('other','compaction.started');
    assert.deepEqual([...compacting],['selected','other']);
    emit('selected','compaction.completed');
    assert.deepEqual([...compacting],['other']);
    emit('other','turn.failed');
    assert.equal(compacting.size,0);
    emit('selected','session.state_changed',{state:'compacting'});
    assert.ok(compacting.has('selected'));
    emit('selected','session.state_changed',{state:'idle'});
    assert.equal(compacting.size,0);
  } finally { await server.close(); }
});


test('running activity keeps a locale-neutral descriptor through language changes', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {handleAgentEvent} = await server.ssrLoadModule('/src/lib/app/agent-event-handler.ts');
    let activity;
    const context = {selectedSessionId:'s',selectedAgent:'Provider',timeline:[],pendingApprovals:[],pendingUserInputs:[],lastSubmittedPrompt:null,
      setAgentActivity(id,active,label){activity=label;},updateWorkspaceSessions(){},setPendingApprovals(){},setPendingUserInputs(){},
      setUsageSnapshot(){},setQueueSnapshot(){},setTimeline(){},setRetry(){},setNotice(){},refreshSessions(){}};
    const event = {eventId:'e',workspaceId:'w',sessionId:'s',turnId:'t',type:'tool.started',occurredAt:'2026-10-09',source:{},correlation:null,payload:{toolName:'用户工具'}};
    handleAgentEvent(event,context);
    assert.equal(translateMessage('en',activity),'Agent is running 用户工具…');
    assert.equal(translateMessage('zh-CN',activity),'Agent 正在执行 用户工具…');
    handleAgentEvent({...event,type:'retry.started',payload:{attempt:2}},context);
    assert.equal(translateMessage('en',activity),"Agent's request did not succeed yet; waiting for retry 2…");
    handleAgentEvent({...event,payload:{}},context);
    assert.equal(translateMessage('en',activity),'Agent is running a tool…');
  } finally {await server.close();}
});

test('retry defaults remain translatable while prompts, provider reasons and tool payloads retain original text',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try {
  const {handleAgentEvent}=await server.ssrLoadModule('/src/lib/app/agent-event-handler.ts');let retry;let timeline=[];
  const context={selectedSessionId:'s',selectedAgent:'Provider',timeline:[],pendingApprovals:[],pendingUserInputs:[],lastSubmittedPrompt:'用户原始问题',
   setAgentActivity(){},updateWorkspaceSessions(){},setPendingApprovals(){},setPendingUserInputs(){},setUsageSnapshot(){},setQueueSnapshot(){},
   setTimeline(value){timeline=value;context.timeline=value;},setRetry(prompt,reason){retry={prompt,reason};},setNotice(){},refreshSessions(){}};
  const emit=(type,payload={},sessionId='s')=>handleAgentEvent({eventId:type,workspaceId:'w',sessionId,turnId:'t',type,occurredAt:'2026-10-09',source:{},correlation:null,payload},context);
  emit('adapter.crashed');assert.equal(retry.prompt,'用户原始问题');assert.equal(translateMessage('en',retry.reason),'The Agent process exited unexpectedly');assert.equal(translateMessage('zh-CN',retry.reason),'Agent 进程异常退出');
  const localizedReason={schema:'aibo.host-message/v1',key:'native.session.invocationFailure',params:{code:'cancelled',error:{key:'native.broker.cancelled',params:{}}}};
  const rawReason='cancelled: Invocation was cancelled';
  const failure={reason:rawReason,localizedReason};const before=structuredClone(failure);
  emit('adapter.crashed',failure);
  assert.equal(retry.prompt,'用户原始问题');assert.equal(translateMessage('en',retry.reason),rawReason);
  assert.equal(translateMessage('zh-CN',retry.reason),'cancelled：调用已取消。');assert.deepEqual(failure,before);
  for(const metadata of [undefined,{...localizedReason,key:'native.unknown'},{...localizedReason,schema:'bad'}]){
   emit('adapter.crashed',{reason:'提供者错误 {error}',localizedReason:metadata});assert.equal(retry.reason,'提供者错误 {error}');
  }
  emit('turn.failed');assert.equal(translateMessage('en',retry.reason),'This turn failed');assert.equal(translateMessage('zh-CN',retry.reason),'本回合执行失败');
  emit('turn.failed',{error:'提供者原始原因'});assert.equal(retry.reason,'提供者原始原因');
  emit('turn.failed',{},'other');assert.equal(retry.reason,'提供者原始原因');
  emit('tool.started',{itemId:'empty',itemType:'commandExecution'});assert.equal(timeline.at(-1).content,'');
  emit('tool.started',{itemId:'raw',itemType:'commandExecution',summary:'工具操作'});assert.equal(timeline.at(-1).content,'工具操作');
 }finally{await server.close();}
});
