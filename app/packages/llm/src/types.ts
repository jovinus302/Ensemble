// Provider-neutral LLM interface. Anthropic (through the proxy) is the first implementation;
// other providers on the same proxy can be added without touching callers.

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export type LlmMessage =
  | { role: "user" | "assistant"; content: string };

export interface LlmRequest {
  model: string;
  system?: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  /** Force a specific tool call, e.g. for structured judgments. */
  forceTool?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  toolCalls: ToolCall[];
  model: string;
  responseId: string;
  /** Provider stop reason, e.g. "max_tokens" when the output was cut off. */
  stopReason?: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
  close?(): Promise<void>;
}

export type ModelRole = "pm" | "agent";
