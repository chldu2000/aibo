import test from 'node:test';
import assert from 'node:assert/strict';
import {readUserInputDrafts,writeUserInputDrafts} from '../src/lib/app/user-input-draft-storage.ts';
import {userInputDraftKey,answeredRequest,clearRequestDrafts} from '../src/lib/app/user-input-drafts.ts';
test('saved answers rebind only to matching request, question and turn in the same window',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const request={sessionId:'s',requestId:'r',turnId:'t',questions:[{id:'q'}]},key=userInputDraftKey(request,'q');
 writeUserInputDrafts(storage,'main',{[key]:'draft'},100);
 const drafts=readUserInputDrafts(storage,'main',101);
 assert.deepEqual(answeredRequest(request,drafts),{q:['draft']});
 for(const changed of [{requestId:'other'},{turnId:'other'},{sessionId:'other'},{questions:[{id:'other'}]}])assert.equal(answeredRequest({...request,...changed},drafts),null);
 assert.deepEqual(readUserInputDrafts(storage,'other',101),{});
 writeUserInputDrafts(storage,'main',clearRequestDrafts(request,drafts),102);
 assert.deepEqual(readUserInputDrafts(storage,'main',103),{});
});
test('answer cache rejects corrupt, expired, oversized and unscoped records without blocking live work',()=>{
 const key=JSON.stringify(['s','r','q',null]);let text;
 const storage={getItem:()=>text,setItem:(_,value)=>text=value};
 writeUserInputDrafts(storage,'main',{[key]:'answer',unscoped:'invalid'},100);
 assert.deepEqual(readUserInputDrafts(storage,'main',101),{[key]:'answer'});
 assert.deepEqual(readUserInputDrafts(storage,'main',100+31*24*60*60*1000),{});
 text='{broken';assert.deepEqual(readUserInputDrafts(storage,'main',101),{});
 text='x'.repeat(8*1024*1024+1);assert.deepEqual(readUserInputDrafts(storage,'main',101),{});
 assert.doesNotThrow(()=>writeUserInputDrafts({setItem(){throw Error('quota');}},'main',{[key]:'live'}));
});
