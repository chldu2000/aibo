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
