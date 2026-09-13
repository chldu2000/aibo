import {node,button,field,section,text,actionFor} from './tree.js';
export function renderGit(state,actions){
 const find=(operation,...args)=>actionFor(actions,operation,...args);
 const act=(operation,label,...args)=>{const action=find(operation,...args);return action?button('git:action:'+operation+':'+JSON.stringify(args),label,action):null;};
 const children=[node('nav','git:tools',null,[act('refresh','刷新变更'),act('refreshMetadata','刷新历史'),act('requestReview','请求审查'),act('selectSection','工作区变更','changes'),act('selectSection','提交历史','history')]),text('git:branch',state.changes?.branch),text('git:error',state.error),text('git:metadata-error',state.metadataError)];
 if(state.changes?.captureStatus&&state.changes.captureStatus!=='captured')children.push(node('p','git:capture-error',state.changes.captureError??'当前工作区无法读取 Git 状态',[],{role:'status'}));
 if(state.changes?.captureStatus==='captured'&&!state.changes.files.length)children.push(text('git:clean','工作区干净，没有待处理的更改'));
 if(state.loading||state.metadataLoading)children.push(node('p','git:loading','正在读取 Git 信息',[],{role:'status'}));
 if(state.draft.gitSection==='changes'){
  children.push(node('ul','git:files',null,(state.changes?.files??[]).map(file=>node('li','git:file:'+file.path,null,[text('git:path:'+file.path,file.path),text('git:kind:'+file.path,`${file.kind}${file.conflicted?' · 冲突':''}${file.staged?' · 已暂存':''}${file.untracked?' · 未跟踪':''}`),act('openDiff','查看已暂存差异',file.path,'staged'),act('openDiff','查看工作区差异',file.path,'unstaged'),act('stageFile','暂存',file.path),act('unstageFile','取消暂存',file.path)]))));
  children.push(act('stageAll','全部暂存'),act('unstageAll','全部取消暂存'),field('git:commit-message','提交说明',state.draft.commitMessage,find('commitMessage'),true),act('commit','提交'));
 }else{
  children.push(node('ul','git:history',null,state.history.map(commit=>node('li','git:commit:'+commit.hash,null,[act('selectCommit',`${commit.shortHash} ${commit.subject}`,commit.hash),text('git:author:'+commit.hash,`${commit.author} · ${commit.authoredAt}`)]))));
  if(state.commitFiles)children.push(node('ul','git:commit-files',null,state.commitFiles.files.map(file=>node('li','git:commit-file:'+file.path,null,[act('openCommitDiff',file.path,state.commitFiles.commit,file.path)]))),act('loadMoreCommitFiles','加载更多文件',state.commitFiles.commit));
 }
 children.push(node('details','git:branches',null,[node('summary','git:branches-title','分支'),field('git:branch-draft','新分支名称',state.draft.branchDraft,find('branchDraft')),act('createBranch','创建分支'),...state.branches.map(branch=>node('p','git:branch:'+branch.name,null,[text('git:branch-name:'+branch.name,branch.name+(branch.current?' · 当前':'')),act('checkoutBranch','切换分支',branch.name)]))]));
 if(state.remoteStatus)children.push(section('git:remote','远端',[text('git:upstream',state.remoteStatus.upstream),text('git:distance',`领先 ${state.remoteStatus.ahead} · 落后 ${state.remoteStatus.behind}`),act('fetch','获取'),act('pull','拉取'),act('push','推送')]));
 children.push(node('details','git:stashes',null,[node('summary','git:stash-title','暂存栈'),act('saveStash','保存到暂存栈'),...state.stashes.map(stash=>node('p','git:stash:'+stash.reference,null,[text('git:stash-message:'+stash.reference,stash.message),act('applyStash','应用 '+stash.reference,stash.reference)]))]));
 const preview=state.preview;
 if(preview.selectedPath||preview.fileDiff||preview.error||preview.loading)children.push(section('git:preview',preview.contextLabel??preview.selectedPath??'差异预览',[act('closeDiff','关闭差异'),preview.loading?text('git:preview-loading','正在读取差异'):null,text('git:preview-error',preview.error),text('git:preview-reason',preview.fileDiff?.reason),preview.fileDiff?node('pre','git:preview-content',preview.fileDiff.diff,[],{tabindex:'0'}):null,preview.fileDiff?.truncated?text('git:preview-truncated','差异已截断'):null]));
 return section('git','Git',children);
}
