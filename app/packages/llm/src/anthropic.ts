import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmRequest, LlmResponse, ToolCall } from "./types.ts";

/** Anthropic Messages API. Reads ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY (the proxy) by default. */
export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 2048,
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages,
      ...(request.tools
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
      ...(request.forceTool ? { tool_choice: { type: "tool" as const, name: request.forceTool } } : {}),
    });

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({ name: block.name, input: block.input as Record<string, unknown> });
      }
    }

    return {
      text,
      toolCalls,
      model: response.model,
      responseId: response.id,
      ...(response.stop_reason ? { stopReason: response.stop_reason } : {}),
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}
