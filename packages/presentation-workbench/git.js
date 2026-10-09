import {presentationTranslator} from './i18n.js';
import {formatDateTime} from './i18n.generated.js';
import {node,button,field,section,text,actionFor} from './tree.js';
export function renderGit(state,actions,locale='zh-CN'){
 const t=presentationTranslator(locale);
 const kinds={added:t('git.added'),modified:t('git.modified'),deleted:t('git.deleted'),renamed:t('git.renamed')};
 const kindLabel=kind=>Object.hasOwn(kinds,kind)?kinds[kind]:kind;
 const find=(operation,...args)=>actionFor(actions,operation,...args);
 const act=(operation,label,...args)=>{const action=find(operation,...args);return action?button('git:action:'+operation+':'+JSON.stringify(args),label,action):null;};
 const children=[];
 const repositories=state.repositories;
 const current=repositories?.find(repo=>repo.id===state.repositoryId);
 if(repositories){
  children.push(text('git:repository-target',current?`${current.name} · ${current.relativePath}${current.externalRoot?t('git.externalRootSuffix'):''}`:t('repository.all')));
  if(repositories.length>1||state.repositoryId===null)children.push(node('details','git:repository-picker',null,[node('summary','git:repository-picker-title',current?t('external.switchRepository'):t('external.selectRepositoryHint')),field('git:repository-search',t('external.searchRepositories'),state.repositorySearch,find('repositorySearch')),act('selectRepository',t('repository.all'),null),...repositories.filter(repo=>`${repo.name} ${repo.relativePath}`.toLowerCase().includes((state.repositorySearch??'').toLowerCase())).map(repo=>act('selectRepository',`${repo.name} · ${repo.relativePath}`,repo.id))],state.repositoryPickerOpen?{open:true}:{}));
  if(state.discoveryLimited)children.push(text('git:discovery-limited',t('git.discoveryLimited')),act('continueDiscovery',t('git.continueDiscovery')));
  for(const [index,warning] of (state.discoveryWarnings??[]).entries())children.push(text('git:discovery-warning:'+index,warning));
 }
 if(repositories&&state.repositoryId===null){
  children.push(act('refresh',t('external.refreshRepositories')),act('selectSection',t('git.history'),'history'),text('git:error',state.error));
  if(state.loading)children.push(node('p','git:loading',t('external.loadingRepositories'),[],{role:'status'}));
  if(!repositories.length&&!state.loading)children.push(text('git:no-repositories',t('external.noRepositories')));
  const group=repo=>{
   const prefix='git:repository:'+repo.id;
   const groupAct=(...args)=>{const result=act(...args);return result?{...result,key:prefix+':'+result.key}:null;};
   const files=repo.changes?.files??[];
   const content=[groupAct('toggleRepository',`${repo.name} · ${repo.changes?.branch??t('git.detachedHead')} · ${files.length}`,repo.id),text(prefix+':path',repo.relativePath+(repo.kind==='submodule'?t('git.submoduleSuffix'):repo.kind==='worktree'?t('git.worktreeSuffix'):'')+(repo.externalRoot?t('git.externalRootSuffix'):''))];
   if(!(state.collapsedRepositories??[]).includes(repo.id)){
    content.push(text(prefix+':error',repo.error??repo.changes?.captureError));
    if(!repo.changes&&!repo.error)content.push(text(prefix+':loading',t('app.loadingChanges')));
    for(const [scope,title] of [['staged',t('external.stagedChanges')],['unstaged',t('git.changed')]]){
     const entries=files.filter(file=>scope==='staged'?file.staged&&!file.conflicted:file.unstaged||file.untracked||file.conflicted);
     if(entries.length)content.push(section(prefix+':'+scope,title,entries.map(file=>node('div',prefix+':'+scope+':'+file.path,null,[text(prefix+':'+scope+':path:'+file.path,`${file.untracked?'?':file.conflicted?'!':kindLabel(file.kind)} ${file.path}`),groupAct('repositoryDiff',t('semantic.inspect'),repo.id,file.path,scope),groupAct(scope==='staged'?'repositoryUnstage':'repositoryStage',scope==='staged'?t('git.unstage'):t('git.stage'),repo.id,file.path)]))));
    }
    content.push(groupAct('repositoryStageAll',t('git.stageAll'),repo.id),groupAct('repositoryUnstageAll',t('git.unstageEverything'),repo.id),groupAct('selectRepository',files.some(file=>file.staged)?t('git.commitEllipsis'):t('git.openRepository'),repo.id));
   }
   return node('section',prefix,null,content,{'aria-label':t('external.repositoryLabel',{name:repo.name,path:repo.relativePath})});
  };
  const clean=repositories.filter(repo=>!repo.error&&repo.changes?.captureStatus==='captured'&&!repo.changes.files.length);
  children.push(...repositories.filter(repo=>!clean.includes(repo)).map(group));
  if(clean.length)children.push(node('details','git:clean-repositories',null,[node('summary','git:clean-repositories-title',t('external.cleanRepositories',{count:clean.length})),...clean.map(group)]));
 }else{
 const single=[node('nav','git:tools',null,[act('refresh',t('app.refreshChanges')),act('refreshMetadata',t('external.refreshHistory')),act('requestReview',t('external.requestReview')),act('selectSection',t('app.workspaceChanges'),'changes'),act('selectSection',t('git.history'),'history')]),text('git:branch',state.changes?.branch),text('git:error',state.error),text('git:metadata-error',state.metadataError)];
 if(state.changes?.captureStatus&&state.changes.captureStatus!=='captured')single.push(node('p','git:capture-error',state.changes.captureError??t('external.gitStateUnavailable'),[],{role:'status'}));
 if(state.changes?.captureStatus==='captured'&&!state.changes.files.length)single.push(text('git:clean',t('external.cleanWorkspace')));
 if(state.loading||state.metadataLoading)single.push(node('p','git:loading',t('external.loadingGit'),[],{role:'status'}));
 if(state.draft.gitSection==='changes'){
  single.push(node('ul','git:files',null,(state.changes?.files??[]).map(file=>node('li','git:file:'+file.path,null,[text('git:path:'+file.path,file.path),text('git:kind:'+file.path,`${kindLabel(file.kind)}${file.conflicted?t('external.conflictSuffix'):''}${file.staged?t('external.stagedSuffix'):''}${file.untracked?t('external.untrackedSuffix'):''}`),act('openDiff',t('external.viewStagedDiff'),file.path,'staged'),act('openDiff',t('external.viewWorkingDiff'),file.path,'unstaged'),act('stageFile',t('git.stage'),file.path),act('unstageFile',t('git.unstage'),file.path)]))));
  single.push(act('stageAll',t('git.stageAll')),act('unstageAll',t('git.unstageEverything')),field('git:commit-message',current?t('external.commitTarget',{name:current.name,branch:state.changes?.branch??t('git.detachedHead')}):t('external.commitMessage'),state.draft.commitMessage,find('commitMessage'),true),act('commit',t('execution.operation.git.commit')));
 }else{
  single.push(node('ul','git:history',null,state.history.map(commit=>node('li','git:commit:'+commit.hash,null,[act('selectCommit',`${commit.shortHash} ${commit.subject}`,commit.hash),text('git:author:'+commit.hash,`${commit.author} · ${formatDateTime(locale,commit.authoredAt,{dateStyle:'medium',timeStyle:'short'})}`)]))));
  if(state.historyLoadMoreError)single.push(node('p','git:history-more-error',state.historyLoadMoreError,[],{role:'alert'}));
  single.push(state.historyLoadingMore?text('git:history-more-loading',t('git.loadingMoreCommits')):state.historyHasMore?act('loadMoreHistory',t('git.loadMoreCommits')):null);
  if(state.commitFiles)single.push(node('ul','git:commit-files',null,state.commitFiles.files.map(file=>node('li','git:commit-file:'+file.path,null,[act('openCommitDiff',file.path,state.commitFiles.commit,file.path)]))),act('loadMoreCommitFiles',t('external.loadMoreFiles'),state.commitFiles.commit));
 }
 single.push(node('details','git:branches',null,[node('summary','git:branches-title',t('external.branches')),field('git:branch-draft',t('git.newBranch'),state.draft.branchDraft,find('branchDraft')),act('createBranch',t('execution.operation.git.create-branch')),...state.branches.map(branch=>node('p','git:branch:'+branch.name,null,[text('git:branch-name:'+branch.name,branch.name+(branch.current?t('external.currentSuffix'):'')),act('checkoutBranch',t('execution.operation.git.checkout'),branch.name)]))]));
 if(state.remoteStatus)single.push(section('git:remote',t('external.remote'),[text('git:upstream',state.remoteStatus.upstream),text('git:distance',t('external.remoteDistance',{ahead:state.remoteStatus.ahead,behind:state.remoteStatus.behind})),act('fetch',t('external.fetch')),act('pull',t('git.pull')),act('push',t('git.push'))]));
 single.push(node('details','git:stashes',null,[node('summary','git:stash-title',t('git.stash')),act('saveStash',t('external.saveStash')),...state.stashes.map(stash=>node('p','git:stash:'+stash.reference,null,[text('git:stash-message:'+stash.reference,stash.message),act('applyStash',t('external.applyStash',{reference:stash.reference}),stash.reference)]))]));
 children.push(...single);
 }
 const preview=state.preview;
 if(preview.selectedPath||preview.fileDiff||preview.error||preview.loading)children.push(section('git:preview',preview.contextLabel??preview.selectedPath??t('external.diffPreview'),[act('closeDiff',t('external.closeDiff')),preview.loading?text('git:preview-loading',t('external.loadingDiff')):null,text('git:preview-error',preview.error),text('git:preview-reason',preview.fileDiff?.reason),preview.fileDiff?node('pre','git:preview-content',preview.fileDiff.diff,[],{tabindex:'0'}):null,preview.fileDiff?.truncated?text('git:preview-truncated',t('external.diffTruncated')):null]));
 return section('git','Git',children);
}
