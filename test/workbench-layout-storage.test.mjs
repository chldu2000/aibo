import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkbenchLayout,writeWorkbenchLayout,defaultWorkbenchLayout} from '../src/lib/app/workbench-layout-storage.ts';
test('layout survives a new reader and is isolated by window without skin identity',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 const state={navigationCollapsed:true,navigationWidth:412,auxiliaryWidth:388,auxiliaryOpen:false,auxiliaryCollapsed:true,activeView:'context'};
 writeWorkbenchLayout(storage,'main',state);
 assert.deepEqual(readWorkbenchLayout(storage,'main'),state);
 assert.deepEqual(readWorkbenchLayout(storage,'other'),defaultWorkbenchLayout());
 assert.ok(![...data.values()][0].includes('skin'));
});
test('invalid or unavailable layout storage cannot break startup and oversized widths are bounded',()=>{
 assert.deepEqual(readWorkbenchLayout({getItem(){throw Error('denied');}},'main'),defaultWorkbenchLayout());
 assert.deepEqual(readWorkbenchLayout({getItem:()=>'{broken'},'main'),defaultWorkbenchLayout());
 const corrupted={navigationWidth:-10,auxiliaryWidth:9000,auxiliaryOpen:'false',activeView:'unknown'};
 assert.deepEqual(readWorkbenchLayout({getItem:()=>JSON.stringify(corrupted)},'main'),{navigationCollapsed:false,navigationWidth:180,auxiliaryWidth:4096,auxiliaryOpen:true,auxiliaryCollapsed:false,activeView:'git'});
 assert.doesNotThrow(()=>writeWorkbenchLayout({setItem(){throw Error('full');}},'main',defaultWorkbenchLayout()));
});
test('narrow windows compress displayed side columns without rewriting the saved preference',async()=>{
 const {fitColumnWidths}=await import('../src/lib/app/workbench-columns.ts');
 const input=space=>({space,navigation:{width:260,min:180,collapsed:false,collapsedWidth:56},inspector:{width:340,min:220,open:true}});
 assert.deepEqual(fitColumnWidths(input(1000)),{navigation:260,inspector:340},'wide windows keep preferences');
 assert.deepEqual(fitColumnWidths(input(500)),{navigation:220,inspector:280},'overflow is shared by the slack above each minimum');
 assert.deepEqual(fitColumnWidths(input(100)),{navigation:180,inspector:220},'columns never go below their minimum');
 const collapsed={space:300,navigation:{width:260,min:180,collapsed:true,collapsedWidth:56},inspector:{width:340,min:220,open:true}};
 assert.deepEqual(fitColumnWidths(collapsed),{navigation:56,inspector:244},'a collapsed navigation rail is fixed');
 const closed={space:200,navigation:{width:260,min:180,collapsed:false,collapsedWidth:56},inspector:{width:340,min:220,open:false}};
 assert.deepEqual(fitColumnWidths(closed),{navigation:200,inspector:340},'a closed inspector keeps its preference for reopening');
});
