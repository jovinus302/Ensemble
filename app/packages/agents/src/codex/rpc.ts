import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

export type RequestId = string | number;
export type ServerRequestHandler = (method: string, params: unknown) => unknown | Promise<unknown>;
export interface RpcOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  serverRequestHandler?: ServerRequestHandler;
}

export class RpcError extends Error {
  constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

/** Codex 0.154.0 JSONRPCMessage: deliberately no `jsonrpc` envelope field. */
export class JsonRpcClient extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<RequestId, { resolve(value: unknown): void; reject(error: Error): void }>();
  private nextId = 1;
  private failure?: Error;
  private stderr = '';
  private readonly exited: Promise<void>;

  constructor(private readonly options: RpcOptions = {}) {
    super();
    this.child = spawn(options.command ?? 'codex', options.args ?? ['app-server'], {
      cwd: options.cwd, env: options.env, stdio: 'pipe', windowsHide: true,
    });
    this.exited = new Promise(resolve => this.child.once('close', () => resolve()));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-2048); });
    this.child.on('error', () => this.fail(new Error('Codex app-server could not start')));
    this.child.stdin.on('error', () => this.fail(new Error('Codex app-server input closed')));
    this.child.on('exit', (code, signal) => this.fail(new Error(
      `Codex app-server exited (${signal ?? code})${this.stderr ? `; stderr: ${this.safeStderr()}` : ''}`,
    )));
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', line => this.receive(line));
    lines.on('close', () => this.fail(new Error('Codex app-server output closed')));
  }

  private safeStderr(): string {
    // Do not expose raw diagnostics: paths, credentials, and prompts may occur anywhere.
    return `[${this.stderr.length} buffered characters omitted]`;
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.child.kill();
  }

  private send(message: unknown): void {
    if (this.failure) throw this.failure;
    this.child.stdin.write(JSON.stringify(message) + '\n', error => {
      if (error) this.fail(new Error('Codex app-server write failed'));
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.failure) { reject(this.failure); return; }
      const id = this.nextId++;
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      try { this.send({ id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ method, ...(params === undefined ? {} : { params }) });
  }

  private receive(line: string): void {
    if (!line.trim() || this.failure) return;
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      message = parsed as Record<string, unknown>;
    } catch { this.fail(new Error('Invalid JSON message from Codex app-server')); return; }
    const id = message.id;
    const hasId = typeof id === 'string' || typeof id === 'number';
    if (typeof message.method === 'string') {
      if (hasId) void this.answer(id, message.method, message.params);
      else this.emit('notification', message.method, message.params);
    } else if (hasId) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error && typeof message.error === 'object') {
        const error = message.error as { code: number; message: string; data?: unknown };
        pending.reject(new RpcError(error.code, error.message, error.data));
      } else if ('result' in message) pending.resolve(message.result);
      else pending.reject(new Error('Invalid Codex app-server response'));
    }
  }

  private async answer(id: RequestId, method: string, params: unknown): Promise<void> {
    let response: unknown;
    try {
      if (!this.options.serverRequestHandler) throw new RpcError(-32601, 'Method not found');
      const result = await this.options.serverRequestHandler(method, params);
      if (result === undefined) throw new RpcError(-32603, 'Server request handler returned no result');
      response = { id, result };
      // Serialization failure must produce an error response too.
      JSON.stringify(response);
    } catch (error) {
      response = { id, error: {
        code: error instanceof RpcError ? error.code : -32603,
        message: error instanceof RpcError ? error.message : 'Server request handler failed',
      } };
    }
    try { this.send(response); } catch { /* A closed transport cannot accept a response. */ }
  }

  async close(): Promise<void> {
    this.fail(new Error('Codex app-server client closed'));
    await this.exited;
  }
}
