import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepositoryViews, writeRepositoryViews, repositoryDraftKey } from '../src/lib/app/git-repository-state.ts';
import { renderGit } from '../packages/presentation-workbench/git.js';
import { gitActions } from '../src/lib/presentation-runtime/git.ts';

test('repository preferences persist per workspace and drafts isolate same-named repositories',()=>{
 const values=new Map();const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const views={w:{selected:'packages/api',collapsed:['other/api'],files:{'packages/api':{path:'same.txt',staged:true}}}};
 writeRepositoryViews(storage,'main',views);
 assert.deepEqual(readRepositoryViews(storage,'main'),views);
 assert.deepEqual(readRepositoryViews(storage,'other'),{});
 assert.notEqual(repositoryDraftKey('w','packages/api'),repositoryDraftKey('w','other/api'));
 assert.equal(repositoryDraftKey('w','.'),'w');
});
test('all-repository tree groups duplicate filenames and clean/error states independently',()=>{
 const changes={workspaceId:'w',branch:'main',captureStatus:'captured',files:[{path:'package.json',kind:'modified',unstaged:true,staged:false}]};
 const repo=(id,extra={})=>({id,name:'api',relativePath:id,kind:'repository',changes,error:null,...extra});
 const state={workspace:{id:'w',trust:'trusted'},desktop:true,repositories:[repo('one'),repo('two'),repo('clean',{changes:{...changes,files:[]}}),repo('failed',{changes:null,error:'unreadable'})],repositoryId:null,preview:{},draft:{},loading:false};
 const tree=renderGit(state,gitActions(state).map((action,i)=>({...action,token:`t${i}`})));
 const nodes=[];const visit=node=>{nodes.push(node);node.children?.forEach(visit);};visit(tree);
 assert.equal(new Set(nodes.map(node=>node.key)).size,nodes.length,'render keys remain unique for duplicate names and paths');
 assert.ok(nodes.some(node=>node.text==='干净的仓库（1）'));
 assert.ok(nodes.some(node=>node.text==='unreadable'));
 assert.equal(nodes.filter(node=>node.text==='modified package.json').length,2);
});
