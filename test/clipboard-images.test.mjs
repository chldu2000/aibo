import test from 'node:test';
import assert from 'node:assert/strict';
import {clipboardImageFiles,encodeClipboardImages,MAX_CLIPBOARD_IMAGE_BYTES} from '../src/lib/app/clipboard-images.ts';

test('clipboard extraction leaves text alone and does not duplicate files exposed as both items and files',async()=>{
 const file=new File(['image'],'capture.png',{type:'image/png'});
 assert.deepEqual(clipboardImageFiles({items:[{kind:'string',type:'text/plain'}],files:[]}),[]);
 assert.deepEqual(clipboardImageFiles({items:[{kind:'file',type:file.type,getAsFile:()=>file}],files:[file]}),[file]);
 assert.deepEqual(clipboardImageFiles({items:[],files:[file]}),[file]);
 assert.deepEqual(await encodeClipboardImages([file]),[{mediaType:'image/png',data:Buffer.from('image').toString('base64')}]);
});
test('unsupported formats and limits reject before reading file bytes',async()=>{
 await assert.rejects(encodeClipboardImages([new File(['<svg/>'],'a.svg',{type:'image/svg+xml'})]),/支持粘贴/);
 await assert.rejects(encodeClipboardImages(Array.from({length:9},()=>new File(['a'],'a.png',{type:'image/png'}))),/8/);
 await assert.rejects(encodeClipboardImages([{size:MAX_CLIPBOARD_IMAGE_BYTES+1,type:'image/png',arrayBuffer(){assert.fail('must not read oversized data');}}]),/10 MiB/);
});
