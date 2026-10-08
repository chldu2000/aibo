import assert from 'node:assert/strict';
import test from 'node:test';
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
      refreshTimeline: id => calls.push(['timeline', id]), refreshExecutionProfile: id => calls.push(['profile', id]), setNotice: (text, type) => calls.push(['notice', text, type]),
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
