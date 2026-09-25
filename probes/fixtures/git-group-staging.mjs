import '/src/app.css';
import {mount,unmount} from 'svelte';
import Panel from '/src/lib/components/app/WorkspaceGitPanel.svelte';
import {setUiKit,setUiTheme,activeThemeStyle} from '/src/lib/ui-kit/registry.ts';
import {get} from 'svelte/store';
const file=(path,extra={})=>({path,previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false,...extra});
const files=[file('tracked.txt'),file('new.txt',{kind:'added',unstaged:false,untracked:true}),file('conflict.txt',{conflicted:true}),file('staged.txt',{staged:true,unstaged:false})];
const changes={workspaceId:'workspace',head:'head',branch:'main',dirty:true,captureStatus:'captured',files};
let instance;window.actions=[];
window.mountGroup=async ({kit='ak-ui',theme='light',all=false,busy=false,trust='trusted'}={})=>{
 if(instance)await unmount(instance);setUiKit(kit);setUiTheme(theme);
 const app=document.getElementById('app');app.className='app-shell';app.dataset.uiKit=kit;app.style.cssText=get(activeThemeStyle);
 const noop=()=>{};
 const props={repositories:[{id:'one',name:'One',relativePath:'one',kind:'repository',changes},{id:'two',name:'Two',relativePath:'two',kind:'repository',changes}],repositoryId:all?null:'one',repositorySearch:'',collapsedRepositories:[],discoveryLimited:false,discoveryWarnings:[],draftState:{commitMessage:'',branchDraft:'',gitSection:'changes',selectedCommit:null},workspace:{id:'workspace',label:'Workspace',path:'/fixture',trust},desktop:true,changes,loading:false,error:null,selectedFilePath:null,previewRepositoryId:null,selectedFileStaged:false,branches:[],history:[],historyHasMore:false,historyLoadingMore:false,historyLoadMoreError:null,gitMetadataLoading:false,gitMetadataError:null,commitFiles:null,commitFilesLoading:false,remoteStatus:null,stashes:[],operationBusy:busy,reviewBusy:false,canRequestReview:false,activeView:'git',onApplyWorkspaceAction:(workspaceId,action,repositoryId)=>window.actions.push({workspaceId,action,repositoryId}),onApplyFileAction:(...args)=>window.actions.push({file:args})};
 for(const name of ['onSelectRepository','onRepositorySearch','onToggleRepository','onContinueDiscovery','onDraftChange','onRefresh','onCommit','onOpenDiff','onRefreshGitMetadata','onLoadMoreHistory','onCheckoutBranch','onCreateBranch','onSelectCommit','onLoadMoreCommitFiles','onOpenCommitFileDiff','onSync','onSaveStash','onApplyStash','onRequestReview','onSelectView'])props[name]=noop;
 instance=mount(Panel,{target:app,props});
};
