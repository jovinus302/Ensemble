// Live check against the proxy: a Korean prompt and a forced tool call.
// Usage: npm run smoke:llm  (reads the repo-root .env)
import { AnthropicProvider, loadEnv, modelFor } from "../src/index.ts";

const envFile = loadEnv();
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set (looked for .env from the current directory upward).");
  process.exit(1);
}
console.log(`env: ${envFile ?? "(process env only)"}  base: ${process.env.ANTHROPIC_BASE_URL ?? "(default)"}`);

const llm = new AnthropicProvider();
const model = modelFor("pm");

const text = await llm.complete({
  model,
  maxTokens: 50,
  messages: [{ role: "user", content: "한 단어로만 답해: 한국의 수도는?" }],
});
console.log(`text   [${text.model}] ${text.text.trim()}  (${text.responseId})`);
if (!text.text.trim()) {
  console.error("empty text response");
  process.exit(1);
}

const tool = await llm.complete({
  model,
  maxTokens: 300,
  forceTool: "report_result",
  tools: [
    {
      name: "report_result",
      description: "작업 결과를 보고한다",
      inputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  ],
  messages: [{ role: "user", content: "경쟁사 조사를 끝냈다고 한 문장으로 보고해." }],
});
const call = tool.toolCalls[0];
if (!call || call.name !== "report_result") {
  console.error("tool call missing", tool);
  process.exit(1);
}
console.log(`tool   [${tool.model}] ${call.name} ${JSON.stringify(call.input)}`);
console.log("smoke:llm OK");
