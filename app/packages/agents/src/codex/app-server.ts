import { JsonRpcClient, RpcError, type RpcOptions } from './rpc.ts';

// Wire names and discriminants from codex-cli 0.154.0 generated JSON schemas.
// Less frequently consumed fields remain opaque and are preserved on returned objects.
export type ThreadItem =
  | { id: string; type: 'agentMessage'; text: string; phase?: 'commentary' | 'final_answer' | null; [key: string]: unknown }
  | { id: string; type: 'plan'; text: string; [key: string]: unknown }
  | { id: string; type: 'userMessage' | 'hookPrompt' | 'functionCallOutput' | 'reasoning'
      | 'commandExecution' | 'fileChange' | 'mcpToolCall' | 'dynamicToolCall'
      | 'collabAgentToolCall' | 'subAgentActivity' | 'webSearch' | 'imageView'
      | 'sleep' | 'imageGeneration' | 'enteredReviewMode' | 'exitedReviewMode'
      | 'contextCompaction'; [key: string]: unknown };
export interface CodexTurn {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  items: ThreadItem[];
  error?: { message: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}
export interface CodexThread {
  id: string;
  turns: CodexTurn[];
  cwd: string;
  [key: string]: unknown;
}
export interface CodexNotifications {
  'turn/started': { threadId: string; turn: CodexTurn };
  'turn/completed': { threadId: string; turn: CodexTurn };
  'item/completed': { threadId: string; turnId: string; item: ThreadItem; completedAtMs: number };
}
export interface ThreadOptions {
  cwd?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy?: 'untrusted' | 'on-request' | 'never' | {
    granular: { mcp_elicitations: boolean; rules: boolean; sandbox_approval: boolean;
      request_permissions?: boolean; skill_approval?: boolean };
  };
  developerInstructions?: string;
  model?: string;
}
export interface TurnInput { threadId: string; text: string; clientUserMessageId?: string }
export interface SteerInput extends TurnInput { expectedTurnId: string; clientUserMessageId: string }
export interface InitializeResult {
  userAgent: string; codexHome: string; platformFamily: string; platformOs: string;
}

export class SteerRejectedError extends RpcError {
  constructor(public readonly threadId: string, public readonly expectedTurnId: string, cause: RpcError) {
    super(cause.code, cause.message, cause.data);
    this.name = 'SteerRejectedError';
    this.cause = cause;
  }
}

/** Denial shapes differ by method; an empty permission grant grants nothing. */
export function declineServerRequest(method: string): unknown {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval': return { decision: 'decline' };
    case 'item/permissions/requestApproval': return { permissions: {}, scope: 'turn' };
    case 'item/tool/requestUserInput': return { answers: {} };
    case 'mcpServer/elicitation/request': return { action: 'decline' };
    case 'applyPatchApproval':
    case 'execCommandApproval': return { decision: 'abort' };
    default: throw new RpcError(-32601, 'Method not found');
  }
}

export class CodexAppServerClient {
  private readonly rpc: JsonRpcClient;
  private initialization?: Promise<InitializeResult>;

  constructor(options: RpcOptions = {}) {
    this.rpc = new JsonRpcClient({ ...options,
      serverRequestHandler: options.serverRequestHandler ?? declineServerRequest });
  }

  initialize(): Promise<InitializeResult> {
    return this.initialization ??= this.rpc.request<InitializeResult>('initialize', {
      clientInfo: { name: 'ensemble', title: 'Ensemble', version: '0.0.0' },
    }).then(result => { this.rpc.notify('initialized'); return result; });
  }

  async threadStart(options: ThreadOptions = {}): Promise<string> {
    const result = await this.rpc.request<{ thread: CodexThread }>('thread/start', {
      ...options, sandbox: options.sandbox ?? 'workspace-write', approvalPolicy: options.approvalPolicy ?? 'never',
    });
    return result.thread.id;
  }

  async threadResume(threadId: string, options: ThreadOptions & { excludeTurns?: boolean } = {}): Promise<string> {
    const result = await this.rpc.request<{ thread: CodexThread }>('thread/resume', { ...options, threadId });
    return result.thread.id;
  }

  async threadRead(threadId: string, options: { includeTurns?: boolean } = {}): Promise<CodexThread> {
    return (await this.rpc.request<{ thread: CodexThread }>('thread/read', { ...options, threadId })).thread;
  }

  async turnStart({ text, ...params }: TurnInput): Promise<string> {
    const result = await this.rpc.request<{ turn: CodexTurn }>('turn/start', {
      ...params, input: [{ type: 'text', text, text_elements: [] }],
    });
    return result.turn.id;
  }

  async turnSteer({ text, ...params }: SteerInput): Promise<string> {
    try {
      return (await this.rpc.request<{ turnId: string }>('turn/steer', {
        ...params, input: [{ type: 'text', text, text_elements: [] }],
      })).turnId;
    } catch (error) {
      // Transport failures remain distinguishable: acceptance is then unknown.
      if (error instanceof RpcError) throw new SteerRejectedError(params.threadId, params.expectedTurnId, error);
      throw error;
    }
  }

  async turnInterrupt(params: { threadId: string; turnId: string }): Promise<void> {
    await this.rpc.request('turn/interrupt', params);
  }

  on<K extends string>(method: K, handler: (params: K extends keyof CodexNotifications ? CodexNotifications[K] : unknown) => void): () => void {
    const listener = (name: string, params: unknown) => {
      if (name === method) handler(params as K extends keyof CodexNotifications ? CodexNotifications[K] : unknown);
    };
    this.rpc.on('notification', listener);
    return () => { this.rpc.off('notification', listener); };
  }

  /** Fires once when the app-server process or transport is lost (including close()). */
  onFailure(handler: (error: Error) => void): () => void {
    this.rpc.on('failure', handler);
    return () => { this.rpc.off('failure', handler); };
  }

  close(): Promise<void> { return this.rpc.close(); }
}
