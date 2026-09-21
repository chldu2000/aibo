import React from 'react';
import { createRoot } from 'react-dom/client';
import { connect } from './client.mjs';

const root = createRoot(document.getElementById('app'));
function Conversation({ snapshot, request }) {
  const state = snapshot.data.conversation;
  return <main>
    <h2>React presentation</h2>
    <p>{state.session.label} · revision {snapshot.context.revision}</p>
    {state.timeline.map(item => <p key={item.id}>{item.content}</p>)}
    <label>草稿<textarea aria-label="草稿" value={state.draft} onChange={event => request('draft', event.target.value)} /></label>
    <button onClick={() => request('send')}>请求发送（由宿主确认）</button>
  </main>;
}
connect((snapshot, request) => root.render(<Conversation snapshot={snapshot} request={request} />));
