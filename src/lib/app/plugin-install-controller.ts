import { readNativeMessage, toErrorText } from './error-utils.ts';
import { localizedMessage, translateMessage } from '../../../packages/i18n/index.js';
import type { Locale, LocalizedText } from '../../../packages/i18n/index.js';
import { pluginRemovalImpactPresentation, type PluginRemovalImpact } from './plugin-lifecycle-controller.ts';
export type PluginInstallPreview = {
  pluginId: string; version: string; kind: 'install' | 'installed' | 'upgrade' | 'replace' | 'downgrade';
  token: string; archivedSessions?: string[]; rebuildSessions?: string[]; previous: string[]; impacts: PluginRemovalImpact[]; blockers: string[]; localizedBlockers?: unknown[];
};
export type PluginInstallState = { preview: PluginInstallPreview | null; busy: boolean; error: LocalizedText; notice: LocalizedText; undoTargets: string[]; skipArchived: boolean };
export function createPluginInstallController(ports: {
  preview(path: string): Promise<PluginInstallPreview>;
  install(path: string, token: string, reinstall: boolean, skipArchived: boolean): Promise<unknown>;
  undo(id: string): Promise<void>;
  undoTargets(): Promise<string[]>;
  refresh(): Promise<void>;
  publish(state: PluginInstallState): void;
}) {
  let state: PluginInstallState = {preview:null,busy:false,error:'',notice:'',undoTargets:[],skipArchived:true};
  let path = '';
  const emit = () => ports.publish({...state});
  async function run(action: () => Promise<void>) {
    if (state.busy) return;
    state = {...state,busy:true,error:'',notice:''}; emit();
    try {await action();} catch (error) {state.error = toErrorText(error);}
    finally {state.busy=false;emit();}
  }
  return {
    review: (source: string) => run(async () => {
      path=source;state.preview=null;state.skipArchived=true;
      const preview=await ports.preview(source);
      if (preview.kind==='installed') state.notice=localizedMessage('install.alreadyInstalled');
      else state.preview=preview;
    }),
    confirm: (reinstall=false) => run(async () => {
      const preview=state.preview;
      if (!preview || preview.blockers.length || (preview.kind==='downgrade')!==reinstall) return;
      state.preview=null; // Failed or stale confirmation must be reviewed again.
      await ports.install(path,preview.token,reinstall,state.skipArchived);
      await ports.refresh();
      state.undoTargets=await ports.undoTargets();
      state.notice=reinstall ? localizedMessage('install.downgraded') : localizedMessage('install.completed');
    }),
    undo: (id: string) => run(async () => {
      await ports.undo(id);await ports.refresh();state.undoTargets=await ports.undoTargets();state.notice=localizedMessage('install.undone');
    }),
    refreshUndo: async () => {const targets=await ports.undoTargets();state.undoTargets=targets;emit();},
    setSkipArchived: (value: boolean) => {if (!state.busy) {state.skipArchived=value;emit();}},
    cancel: () => {if(!state.busy){state.preview=null;state.error='';emit();}},
  };
}

export function pluginInstallStatePresentation(state: PluginInstallState, locale: Locale): PluginInstallState {
  if (!state.preview) return state;
  const {localizedBlockers, ...preview} = state.preview;
  const metadata = Array.isArray(localizedBlockers) && localizedBlockers.length === preview.blockers.length ? localizedBlockers : [];
  return {...state,preview:{...preview,blockers:preview.blockers.map((text,index)=>translateMessage(locale,readNativeMessage(metadata[index]) ?? text)),impacts:preview.impacts.map(impact=>pluginRemovalImpactPresentation(impact,locale)!)} };
}
