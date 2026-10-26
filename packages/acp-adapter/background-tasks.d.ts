export interface BackgroundTask {
  id: string; rootTurnId: string; name: string; command: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';
  activity: string; output?: string; outputPath?: string; exitCode?: number | null;
}
export class BackgroundTasks {
  configureStorage(root: string, owner: string): void;
  checkpoint(): BackgroundTask[] | {schema: string; digest: string};
  tasks: Map<string, BackgroundTask>;
  update(update: Partial<BackgroundTask> & {id: string}, rootTurnId?: string | null): void;
  page(cursor?: string): {tasks: BackgroundTask[]; nextCursor: string | null};
  read(input: {taskId: string; cursor?: number; revision?: string}): {output: string; nextCursor: number | null; revision: string; truncated: boolean};
  list(): BackgroundTask[];
  restore(tasks: unknown): void;
  unavailable(message: string): void;
}

export function boundedRecovery<T>(value: T): T;
