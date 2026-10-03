export interface BackgroundTask {
  id: string; rootTurnId: string; name: string; command: string; activity: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'unknown'; outputPath?: string; exitCode?: number | null;
}
export const backgroundTaskLabels: Record<BackgroundTask['status'], string>;
export function parseBackgroundTask(item: {toolName?: string | null; content: string; status: string}): BackgroundTask | null;
