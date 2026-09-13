import test from 'node:test';
import assert from 'node:assert/strict';
import {createLayoutDirectory} from '../src/lib/presentation-runtime/layout.ts';
test('layout input is bounded, scoped and revoked when its panel closes',()=>{
 const state={navigation:{width:260,min:180,max:600},auxiliary:{width:320,min:220,max:520},auxiliaryOpen:true};
 const directory=createLayoutDirectory(),actions=directory.project(state).filter(action=>action.operation==='resize');
 const context={workspaceId:'w',sessionId:'s',revision:2};
 const intent={id:actions[0].token,event:'input',value:'900',context};
 assert.deepEqual(directory.resolve(state,context,intent),{kind:'resize',target:'navigation',width:600});
 assert.equal(directory.resolve(state,context,{...intent,value:'-40'}).width,180);
 for(const value of ['','NaN','Infinity','320px'])assert.equal(directory.resolve(state,context,{...intent,value}),null);
 assert.equal(directory.resolve(state,context,{...intent,context:{...context,sessionId:'other'}}),null);
 assert.equal(directory.resolve(state,context,{...intent,context:{...context,revision:3}}),null);
 assert.equal(directory.resolve({...state,auxiliaryOpen:false},context,{...intent,id:actions[1].token}),null);
});

test('layout switches use current click authority and invalidate resize gestures from the previous order',()=>{
 const state={navigation:{width:260,min:180,max:600},auxiliary:{width:320,min:220,max:520},auxiliaryOpen:true,mode:'standard'};
 const directory=createLayoutDirectory(),actions=directory.project(state),context={workspaceId:'w',sessionId:'s',revision:2};
 const focus=actions.find(action=>action.operation==='selectMode'&&action.args[0]==='focus');
 const intent={id:focus.token,event:'click',context};
 assert.deepEqual(directory.resolve(state,context,intent),{kind:'mode',mode:'focus'});
 assert.equal(directory.resolve(state,context,{...intent,context:{...context,revision:1}}),null);
 assert.equal(directory.resolve({...state,switching:true},context,intent),null);
 const resize=actions.find(action=>action.operation==='resize');
 assert.equal(directory.resolve({...state,mode:'review'},context,{id:resize.token,event:'input',value:'400',context}),null);
 assert.ok(!directory.project({...state,mode:'focus'}).some(action=>action.operation==='resize'));
});
test('workbench modes preserve the standard slots, reverse review growth and retain only content in focus',async()=>{
 const {readFile}=await import('node:fs/promises');const {renderWorkbench}=await import('../packages/presentation-workbench/workbench.js');
 const data={};for(const name of ['navigation','conversation','git','inspector','capability'])data[name]=JSON.parse(await readFile(`fixtures/presentation-workbench/${name}.json`,'utf8'));
 data.inspector.open=true;
 const directory=createLayoutDirectory();
 const render=mode=>{data.layout={navigation:{width:260,min:180,max:600},auxiliary:{width:320,min:220,max:520},auxiliaryOpen:true,mode};data.layoutActions=directory.project(data.layout);return renderWorkbench({data},()=>({tag:'p',key:'semantic',text:'Content'}));};
 const standard=render('standard'),review=render('review'),focus=render('focus');
 assert.deepEqual(review.children.map(node=>node.key),standard.children.map(node=>node.key).reverse());
 assert.deepEqual(focus.children.map(node=>node.key),['workbench:center']);
 assert.equal(focus.children[0].children[0].children[0].attrs['aria-expanded'],'false');
 for(const target of ['navigation','auxiliary'])assert.equal(review.children.find(node=>node.key==='workbench:splitter:'+target).resize.direction,-standard.children.find(node=>node.key==='workbench:splitter:'+target).resize.direction);
});
