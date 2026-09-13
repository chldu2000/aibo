import type { ArtifactContent } from '../types';
import type { PresentationArtifactPreview } from '../../../packages/plugin-protocol/src/presentation-inspector';
export const emptyArtifactPreview = (): PresentationArtifactPreview => ({sessionId:null,artifactId:null,content:null,loading:false,error:null});
export function createArtifactPreviewController(ports: {
  read(sessionId: string, artifactId: string): Promise<ArtifactContent>;
  currentSession(): string | null;
  available(sessionId: string, artifactId: string): boolean;
  changed(state: PresentationArtifactPreview): void;
}) {
  let generation = 0;
  let state = emptyArtifactPreview();
  const publish = (value: PresentationArtifactPreview) => { state = value; ports.changed(value); };
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
        if (content.artifact.id !== artifactId || content.artifact.sessionId !== sessionId) throw Error('artifact_identity_mismatch');
        publish({sessionId,artifactId,content,loading:false,error:null});
      } catch(error) {
        if (owns()) publish({sessionId,artifactId,content:null,loading:false,error:error instanceof Error ? error.message : String(error)});
      }
    },
  };
}
