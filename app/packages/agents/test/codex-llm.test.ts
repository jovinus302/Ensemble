import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { CodexLlmProvider, strictOutputSchema } from '../src/codex/llm.ts';
const request = { model: '', messages: [{ role: 'user' as const, content: 'check' }], forceTool: 'check', tools: [{ name: 'check', description: '', inputSchema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'number' }, optional: { type: 'string' } } } }] };
const provider = (mode = '', timeoutMs = 2000) => new CodexLlmProvider({ timeoutMs, rpc: { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/fake-pm-server.mjs', import.meta.url))], env: { ...process.env, PM_FIXTURE_MODE: mode } } });
describe('Codex PM structured judgments', () => {
 it('adds explicit types for const/enum discriminators used by real PM schemas', () => {
  expect(strictOutputSchema({ type: 'object', properties: { op: { oneOf: [{ const: 'stop' }, { enum: ['retry'] }] } } }))
    .toMatchObject({ required: ['op'], additionalProperties: false, properties: { op: { anyOf: [{ anyOf: [{ const: 'stop', type: 'string' }, { enum: ['retry'], type: 'string' }] }, { type: 'null' }] } } });
 });
 it('handles early completion, removes optional null and enforces read-only thread settings', async () => {
  const p = provider();
  try { expect((await p.complete(request)).toolCalls).toEqual([{ name: 'check', input: { value: 7 } }]); } finally { await p.close(); }
 });
 it('rejects schema-invalid data rather than treating it as a tool call', async () => {
  const p = provider('invalid');
  try { await expect(p.complete(request)).rejects.toMatchObject({ code: 'schema' }); } finally { await p.close(); }
 });
 it('times out an unresponsive process and cleans up', async () => {
  const p = provider('hang', 100);
  await expect(p.complete(request)).rejects.toMatchObject({ code: 'timeout' }); await p.close();
 });
 it('cancels in-flight calls and prevents new work after close', async () => {
  const p = provider('hang'); const a = new AbortController();
  const call = p.complete({ ...request, signal: a.signal });
  a.abort(); await expect(call).rejects.toMatchObject({ code: 'cancelled' });
  await p.close(); await expect(p.complete(request)).rejects.toMatchObject({ code: 'closed' });
 });
 it('classifies process failure without exposing raw diagnostics', async () => {
  const p = provider('crash');
  await expect(p.complete(request)).rejects.toMatchObject({ code: 'transport', message: 'Codex PM transport' }); await p.close();
 });
});
