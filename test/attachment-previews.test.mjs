import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttachmentPreviews} from '../src/lib/app/attachment-previews.ts';
import {splitMessageAttachments} from '../packages/presentation-workbench/message-attachments.js';
import {renderTimelineEntry} from '../packages/presentation-workbench/timeline.js';
const attachment=(id,sessionId='s')=>({id,sessionId,path:id+'.png',mediaType:'image/png',turnId:'turn'});
const message=(id)=>`hello\n\n[AIBO_CONTEXT_ATTACHMENTS]\n- ${id}.png (image/png, 8 bytes) [attachment:${id}]\n[/AIBO_CONTEXT_ATTACHMENTS]`;
test('sent attachments follow explicit IDs, survive missing records, and do not duplicate steering images',()=>{
 const images=[attachment('first'),attachment('steered')];
 assert.deepEqual(splitMessageAttachments(message('first'),images),{body:'hello',attachments:[images[0]]});
 assert.equal(splitMessageAttachments(message('missing'),images).attachments[0].path,'missing.png');
 assert.equal(splitMessageAttachments('ordinary text',images).attachments.length,0);
 const tree=renderTimelineEntry({id:'message',role:'user',content:message('steered'),status:'completed'},[],images);
 const serialized=JSON.stringify(tree);
 assert.ok(serialized.includes('attachment:steered'));
 assert.ok(!serialized.includes('attachment:first'));
 assert.ok(!serialized.includes('AIBO_CONTEXT_ATTACHMENTS'));
});
test('preview reads deduplicate and ignore removed attachments or stale sessions',async()=>{
 const reads=[];let state;
 const controller=createAttachmentPreviews((session,id)=>new Promise((resolve,reject)=>reads.push({session,id,resolve,reject})),value=>state=value);
 controller.update('s',[attachment('first')]);controller.update('s',[attachment('first')]);assert.equal(reads.length,1);
 controller.update('s',[]);reads[0].resolve('stale');await Promise.resolve();assert.deepEqual(state,{});
 controller.update('s',[attachment('second')]);controller.update('other',[attachment('third','other')]);
 reads[1].resolve('wrong session');reads[2].reject(Error('missing'));await Promise.resolve();
 assert.deepEqual(state,{third:null});
});

test('image viewer discards closed and replaced reads and retries after failure',async()=>{
 const {createImagePreviewController}=await import('../src/lib/app/image-preview-controller.ts');
 const reads=[];let state;
 const viewer=createImagePreviewController((session,id)=>new Promise((resolve,reject)=>reads.push({session,id,resolve,reject})),value=>state=value);
 const first=viewer.open('s','one','one.png');viewer.close();reads[0].resolve('stale');await first;assert.equal(state,null);
 const second=viewer.open('s','two','two.png');const third=viewer.open('other','three','three.png');
 reads[1].resolve('wrong session');await second;assert.equal(state.sessionId,'other');assert.equal(state.url,null);
 reads[2].reject(Error('missing image'));await third;assert.ok(state.error);
 const retry=viewer.open('other','three','three.png');assert.equal(state.error,null);
 reads[3].resolve('data:image/png;base64,ok');await retry;assert.equal(state.url,'data:image/png;base64,ok');
});

test('attachment viewer actions are scoped and revoked independently of writing availability',async()=>{
 const {createConversationDirectory}=await import('../src/lib/presentation-runtime/conversation.ts');
 const {readFile}=await import('node:fs/promises');
 const state=JSON.parse(await readFile('fixtures/presentation-workbench/conversation.json','utf8'));
 state.session.archived=true;state.busy=true;
 state.attachments=[attachment('image',state.session.id),attachment('foreign','elsewhere'),{...attachment('reference',state.session.id),mediaType:'application/vnd.aibo.session-reference+json'}];
 const directory=createConversationDirectory();const actions=directory.project(state).filter(item=>item.operation==='openAttachment');
 assert.deepEqual(actions.map(item=>item.args),[['image']]);
 assert.equal(directory.resolve({...state,attachments:[]},{workspaceId:state.session.workspaceId,sessionId:state.session.id,revision:1},{id:actions[0].token,event:'click',context:{workspaceId:state.session.workspaceId,sessionId:state.session.id,revision:1}}),null);
 const tree=renderTimelineEntry({id:'message',role:'user',content:message('image'),status:'completed'},actions,state.attachments);
 assert.ok(JSON.stringify(tree).includes(actions[0].token));
});

test('image save suppresses duplicate dialogs, reports the chosen path, and cancels silently',async()=>{
 const {createImageSaveController}=await import('../src/lib/app/image-preview-controller.ts');
 const pending=[];const notices=[];const busy=[];
 const save=createImageSaveController((session,id)=>new Promise((resolve,reject)=>pending.push({session,id,resolve,reject})),value=>busy.push(value),(message,kind)=>notices.push({message,kind}));
 const first=save('s','image');await save('s','image');assert.equal(pending.length,1);
 pending[0].resolve(null);await first;assert.deepEqual(notices,[]);assert.deepEqual(busy,[true,false]);
 const second=save('other','next');assert.equal(pending[1].session,'other');
 pending[1].resolve('/chosen/next.png');await second;
 assert.equal(notices[0].kind,'success');assert.equal(notices[0].message.params.path,'/chosen/next.png');
 const third=save('s','image');pending[2].reject(Error('disk full'));await third;
 assert.equal(notices[1].kind,'error');assert.equal(busy.at(-1),false);
});
