import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('late send completion consumes only the submitted session draft', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createMessageController } = await server.ssrLoadModule('/src/lib/app/message-controller.ts');
    const original = { id: 'original', workspaceId: 'workspace', capabilities: [], archived: false };
    let selected = original, composer = 'original draft', finish, started;
    const entered = new Promise(resolve => { started = resolve; });
    const consumed = [];
    const controller = createMessageController({
      api: {
        validateSessionAttachments: async () => [],
        sendAgentPrompt: async (id, input) => {
          assert.equal(id, original.id); assert.equal(input, 'original draft'); started();
          return new Promise(resolve => { finish = resolve; });
        },
      },
      getDesktop: () => true, getSelectedWorkspace: () => ({ id: 'workspace' }),
      getSelectedSession: () => selected, getSelectedSessionArchiving: () => false, getSessionRunning: () => false,
      getComposerText: () => composer, setComposerText: () => assert.fail('send cannot clear the current editor without checking ownership'),
      consumeDraft: (id, text) => { consumed.push([id, text]); },
      getAttachments: () => [], getWorkspaceSessionMap: () => ({ workspace: [original] }),
      setWorkspaceSessionMap() {}, setBusy() {}, setErrorMessage(error) { assert.equal(error, null); },
      setLastSubmittedPrompt() {}, setPromptInFlight() {}, updateWorkspaceSessions() {},
      refreshTimeline: async () => {}, refreshAttachments: async () => {},
    });
    const pending = controller.sendPrompt(); await entered;
    selected = { ...original, id: 'other' }; composer = 'new draft';
    finish({ ...original, state: 'running' }); await pending;
    assert.deepEqual(consumed, [['original', 'original draft']]);
    assert.equal(composer, 'new draft');
  } finally { await server.close(); }
});

test('accepted sends and queued messages stay accepted when the following refresh fails', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createMessageController } = await server.ssrLoadModule('/src/lib/app/message-controller.ts');
    for (const queue of [false, true]) {
      const session = { id: 'session', workspaceId: 'workspace', pluginInstallationId: 'plugin', capabilities: ['queue.manage'], archived: false };
      let sends = 0, composer = 'accepted draft';
      const failed = [], errors = [], notices = [];
      const controller = createMessageController({
        api: {
          validateSessionAttachments: async () => [],
          sendAgentPrompt: async () => { sends++; return { ...session, state: 'running' }; },
          invokeAgentCapability: async () => { sends++; return {}; },
        },
        getDesktop: () => true, getSelectedWorkspace: () => ({ id: 'workspace' }),
        getSelectedSession: () => session, getSelectedSessionArchiving: () => false, getSessionRunning: () => false,
        getComposerText: () => composer, consumeDraft: () => { composer = ''; },
        getAttachments: () => [], getWorkspaceSessionMap: () => ({ workspace: [session] }),
        setWorkspaceSessionMap() {}, setBusy() {}, setLastSubmittedPrompt() {}, setPromptInFlight() {}, updateWorkspaceSessions() {},
        setComposerDraftStatus: (_id, value) => failed.push(value),
        setErrorMessage: error => errors.push(error), setNotice: notice => notices.push(notice),
        refreshTimeline: async () => { throw Error('timeline temporarily unavailable'); },
        refreshAttachments: async () => {},
      });
      if (queue) await controller.queuePrompt('steer'); else await controller.sendPrompt();
      assert.equal(sends, 1);
      assert.equal(composer, '', 'accepted draft must be consumed despite refresh failure');
      assert.ok(!failed.includes(true), 'a refresh error cannot label the send failed');
      assert.ok(errors.every(error => error === null));
      assert.ok(notices.some(notice => notice.includes('刷新')));
    }
  } finally { await server.close(); }
});

test('sending while running queues once even when validation has not finished', async () => {
  const server = await createServer({ server: { middlewareMode: true, ws: false, watch: null }, appType: 'custom' });
  try {
    const { createMessageController } = await server.ssrLoadModule('/src/lib/app/message-controller.ts');
    const session = {id:'s',workspaceId:'w',pluginInstallationId:'plugin',capabilities:['queue.manage'],archived:false};
    let resolveValidation; const validation = new Promise(resolve => {resolveValidation=resolve;});
    const calls=[]; let consumed=0;
    const controller=createMessageController({
      api:{validateSessionAttachments:()=>validation,sendAgentPrompt:()=>assert.fail('running sends must enter the queue'),invokeAgentCapability:async(...args)=>{calls.push(args);return {}; }},
      getDesktop:()=>true,getSelectedWorkspace:()=>({id:'w'}),getSelectedSession:()=>session,getSelectedSessionArchiving:()=>false,getSessionRunning:()=>true,
      getComposerText:()=> 'next message', getAttachments:()=>[], consumeDraft:()=>{consumed++;},
      setBusy(){},setErrorMessage(error){assert.equal(error,null);},refreshTimeline:async()=>{},refreshAttachments:async()=>{},
    });
    const first=controller.sendPrompt(); await controller.sendPrompt(); await controller.queuePrompt('steer');
    resolveValidation([]); await first;
    assert.deepEqual(calls,[['s','queue.manage',{action:'followUp',message:'next message'}]]);
    assert.equal(consumed,1);
  } finally {await server.close();}
});


test('image-only drafts send and queue registered images without embedding binary data in text', async () => {
  const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {createMessageController}=await server.ssrLoadModule('/src/lib/app/message-controller.ts');
    for (const queued of [false,true]) {
      const session={id:'s',workspaceId:'w',pluginInstallationId:'p',capabilities:['queue.manage'],archived:false};
      const calls=[];
      const controller=createMessageController({
        api:{validateSessionAttachments:async()=>[],sendAgentPrompt:async(id,text)=>{calls.push(text);return session;},invokeAgentCapability:async(id,cap,input)=>{calls.push(input.message);return {}; }},
        getDesktop:()=>true,getSelectedWorkspace:()=>({id:'w'}),getSelectedSession:()=>session,getSelectedSessionArchiving:()=>false,getSessionRunning:()=>queued,
        getComposerText:()=>'',getAttachments:()=>[{id:'image',sessionId:'s',turnId:null,path:'clipboard.png',size:68,mediaType:'image/png',sendStrategy:'inline',inlineContext:'private storage metadata'}],
        consumeDraft(){},setBusy(){},setErrorMessage(error){assert.equal(error,null);},setLastSubmittedPrompt(){},setPromptInFlight(){},getWorkspaceSessionMap:()=>({w:[session]}),setWorkspaceSessionMap(){},refreshTimeline:async()=>{},refreshAttachments:async()=>{},
      });
      await controller.sendPrompt();
      assert.equal(calls.length,1);assert.match(calls[0],/attachment:image/);assert.ok(!calls[0].includes('private storage'));
    }
  } finally {await server.close();}
});

test('sending during native startup preserves the draft without invoking a turn',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try{
  const {createMessageController}=await server.ssrLoadModule('/src/lib/app/message-controller.ts');let notice;
  const controller=createMessageController({getComposerText:()=> 'draft',getSelectedWorkspace:()=>({id:'w'}),getSelectedSession:()=>({id:'s',state:'starting'}),
   setNotice:value=>notice=value,api:{sendAgentPrompt:()=>assert.fail('startup cannot send')},consumeDraft:()=>assert.fail('startup cannot consume draft')});
  await controller.sendPrompt();assert.match(notice,/初始化/);
 }finally{await server.close()}
});
