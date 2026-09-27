export type AcpMessage = { jsonrpc: '2.0'; id?: string | number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } };
export declare class AcpTransport {
  constructor(options: { command: string; args?: string[]; cwd?: string; spawnProcess?: typeof import('node:child_process').spawn; requestTimeoutMs?: number; label?: string });
  readonly label: string;
  readonly closed: boolean;
  readonly stderr: string;
  start(): this;
  onRequest(handler: (message: AcpMessage) => boolean | void): () => void;
  onNotification(handler: (message: AcpMessage) => void): () => void;
  request(method: string, params: unknown, timeoutMs?: number): Promise<any>;
  notify(method: string, params: unknown): void;
  respond(id: string | number, result: unknown): void;
  respondError(id: string | number, code: number, message: string): void;
  close(options?: { forceAfterMs?: number }): Promise<void>;
}
