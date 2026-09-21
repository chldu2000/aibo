import { mount } from 'svelte';
import Conversation from './Conversation.svelte';
import { connect } from './client.mjs';

const model = $state({ snapshot: null, request: null });
let mounted = false;
connect((snapshot, request) => {
  model.snapshot = snapshot;
  model.request = request;
  if (!mounted) { mount(Conversation, { target: document.getElementById('app'), props: { model } }); mounted = true; }
});
