import type { ProjectAction } from '../types';
import type { PresentationProjectEditor } from '../../../packages/plugin-protocol/src/presentation-inspector';
export const emptyProjectEditor = (): PresentationProjectEditor => ({generation:0,open:false,actionId:null,name:'',kind:'test',program:'pnpm',args:'test',cwd:'.',enabled:true,saving:false,error:null});
export type ProjectEditorField = 'name' | 'kind' | 'program' | 'args' | 'cwd';
export function parseProjectArgs(value: string): string[] {
  if (!value.trim()) return [];
  if (value.trim().startsWith('[')) {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== 'string')) throw Error('参数 JSON 必须是字符串数组');
    return parsed;
  }
  return value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}
export function createProjectEditorController(ports: {
  workspace(): string | null;
  actions(): ProjectAction[];
  save(input: {workspaceId:string;actionId:string|null;name:string;kind:ProjectAction['kind'];program:string;args:string[];cwd:string;enabled:boolean}): Promise<ProjectAction>;
  saved(workspaceId: string, action: ProjectAction): void;
  changed(workspaceId: string, editor: PresentationProjectEditor): void;
}) {
  let generation = 0;
  const editors = new Map<string,PresentationProjectEditor>();
  const read = (id:string) => editors.get(id) ?? emptyProjectEditor();
  const set = (id:string,value:PresentationProjectEditor) => {editors.set(id,value);ports.changed(id,value);};
  return {
    edit(actionId: string | null) {
      const id=ports.workspace();if(!id||read(id).saving)return;
      const action=actionId ? ports.actions().find(action=>action.id===actionId&&action.workspaceId===id):null;
      if(actionId&&!action)return;
      set(id,{...emptyProjectEditor(),generation:++generation,open:true,...(action?{actionId:action.id,name:action.name,kind:action.kind,program:action.program,args:JSON.stringify(action.args,null,2),cwd:action.cwd,enabled:action.enabled}:{})});
    },
    close(){const id=ports.workspace();if(id&&!read(id).saving)set(id,{...read(id),open:false,error:null});},
    change(field:ProjectEditorField,value:string){
      const id=ports.workspace();if(!id||!read(id).open||read(id).saving)return;
      if(!['name','kind','program','args','cwd'].includes(field))return;
      const limit={name:80,kind:16,program:255,args:1024*1024,cwd:4096}[field];
      if(!limit||typeof value!=='string'||value.length>limit)return;
      if(field==='kind'&&!['test','lint','build','custom'].includes(value))return;
      set(id,{...read(id),[field]:value,error:null});
    },
    async save(){
      const id=ports.workspace();if(!id)return;const editor=read(id);
      if(!editor.open||editor.saving||!editor.name.trim()||!editor.program.trim())return;
      if(editor.actionId&&!ports.actions().some(action=>action.workspaceId===id&&action.id===editor.actionId)){set(id,{...editor,error:'工程动作已不可用，请重新选择。'});return;}
      set(id,{...editor,saving:true,error:null});
      try {
        const saved=await ports.save({workspaceId:id,actionId:editor.actionId,name:editor.name.trim(),kind:editor.kind,program:editor.program.trim(),args:parseProjectArgs(editor.args),cwd:editor.cwd.trim()||'.',enabled:editor.enabled});
        if(saved.workspaceId!==id||(editor.actionId&&saved.id!==editor.actionId))throw Error('project_action_identity_mismatch');
        ports.saved(id,saved);set(id,{...editor,open:false,saving:false,error:null});
      }catch(error){set(id,{...editor,saving:false,error:error instanceof Error?error.message:String(error)});}
    },
  };
}
