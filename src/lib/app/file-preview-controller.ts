import {toErrorMessage} from './error-utils.ts';

export type FilePreview = {path:string;content:string;startLine:number;totalLines:number;truncated:boolean;targetLine:number};
export type FilePreviewState = {sessionId:string|null;path:string|null;line:number|null;preview:FilePreview|null;loading:boolean;error:string|null};
export const emptyFilePreview = (): FilePreviewState => ({sessionId:null,path:null,line:null,preview:null,loading:false,error:null});

export function createFilePreviewController(read:(sessionId:string,path:string,line:number|null)=>Promise<FilePreview>, publish:(state:FilePreviewState)=>void) {
  let generation = 0;
  return {
    close() { generation++; publish(emptyFilePreview()); },
    async open(sessionId:string,path:string,line:number|null = null) {
      const ticket = ++generation;
      const state = {...emptyFilePreview(),sessionId,path,line};
      publish({...state,loading:true});
      try {
        const preview = await read(sessionId,path,line);
        if (ticket === generation) publish({...state,preview});
      } catch (error) {
        if (ticket === generation) publish({...state,error:toErrorMessage(error)});
      }
    },
  };
}
