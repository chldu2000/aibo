import {node,button,field,section,text,actionFor} from './tree.js';
export function renderGit(state,actions){
 const find=(operation,...args)=>actionFor(actions,operation,...args);
 const act=(operation,label,...args)=>{const action=find(operation,...args);return action?button('git:action:'+operation+':'+JSON.stringify(args),label,action):null;};
 const children=[];
 const repositories=state.repositories;
 const current=repositories?.find(repo=>repo.id===state.repositoryId);
 if(repositories){
  children.push(text('git:repository-target',current?`${current.name} · ${current.relativePath}${current.externalRoot?' · 仓库根目录位于工作区外':''}`:'所有仓库'));
  if(repositories.length>1||state.repositoryId===null)children.push(node('details','git:repository-picker',null,[node('summary','git:repository-picker-title',current?'切换仓库':'选择仓库以查看历史、分支或提交'),field('git:repository-search','搜索仓库名称或路径',state.repositorySearch,find('repositorySearch')),act('selectRepository','所有仓库',null),...repositories.filter(repo=>`${repo.name} ${repo.relativePath}`.toLowerCase().includes((state.repositorySearch??'').toLowerCase())).map(repo=>act('selectRepository',`${repo.name} · ${repo.relativePath}`,repo.id))],state.repositoryPickerOpen?{open:true}:{}));
  if(state.discoveryLimited)children.push(text('git:discovery-limited','发现范围受限'),act('continueDiscovery','继续扫描'));
  for(const [index,warning] of (state.discoveryWarnings??[]).entries())children.push(text('git:discovery-warning:'+index,warning));
 }
 if(repositories&&state.repositoryId===null){
  children.push(act('refresh','刷新仓库和变更'),act('selectSection','提交历史','history'),text('git:error',state.error));
  if(state.loading)children.push(node('p','git:loading','正在读取仓库',[],{role:'status'}));
  if(!repositories.length&&!state.loading)children.push(text('git:no-repositories','工作区内未发现 Git 仓库'));
  const group=repo=>{
   const prefix='git:repository:'+repo.id;
   const groupAct=(...args)=>{const result=act(...args);return result?{...result,key:prefix+':'+result.key}:null;};
   const files=repo.changes?.files??[];
   const content=[groupAct('toggleRepository',`${repo.name} · ${repo.changes?.branch??'Detached HEAD'} · ${files.length}`,repo.id),text(prefix+':path',repo.relativePath+(repo.kind==='submodule'?' · 子模块':repo.kind==='worktree'?' · Worktree':'')+(repo.externalRoot?' · 仓库根目录位于工作区外':''))];
   if(!(state.collapsedRepositories??[]).includes(repo.id)){
    content.push(text(prefix+':error',repo.error??repo.changes?.captureError));
    if(!repo.changes&&!repo.error)content.push(text(prefix+':loading','正在读取变更…'));
    for(const [scope,title] of [['staged','已暂存的更改'],['unstaged','更改']]){
     const entries=files.filter(file=>scope==='staged'?file.staged&&!file.conflicted:file.unstaged||file.untracked||file.conflicted);
     if(entries.length)content.push(section(prefix+':'+scope,title,entries.map(file=>node('div',prefix+':'+scope+':'+file.path,null,[text(prefix+':'+scope+':path:'+file.path,`${file.untracked?'?':file.conflicted?'!':file.kind} ${file.path}`),groupAct('repositoryDiff','查看差异',repo.id,file.path,scope),groupAct(scope==='staged'?'repositoryUnstage':'repositoryStage',scope==='staged'?'取消暂存':'暂存',repo.id,file.path)]))));
    }
    content.push(groupAct('repositoryStageAll','全部暂存',repo.id),groupAct('repositoryUnstageAll','全部取消暂存',repo.id),groupAct('selectRepository',files.some(file=>file.staged)?'提交…':'打开仓库',repo.id));
   }
   return node('section',prefix,null,content,{'aria-label':`仓库 ${repo.name} ${repo.relativePath}`});
  };
  const clean=repositories.filter(repo=>!repo.error&&repo.changes?.captureStatus==='captured'&&!repo.changes.files.length);
  children.push(...repositories.filter(repo=>!clean.includes(repo)).map(group));
  if(clean.length)children.push(node('details','git:clean-repositories',null,[node('summary','git:clean-repositories-title',`干净的仓库（${clean.length}）`),...clean.map(group)]));
 }else{
 const single=[node('nav','git:tools',null,[act('refresh','刷新变更'),act('refreshMetadata','刷新历史'),act('requestReview','请求审查'),act('selectSection','工作区变更','changes'),act('selectSection','提交历史','history')]),text('git:branch',state.changes?.branch),text('git:error',state.error),text('git:metadata-error',state.metadataError)];
 if(state.changes?.captureStatus&&state.changes.captureStatus!=='captured')single.push(node('p','git:capture-error',state.changes.captureError??'当前工作区无法读取 Git 状态',[],{role:'status'}));
 if(state.changes?.captureStatus==='captured'&&!state.changes.files.length)single.push(text('git:clean','工作区干净，没有待处理的更改'));
 if(state.loading||state.metadataLoading)single.push(node('p','git:loading','正在读取 Git 信息',[],{role:'status'}));
 if(state.draft.gitSection==='changes'){
  single.push(node('ul','git:files',null,(state.changes?.files??[]).map(file=>node('li','git:file:'+file.path,null,[text('git:path:'+file.path,file.path),text('git:kind:'+file.path,`${file.kind}${file.conflicted?' · 冲突':''}${file.staged?' · 已暂存':''}${file.untracked?' · 未跟踪':''}`),act('openDiff','查看已暂存差异',file.path,'staged'),act('openDiff','查看工作区差异',file.path,'unstaged'),act('stageFile','暂存',file.path),act('unstageFile','取消暂存',file.path)]))));
  single.push(act('stageAll','全部暂存'),act('unstageAll','全部取消暂存'),field('git:commit-message',current?`提交到 ${current.name} · ${state.changes?.branch??'Detached HEAD'}`:'提交说明',state.draft.commitMessage,find('commitMessage'),true),act('commit','提交'));
 }else{
  single.push(node('ul','git:history',null,state.history.map(commit=>node('li','git:commit:'+commit.hash,null,[act('selectCommit',`${commit.shortHash} ${commit.subject}`,commit.hash),text('git:author:'+commit.hash,`${commit.author} · ${commit.authoredAt}`)]))));
  if(state.commitFiles)single.push(node('ul','git:commit-files',null,state.commitFiles.files.map(file=>node('li','git:commit-file:'+file.path,null,[act('openCommitDiff',file.path,state.commitFiles.commit,file.path)]))),act('loadMoreCommitFiles','加载更多文件',state.commitFiles.commit));
 }
 single.push(node('details','git:branches',null,[node('summary','git:branches-title','分支'),field('git:branch-draft','新分支名称',state.draft.branchDraft,find('branchDraft')),act('createBranch','创建分支'),...state.branches.map(branch=>node('p','git:branch:'+branch.name,null,[text('git:branch-name:'+branch.name,branch.name+(branch.current?' · 当前':'')),act('checkoutBranch','切换分支',branch.name)]))]));
 if(state.remoteStatus)single.push(section('git:remote','远端',[text('git:upstream',state.remoteStatus.upstream),text('git:distance',`领先 ${state.remoteStatus.ahead} · 落后 ${state.remoteStatus.behind}`),act('fetch','获取'),act('pull','拉取'),act('push','推送')]));
 single.push(node('details','git:stashes',null,[node('summary','git:stash-title','暂存栈'),act('saveStash','保存到暂存栈'),...state.stashes.map(stash=>node('p','git:stash:'+stash.reference,null,[text('git:stash-message:'+stash.reference,stash.message),act('applyStash','应用 '+stash.reference,stash.reference)]))]));
 children.push(...single);
 }
 const preview=state.preview;
 if(preview.selectedPath||preview.fileDiff||preview.error||preview.loading)children.push(section('git:preview',preview.contextLabel??preview.selectedPath??'差异预览',[act('closeDiff','关闭差异'),preview.loading?text('git:preview-loading','正在读取差异'):null,text('git:preview-error',preview.error),text('git:preview-reason',preview.fileDiff?.reason),preview.fileDiff?node('pre','git:preview-content',preview.fileDiff.diff,[],{tabindex:'0'}):null,preview.fileDiff?.truncated?text('git:preview-truncated','差异已截断'):null]));
 return section('git','Git',children);
}
