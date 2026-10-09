import { translateMessage } from '../../../packages/i18n/index.js';
import type { Locale, LocalizedText } from '../../../packages/i18n/index.js';
import { LocalizedError, toErrorText } from './error-utils.ts';
import type { ArtifactContent } from '../types';
import type { PresentationArtifactPreview } from '../../../packages/plugin-protocol/src/presentation-inspector';
export type ArtifactPreviewState = Omit<PresentationArtifactPreview, 'error'> & { error: LocalizedText | null };
export function artifactPreviewPresentation(state: ArtifactPreviewState, locale: Locale): PresentationArtifactPreview {
  return { ...state, error: state.error === null ? null : translateMessage(locale, state.error) };
}
export const emptyArtifactPreview = (): ArtifactPreviewState => ({sessionId:null,artifactId:null,content:null,loading:false,error:null});
export function createArtifactPreviewController(ports: {
  read(sessionId: string, artifactId: string): Promise<ArtifactContent>;
  currentSession(): string | null;
  available(sessionId: string, artifactId: string): boolean;
  changed(state: ArtifactPreviewState): void;
}) {
  let generation = 0;
  let state = emptyArtifactPreview();
  const publish = (value: ArtifactPreviewState) => { state = value; ports.changed(value); };
  function reset() { ++generation; publish(emptyArtifactPreview()); }
  return {
    reset,
    async toggle(sessionId: string, artifactId: string) {
      if (ports.currentSession() !== sessionId || !ports.available(sessionId, artifactId)) return;
      if (state.sessionId === sessionId && state.artifactId === artifactId && !state.error) { reset(); return; }
      const owner = ++generation;
      const owns = () => generation === owner && ports.currentSession() === sessionId && ports.available(sessionId, artifactId);
      publish({sessionId,artifactId,content:null,loading:true,error:null});
      try {
        const content = await ports.read(sessionId, artifactId);
        if (!owns()) return;
        if (content.artifact.id !== artifactId || content.artifact.sessionId !== sessionId) throw new LocalizedError('artifact.identityMismatch');
        publish({sessionId,artifactId,content,loading:false,error:null});
      } catch(error) {
        if (owns()) publish({sessionId,artifactId,content:null,loading:false,error:toErrorText(error)});
      }
    },
  };
}
