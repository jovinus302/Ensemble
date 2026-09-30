import type { ContinueTaskInput, ParseError, Report, TaskInstructionsInput, UpdateInstructionsInput } from './protocol.ts';

export interface SessionInfo { threadId: string; workspace: string }
export type SendUpdateResult = { sent: true } | { sent: false; reason: string };
interface TurnContext { agentId: string; taskId: string; threadId: string; turnId: string }
export type SessionEvent =
  /** `reason` explains a failed turn: the runtime's own error or a lost session. */
  | (TurnContext & { type: 'turn'; status: 'started' | 'completed' | 'interrupted' | 'failed'; reason?: string })
  | (TurnContext & { type: 'reply'; itemId: string; text: string })
  | (TurnContext & { type: 'report'; itemId: string; index: number; report: Report })
  | (TurnContext & { type: 'parse_error'; itemId: string; index: number; error: ParseError });

/** Runtime-neutral boundary: connectors produce observations, never ledger writes. */
export interface SessionConnector {
  startSession(agentId: string, projectId: string): Promise<SessionInfo>;
  startTask(agentId: string, taskInput: TaskInstructionsInput): Promise<string>;
  sendUpdate(agentId: string, updateInput: UpdateInstructionsInput): Promise<SendUpdateResult>;
  /**
   * Starts a new turn on the agent's thread for a task whose last turn ended, carrying an update the
   * agent acknowledges before it carries on. Same one-active-turn rule as startTask. Runtimes that
   * cannot resume work omit it; the update then waits for the task's next start.
   */
  continueTask?(agentId: string, input: ContinueTaskInput): Promise<string>;
  onEvent(handler: (event: SessionEvent) => void): () => void;
  /** Interrupt this agent, or close the whole connector when omitted. */
  stop(agentId?: string): Promise<void>;
}
