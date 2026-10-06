// Real-model evidence: PENDING. Coordinator accepted authored offline contract examples
// for this dispatch; these are not recorded model responses or proof of model behavior.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { workContextFacts, project, type WorkContextOpType } from '@ensemble/core';
import { strictSchema, dropStrictNulls } from '@ensemble/llm';
import { workContextTool, workContextUserMessage } from '../packages/orchestrator/src/work-context-prompt.ts';
import { pagesEvents } from './pages-v25-fixture.ts';

type Schema = { type?: string; const?: unknown; enum?: unknown[]; oneOf?: Schema[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema; maxItems?: number; minLength?: number };
// Local schema check while workstream A's stateful validator is developed in parallel.
// TODO(integration): ALSO replay fixtures through work-context-apply.ts with the matching
// pre-op ledger state. Schema validity is not evidence of human authority or reference validity.
function valid(value: unknown, schema: Schema): boolean {
  if (schema.oneOf) return schema.oneOf.filter(s => valid(value, s)).length === 1;
  if ('const' in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0);
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'array') return Array.isArray(value) && value.length <= (schema.maxItems ?? Infinity) && value.every(v => valid(v, schema.items!));
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (schema.required ?? []).every(k => k in record) && Object.entries(record).every(([k, v]) => schema.properties?.[k] ? valid(v, schema.properties[k]) : schema.additionalProperties !== false);
  }
  return true;
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/pages-v25-model-contract.json', import.meta.url), 'utf8')) as {
  outputs: { ops: { type: WorkContextOpType }[]; speech: unknown[]; reason: string }[]; cards: unknown[];
};
const schema = workContextTool().inputSchema as Schema;

test('Pages model contract examples cover every operation and card, including complete previews', () => {
  assert.equal(new Set(fixture.outputs.flatMap(o => o.ops.map(op => op.type))).size, 13);
  for (const output of fixture.outputs) assert.ok(valid(output, schema), JSON.stringify(output));
  for (const card of fixture.cards) assert.ok(valid({ ops: [], speech: [{ text: '확인했습니다.', kind: 'fact', card }], reason: '기록 근거' }, schema));
  // The Codex adapter must preserve discriminators while normalizing omitted optional fields.
  assert.doesNotThrow(() => strictSchema(workContextTool().inputSchema));
  for (const output of fixture.outputs) assert.deepEqual(dropStrictNulls(output, workContextTool().inputSchema), output);
  const nullableCard = { ops: [], speech: [{ text: '확인', kind: 'fact', card: null }], reason: '' };
  assert.deepEqual(dropStrictNulls(nullableCard, workContextTool().inputSchema), { ...nullableCard, speech: [{ text: '확인', kind: 'fact' }] });
});

test('Pages model schema rejects incomplete, unknown, and fabricated integration output', () => {
  for (const output of fixture.outputs) {
    const operation = output.ops[0]!;
    const variant = schema.properties!.ops!.items!.oneOf!.find(s => s.properties!.type!.const === operation.type)!;
    for (const key of variant.required!) {
      const incomplete = { ...operation } as Record<string, unknown>;
      delete incomplete[key];
      assert.equal(valid({ ...output, ops: [incomplete] }, schema), false, `${operation.type}.${key}`);
    }
  }
  for (const ops of [[{ type: 'build_produced' }], [{ type: 'upsert_item', item: { status: 'approved' } }], [{ type: 'handoff_tools', handoffs: [{ handoffId: 'h', toolId: 'unlinked', itemIds: [], title: '', round: 1 }] }]]) {
    assert.equal(valid({ ops, speech: [], reason: '' }, schema), false);
  }
  assert.equal(valid({ ops: [], speech: Array(3).fill({ text: '', kind: 'fact' }), reason: '' }, schema), false);
  const proposal = fixture.outputs.find(o => o.ops[0]?.type === 'generate_proposal')!;
  const full = proposal.ops[0] as unknown as { preview: { source: string; spec: Record<string, unknown> } };
  for (const preview of [{ ...full.preview, spec: { primaryAction: '변경' } }, { ...full.preview, source: 'build' }]) {
    assert.equal(valid({ ...proposal, ops: [{ ...proposal.ops[0], preview }] }, schema), false, 'partial specs and PM-created build previews are rejected');
  }
  assert.equal(valid({ ops: [], speech: [{ text: '', kind: 'fact', card: { kind: 'build', proposalId: 'wrong-reference' } }], reason: '' }, schema), false);
  assert.ok(valid({ ops: [], speech: [], reason: '침묵' }, schema));
});

test('Pages facts preserve human evidence, PM speech and source preview without changing their shape', () => {
  const state = project(pagesEvents('s04_preview_a'));
  const last = state.messages.at(-1)!;
  const facts = workContextFacts(state, { kind: 'message', messageId: last.messageId })!;
  assert.ok(facts.members.some(m => m.memberId === facts.decider && m.kind === 'human'));
  assert.ok(facts.messages.some(m => m.authorId === 'pm'));
  assert.ok(facts.basePreview?.spec.hero);
  assert.deepEqual(JSON.parse(workContextUserMessage(facts)).facts, facts);
});
