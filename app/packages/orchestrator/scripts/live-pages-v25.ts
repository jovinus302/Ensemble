/**
 * Manual, paid model observation; never part of npm test.
 * From app/ (PowerShell):
 *   $env:ENSEMBLE_PM_RUNTIME='codex' # or api / claude; existing provider credentials apply
 *   npx.cmd tsx packages/orchestrator/scripts/live-pages-v25.ts --live
 * --help makes no provider call. Set ENSEMBLE_MODEL_PM to override the provider model.
 * Saves raw request/response and checkpoint measurements outside the repository under
 * ~/ensemble-agent-workspaces/live-pages-v25, including failure observations.
 * This isolated scene-03 observation supplies only seed + channel premises, never golden PM
 * output. It checks detection shape, not convergence or authority enforcement in the PM loop.
 * TODO(integration): run returned ops through A's work-context-apply.ts before treating the
 * measurement as accepted ledger state; do not equate raw model shape with validation success.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { project, workContextFacts, WORK_CONTEXT_TOOL, type LedgerEvent, type NewLedgerEvent } from '@ensemble/core';
import { loadEnv, modelFor, pmRuntimeFromEnv, type LlmResponse } from '@ensemble/llm';
import { PAGES_LINES, PAGES_NOW, pagesSeedEvents } from '@ensemble/scenarios';
import { WORK_CONTEXT_SYSTEM_PROMPT, workContextTool, workContextUserMessage } from '../src/work-context-prompt.ts';

if (!process.argv.includes('--live')) {
  console.log('Manual paid observation: ENSEMBLE_PM_RUNTIME=codex|api|claude npx tsx packages/orchestrator/scripts/live-pages-v25.ts --live');
  console.log('Reports: ~/ensemble-agent-workspaces/live-pages-v25; no model called without --live.');
} else {
  loadEnv();
  const { runtime, llm } = pmRuntimeFromEnv();
  const context = { projectId: 'live-pages-v25', targetProductId: 'pages' };
  const seed: NewLedgerEvent[] = pagesSeedEvents(context);
  const lines = PAGES_LINES.slice(0, 5);
  for (const line of lines) seed.push({ ...context, actor: { kind: 'system', id: 'scenario' }, type: 'message_recorded',
    payload: { messageId: line.messageId, authorId: line.as, text: line.text, attachmentIds: [] } });
  const events: LedgerEvent[] = seed.map((event, i) => ({ ...event, id: `live:${i}`, seq: i + 1, at: event.at ?? PAGES_NOW.toISOString() }));
  const facts = workContextFacts(project(events), { kind: 'message', messageId: lines.at(-1)!.messageId })!;
  const request = { model: modelFor('pm'), system: WORK_CONTEXT_SYSTEM_PROMPT, messages: [{ role: 'user' as const, content: workContextUserMessage(facts) }], tools: [workContextTool()], forceTool: WORK_CONTEXT_TOOL, maxTokens: 8192 };
  const directory = join(homedir(), 'ensemble-agent-workspaces', 'live-pages-v25');
  await mkdir(directory, { recursive: true });
  const reportPath = join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  let response: LlmResponse | undefined, error: string | undefined;
  let measurement: Record<string, unknown> = { shapePassed: false, ledgerValidation: 'not run: pending workstream A integration' };
  try {
    response = await llm.complete(request);
    if (response.toolCalls.length !== 1 || response.toolCalls[0]?.name !== WORK_CONTEXT_TOOL) throw new Error('Expected one update_work_context tool call');
    const output = response.toolCalls[0].input;
    if (!Array.isArray(output.ops) || !Array.isArray(output.speech) || output.speech.length > 2 || typeof output.reason !== 'string') throw new Error('Invalid tool output envelope');
    const ops = output.ops;
    const counts = Object.fromEntries(['conflict', 'violation', 'undecided', 'missing'].map(status => [status,
      ops.filter((op: unknown) => !!op && typeof op === 'object' && 'type' in op && op.type === 'upsert_item' && 'item' in op && !!op.item && typeof op.item === 'object' && 'status' in op.item && op.item.status === status).length]));
    measurement = { ...measurement, counts, shapePassed: Object.values(counts).every(count => count >= 1) };
    if (!measurement.shapePassed) throw new Error('Scene 03 detection shape failed: expected all four detection kinds');
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    process.exitCode = 1;
  } finally {
    await writeFile(reportPath, JSON.stringify({ runtime, request, response, measurement, error }, null, 2), 'utf8');
    await llm.close?.();
    console.log(JSON.stringify({ reportPath, measurement, error }, null, 2));
  }
}
