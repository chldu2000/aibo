export interface BackgroundTask {
  id: string; rootTurnId: string; name: string; command: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';
  activity: string; outputPath?: string; exitCode?: number | null;
}
export class BackgroundTasks {
  tasks: Map<string, BackgroundTask>;
  update(update: Partial<BackgroundTask> & {id: string}, rootTurnId?: string | null): void;
  list(): BackgroundTask[];
  restore(tasks: unknown): void;
  unavailable(message: string): void;
}
