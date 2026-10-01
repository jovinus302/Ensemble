import { CodexLlmProvider } from '@ensemble/agents';
const provider = new CodexLlmProvider({ timeoutMs: 90_000, onTiming: t => console.log(JSON.stringify(t)) });
try {
  const response = await provider.complete({ model: process.env.ENSEMBLE_MODEL_PM ?? '', system: 'Return only the requested structured response. Do not use tools.', messages: [{ role: 'user', content: 'Return status ready and value 7.' }], forceTool: 'check', tools: [{ name: 'check', description: 'Connection check', inputSchema: { type: 'object', additionalProperties: false, required: ['status', 'value'], properties: { status: { enum: ['ready'] }, value: { type: 'number' } } } }] });
  console.log(JSON.stringify(response));
  if (response.toolCalls[0]?.input.value !== 7) throw new Error('Unexpected live PM result');
} finally { await provider.close(); }
