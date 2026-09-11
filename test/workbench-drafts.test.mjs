import assert from 'node:assert/strict';
import test from 'node:test';
import {readWorkbenchDrafts,writeWorkbenchDrafts} from '../src/lib/app/workbench-drafts.ts';
test('workbench drafts persist by window and workspace without expiring or merging plugin field identities',()=>{
 const data=new Map();const disk={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const original={git:{a:{commitMessage:'commit a',branchDraft:'branch a',gitSection:'history',selectedCommit:'valid'},b:{commitMessage:'commit b',branchDraft:'',gitSection:'changes',selectedCommit:null}},plugin:{fields:{'["a","view","field"]':'A','["b","view","field"]':'B'},expanded:{}}};
 writeWorkbenchDrafts(disk,'main',original);
 assert.deepEqual(readWorkbenchDrafts(disk,'main'),original);
 assert.deepEqual(readWorkbenchDrafts(disk,'other'),{git:{},plugin:{fields:{},expanded:{}}});
 assert.deepEqual(readWorkbenchDrafts({getItem(){throw Error('denied');}},'main'),{git:{},plugin:{fields:{},expanded:{}}});
});
