import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkbenchLayout,writeWorkbenchLayout,defaultWorkbenchLayout} from '../src/lib/app/workbench-layout-storage.ts';
test('layout survives a new reader and is isolated by window without skin identity',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const state={navigationWidth:412,auxiliaryWidth:388,auxiliaryOpen:false,activeView:'context'};
 writeWorkbenchLayout(storage,'main',state);
 assert.deepEqual(readWorkbenchLayout(storage,'main'),state);
 assert.deepEqual(readWorkbenchLayout(storage,'other'),defaultWorkbenchLayout());
 assert.ok(![...data.values()][0].includes('skin'));
});
test('invalid or unavailable layout storage cannot break startup and oversized widths are bounded',()=>{
 assert.deepEqual(readWorkbenchLayout({getItem(){throw Error('denied');}},'main'),defaultWorkbenchLayout());
 assert.deepEqual(readWorkbenchLayout({getItem:()=>'{broken'},'main'),defaultWorkbenchLayout());
 const corrupted={navigationWidth:-10,auxiliaryWidth:9000,auxiliaryOpen:'false',activeView:'unknown'};
 assert.deepEqual(readWorkbenchLayout({getItem:()=>JSON.stringify(corrupted)},'main'),{navigationWidth:180,auxiliaryWidth:4096,auxiliaryOpen:true,activeView:'git'});
 assert.doesNotThrow(()=>writeWorkbenchLayout({setItem(){throw Error('full');}},'main',defaultWorkbenchLayout()));
});
