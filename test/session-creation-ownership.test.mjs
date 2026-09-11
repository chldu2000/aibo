import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';

test('generic creation preserves the requested profile and cannot select into a different workspace',async()=>{
 const server=await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
 try{
  const {createAgentSessionController}=await server.ssrLoadModule('/src/lib/app/agent-session-controller.ts');
  let resolve, selectedWorkspace='a', selectedSession=null, sessions={}; const calls=[];
  const controller=createAgentSessionController({
   api:{createSession:async(...args)=>{calls.push(args);return new Promise(done=>{resolve=done;});}},
   getDesktop:()=>true,getSelectedWorkspaceId:()=>selectedWorkspace,
   getWorkspaceSessionMap:()=>sessions,setWorkspaceSessionMap:value=>{sessions=value;},
   setSelectedSessionId:value=>{selectedSession=value;},clearSelectedSessionContext(){},setCreateSessionWorkspaceId(){},
   refreshExecutionProfile(){},refreshSessions:async()=>{},setBusy(){},setErrorMessage(){},setNotice(){},
  });
  const pending=controller.createCodex({id:'a'});
  assert.equal(calls[0][1],'dev.aibo.codex.agent');
  assert.equal(calls[0][2].filesystemPolicy,'read-only');
  assert.equal(calls[0][2].commandPolicy,'approved');
  selectedWorkspace='b';resolve({id:'new',workspaceId:'a',agent:'dev.aibo.codex.agent',state:'idle'});await pending;
  assert.equal(selectedSession,null);assert.equal(sessions.a[0].id,'new');
 }finally{await server.close();}
});
