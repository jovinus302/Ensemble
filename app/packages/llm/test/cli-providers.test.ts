import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCliProvider } from '../src/claude-cli.ts';
import { CodexCliProvider } from '../src/codex-cli.ts';
import { dropStrictNulls, strictSchema } from '../src/cli.ts';
import { AnthropicProvider } from '../src/anthropic.ts';
import { pmRuntimeFromEnv } from '../src/runtime.ts';
import type { LlmRequest } from '../src/types.ts';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const routeSchema = { type: 'object', required: ['kind'], properties: { kind: { enum: ['chat', 'result'] }, taskId: { type: 'string' } } };
const request: LlmRequest = { model: 'ignored-by-cli', system: '메시지를 분류하세요.', forceTool: 'route_message',
  tools: [{ name: 'route_message', description: '경로 선택', inputSchema: routeSchema }], messages: [{ role: 'user', content: '{"text":"안녕하세요"}' }] };

function setup(kind: 'codex' | 'claude', modes: string, outputs: unknown[] = [{ kind: 'chat' }], timeoutMs = 10_000) {
  const dir = mkdtempSync(join(tmpdir(), 'ensemble-pm-cli-'));
  dirs.push(dir);
  const record = join(dir, 'record.jsonl');
  const env = { ...process.env, FAKE_CLI_MODES: modes, FAKE_CLI_STATE: join(dir, 'state'), FAKE_CLI_RECORD: record, FAKE_CLI_OUTPUTS: JSON.stringify(outputs) };
  const options = { executable: process.execPath, executableArgs: [fixture(kind === 'codex' ? 'fake-codex-exec.mjs' : 'fake-claude-print.mjs')], model: 'cheap', effort: 'low', env, timeoutMs, cwd: dir };
  const llm = kind === 'codex' ? new CodexCliProvider(options) : new ClaudeCliProvider(options);
  const calls = () => readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { args: string[]; input: string });
  return { llm, calls };
}

describe.each(['codex', 'claude'] as const)('%s CLI provider', kind => {
  it('cancels a live call without waiting for the model timeout', async () => {
    const f = setup(kind, 'hang');
    const controller = new AbortController();
    const pending = f.llm.complete({ ...request, signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow(/cancelled/);
    setTimeout(() => controller.abort(), 150);
    await assertion;
  });
  it('returns the forced tool call from structured output', async () => {
    const f = setup(kind, 'normal');
    const response = await f.llm.complete(request);
    expect(response.toolCalls).toEqual([{ name: 'route_message', input: { kind: 'chat' } }]);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    const [call] = f.calls();
    expect(call!.input).toContain('안녕하세요');
    expect(call!.args).toEqual(expect.arrayContaining(kind === 'codex'
      ? ['exec', '--sandbox', 'read-only', '--ephemeral', '-m', 'cheap', 'model_reasoning_effort="low"', '--output-schema']
      : ['-p', '--output-format', 'json', '--tools', '', '--setting-sources', '', '--model', 'cheap', '--effort', 'low', '--json-schema']));
    // Codex has no system prompt flag; Claude keeps it out of the user turn.
    if (kind === 'codex') expect(call!.input).toContain('메시지를 분류하세요.');
    else { expect(call!.input).not.toContain('메시지를 분류하세요.'); expect(call!.args[call!.args.indexOf('--system-prompt') + 1]).toBe('메시지를 분류하세요.'); }
  });

  it('returns plain text when no tool is forced', async () => {
    const f = setup(kind, 'normal', ['서울']);
    const response = await f.llm.complete({ model: 'x', messages: [{ role: 'user', content: '한국의 수도는?' }] });
    expect(response.text).toBe('서울');
    expect(response.toolCalls).toEqual([]);
    expect(f.calls()[0]!.args).not.toContain(kind === 'codex' ? '--output-schema' : '--json-schema');
  });

  it('treats stderr warnings as non-fatal', async () => {
    const f = setup(kind, 'warn');
    expect((await f.llm.complete(request)).toolCalls[0]!.input).toEqual({ kind: 'chat' });
  });

  it('rejects output that is not a JSON object', async () => {
    const f = setup(kind, 'invalid');
    await expect(f.llm.complete(request)).rejects.toThrow(/JSON/);
  });

  it('rejects a failed run with its reason', async () => {
    const f = setup(kind, 'fail');
    await expect(f.llm.complete(request)).rejects.toThrow(kind === 'codex' ? /model unavailable/ : /not logged in/);
  });

  it('kills a run that exceeds the time limit', async () => {
    const f = setup(kind, 'hang', undefined, 500);
    await expect(f.llm.complete(request)).rejects.toThrow(/초 안에 끝나지 않았습니다/);
  });
});

it('claude close cancels pending PM work and rejects later calls', async () => {
  const f = setup('claude', 'hang');
  const pending = f.llm.complete(request);
  const assertion = expect(pending).rejects.toThrow(/cancelled/);
  await (f.llm as ClaudeCliProvider).close();
  await assertion;
  await expect(f.llm.complete(request)).rejects.toThrow(/closed/);
});

it('claude: a result record with is_error is a failure even with a success subtype', async () => {
  await expect(setup('claude', 'is_error').llm.complete(request)).rejects.toThrow(/529 overloaded/);
});

it('codex: optional fields omitted as null under the strict schema are dropped', async () => {
  const f = setup('codex', 'normal', [{ kind: 'result', taskId: null }]);
  expect((await f.llm.complete(request)).toolCalls[0]!.input).toEqual({ kind: 'result' });
});

it('strictSchema closes objects, requires every property and keeps declared nulls', () => {
  const schema = { type: 'object', required: ['ops', 'id'], properties: {
    id: { type: ['string', 'null'] }, note: { type: 'string', minLength: 1 },
    ops: { type: 'array', minItems: 1, items: { oneOf: [
      { type: 'object', required: ['op', 'taskId'], properties: { op: { const: 'handoff_early' }, taskId: { enum: ['a', 'b'] } } },
      { type: 'object', required: ['op'], properties: { op: { const: 'set_deadline' }, date: { type: 'string', format: 'date' } } },
    ] } } } };
  const strict = strictSchema(schema) as any;
  expect(strict.additionalProperties).toBe(false);
  expect(strict.required).toEqual(['id', 'note', 'ops']);
  expect(strict.properties.note).toEqual({ type: ['string', 'null'], description: '(minLength=1)' });
  expect(strict.properties.ops.items.anyOf[1].properties.date.type).toEqual(['string', 'null']);
  expect(strict.properties.ops.items.oneOf).toBeUndefined();
  expect(dropStrictNulls({ id: null, note: null, ops: [{ op: 'set_deadline', date: null }, { op: 'handoff_early', taskId: 'a' }] }, schema))
    .toEqual({ id: null, ops: [{ op: 'set_deadline' }, { op: 'handoff_early', taskId: 'a' }] });
});

it('pmRuntimeFromEnv defaults to the API and selects the CLI runtimes', () => {
  expect(pmRuntimeFromEnv({ ANTHROPIC_API_KEY: 'test' }).llm).toBeInstanceOf(AnthropicProvider);
  expect(pmRuntimeFromEnv({ ENSEMBLE_PM_RUNTIME: 'codex' }).llm).toBeInstanceOf(CodexCliProvider);
  expect(pmRuntimeFromEnv({ ENSEMBLE_PM_RUNTIME: 'claude', ENSEMBLE_MODEL_PM: 'haiku' }).runtime).toBe('claude');
  expect(() => pmRuntimeFromEnv({ ENSEMBLE_PM_RUNTIME: 'gpt' })).toThrow(/api, codex, or claude/);
  expect(() => pmRuntimeFromEnv({ ENSEMBLE_PM_RUNTIME: 'claude', ENSEMBLE_PM_TIMEOUT_MINUTES: '0' })).toThrow(/positive/);
});
