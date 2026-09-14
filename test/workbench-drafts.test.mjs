import assert from 'node:assert/strict';
import test from 'node:test';
import {readWorkbenchDrafts,writeWorkbenchDrafts} from '../src/lib/app/workbench-drafts.ts';
test('workbench drafts persist by window and workspace without retaining retired plugin field identities',()=>{
 const data=new Map();const disk={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const original={git:{a:{commitMessage:'commit a',branchDraft:'branch a',gitSection:'history',selectedCommit:'valid'},b:{commitMessage:'commit b',branchDraft:'',gitSection:'changes',selectedCommit:null}}};
 writeWorkbenchDrafts(disk,'main',original);
 const key=[...data.keys()][0];
 data.set(key,JSON.stringify({...original,plugin:{legacy:{secretField:'obsolete'}}}));
 assert.deepEqual(readWorkbenchDrafts(disk,'main'),original);
 assert.deepEqual(readWorkbenchDrafts(disk,'other'),{git:{}});
 assert.deepEqual(readWorkbenchDrafts({getItem(){throw Error('denied');}},'main'),{git:{}});
});
