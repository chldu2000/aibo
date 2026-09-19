import test from 'node:test';
import assert from 'node:assert/strict';
import {renderExecutionProfile,renderAttachment} from '../packages/presentation-workbench/metadata.js';
const flatten=tree=>[tree,...(tree.children??[]).flatMap(flatten)];
const profile={requested:{interactionMode:'edit',filesystemPolicy:'danger-full-access',commandPolicy:'trusted',networkPolicy:'agent-managed',approvalPolicy:'never',model:'requested-model',reasoningEffort:'high'},enforced:{interactionMode:'ask',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',approvalPolicy:'on-request',model:null,reasoningEffort:null},nativeSandbox:false,unsupported:['network'],adapterCapabilities:['model.select'],resolvedAt:'now'};
test('execution metadata distinguishes requested access from enforced policy without inventing support',()=>{
 const nodes=flatten(renderExecutionProfile(profile,'profile'));
 const cell=key=>nodes.find(node=>node.key==='profile:'+key).text;
 assert.equal(cell('requested:filesystemPolicy'),'完整文件访问');assert.equal(cell('enforced:filesystemPolicy'),'只读');
 assert.equal(cell('requested:model'),'requested-model');assert.equal(cell('enforced:model'),'默认');
 assert.equal(cell('sandbox'),'无原生沙箱');assert.equal(cell('unsupported:0'),'未启用：network');
 assert.ok(nodes.some(node=>node.text==='model.select'));
 assert.equal(renderExecutionProfile(null,'profile'),null);
});
test('attachment metadata preserves pending versus submitted, strategy and zero-byte size',()=>{
 const pending=flatten(renderAttachment({path:'empty.txt',turnId:null,sendStrategy:'reference',size:0,mediaType:'text/plain',source:'picker'},'pending'));
 assert.ok(pending.some(node=>node.text==='待发送 · 工作区引用 · 0 字节'));
 const sent=flatten(renderAttachment({path:'sent.txt',turnId:'turn',sendStrategy:'inline',size:null},'sent'));
 assert.ok(sent.some(node=>node.text==='已发送 · 内联'));
 assert.ok(!sent.some(node=>node.events),'metadata does not introduce business actions');
});
test('provider-managed execution explains permission ownership without claiming a sandbox',()=>{
 const managed={...profile,agentManagedPermissions:true,adapterCapabilities:['permissions.agentManaged'],enforced:{...profile.enforced,filesystemPolicy:'agent-managed',commandPolicy:'agent-managed',networkPolicy:'agent-managed'}};
 const nodes=flatten(renderExecutionProfile(managed,'managed'));
 assert.equal(nodes.find(node=>node.key==='managed:enforced:filesystemPolicy').text,'Agent 原生权限');
 assert.equal(nodes.find(node=>node.key==='managed:enforced:commandPolicy').text,'Agent 原生权限');
 assert.equal(nodes.find(node=>node.key==='managed:sandbox').text,'权限由 Agent 管理；aibo 转发审批，不提供进程沙箱');
});
test('unreadable Git state is not described as a clean workspace',async()=>{
 const {readFile}=await import('node:fs/promises');const {renderGit}=await import('../packages/presentation-workbench/git.js');
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/git.json','utf8'));state.changes={...state.changes,captureStatus:'failed',captureError:'repository unavailable',files:[]};
 const nodes=flatten(renderGit(state,[]));assert.ok(nodes.some(node=>node.text==='repository unavailable'));assert.ok(!nodes.some(node=>node.text==='工作区干净，没有待处理的更改'));
});
