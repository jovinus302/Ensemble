import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { project, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest, LlmResponse } from '@ensemble/llm';
import { MemoryLedgerStore } from '@ensemble/store';
// @ensemble/orchestrator의 index는 두 값을 내보내지 않아 상대 경로로 가져온다.
import { interpretationTool } from '../packages/orchestrator/src/coordination.ts';
import { PM_SYSTEM_PROMPT } from '../packages/orchestrator/src/pm-prompt.ts';
import { compressSchema, estimateArgvChars, expandRefs, MeteredLlm, type MeteredUsage } from '../dogfood/pm-adapter.ts';

const WIN_LIMIT = 32_767;

test('compressSchema: 반복 하위 스키마를 $defs/$ref로 옮기고, 풀면 원본과 deepEqual', () => {
  const big = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'ids'],
    properties: {
      kind: { type: 'string', enum: ['alpha', 'beta', 'gamma'], description: '종류를 고른다. '.repeat(10) },
      ids: { type: 'array', minItems: 1, items: { type: 'string', enum: Array.from({ length: 30 }, (_, i) => `id-${i.toString().padStart(4, '0')}`) } },
    },
  };
  const small = { type: 'string', enum: ['a', 'b'] };
  const original = {
    type: 'object',
    required: ['first', 'second', 'list', 'tiny1', 'tiny2'],
    properties: {
      first: big,
      second: structuredClone(big),
      list: { type: 'array', items: { oneOf: [structuredClone(big), { type: 'null' }] } },
      tiny1: small,
      tiny2: structuredClone(small),
    },
  };
  const { schema, defs } = compressSchema(original);
  assert.ok(defs >= 1, '반복되는 큰 스키마가 있으면 $defs가 생긴다');
  const text = JSON.stringify(schema);
  assert.ok(text.length < JSON.stringify(original).length / 2, '크기가 크게 줄어든다');
  assert.ok(text.includes('"$ref":"#/$defs/d0"'));
  // 200자 미만 조각은 옮기지 않는다.
  assert.deepEqual((schema.properties as Record<string, unknown>).tiny1, small);
  assert.deepEqual(expandRefs(schema), original);
  // 원본은 바뀌지 않는다.
  assert.equal((original.properties.first as unknown), big);
  assert.equal('$defs' in original, false);
});

test('compressSchema: 이미 있는 $defs는 병합하고, 반복이 없으면 그대로 둔다', () => {
  const repeated = { type: 'array', items: { type: 'string', enum: Array.from({ length: 40 }, (_, i) => `value-${i}`) } };
  const withDefs = { type: 'object', $defs: { d0: { type: 'string' } }, properties: { a: repeated, b: structuredClone(repeated), c: { $ref: '#/$defs/d0' } } };
  const { schema, defs } = compressSchema(withDefs);
  assert.equal(defs, 1);
  const merged = schema.$defs as Record<string, unknown>;
  assert.deepEqual(merged.d0, { type: 'string' });
  assert.ok('d1' in merged, '기존 d0와 겹치지 않는 이름을 쓴다');
  assert.deepEqual(expandRefs(schema), expandRefs(withDefs));

  const flat = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } };
  const none = compressSchema(flat);
  assert.equal(none.defs, 0);
  assert.deepEqual(none.schema, flat);
});

async function manyMessagesState(messages: number, tasks: number) {
  const store = new MemoryLedgerStore();
  const context = { projectId: 'p-argv', targetProductId: 'product' };
  const owner = { kind: 'human' as const, id: 'owner' };
  const designer = { kind: 'human' as const, id: 'designer' };
  const events: NewLedgerEvent[] = [
    { ...context, actor: owner, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...context, actor: designer, type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: '디자이너' } },
    { ...context, actor: { kind: 'system', id: 'research-agent' }, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' } },
    { ...context, actor: owner, type: 'goal_set', payload: { text: '회의록 검색 도구', decider: 'owner', delegation: { pmMayApply: [] } } },
    {
      ...context, actor: owner, type: 'plan_committed',
      payload: {
        version: 1, basedOn: null, reason: 'ok', approvedBy: 'owner', sourceMessageIds: [],
        tasks: Array.from({ length: tasks }, (_, i) => ({ id: `task-${randomUUID()}`, title: `작업 ${i}`, assignee: 'research-agent', dependsOn: [], handoffConditions: [`조건 ${i}`] })),
      },
    },
    ...Array.from({ length: messages }, (_, i): NewLedgerEvent => ({
      ...context, actor: i % 2 ? owner : designer, type: 'message_recorded',
      payload: { messageId: `msg-${randomUUID()}`, authorId: i % 2 ? 'owner' : 'designer', text: `메시지 ${i}`, attachmentIds: [] },
    })),
  ];
  await store.append(events);
  const state = project(await store.read({ projectId: context.projectId }));
  store.close();
  return state;
}

test('argv 추정: 사람 메시지 60개·작업 30개에서 압축 전에는 한도를 넘고 압축 뒤에는 30,000자 미만', async () => {
  const state = await manyMessagesState(60, 30);
  const tool = interpretationTool(state);
  const request: LlmRequest = {
    model: 'pm', system: PM_SYSTEM_PROMPT, forceTool: tool.name, tools: [tool],
    messages: [{ role: 'user', content: JSON.stringify({ facts: {} }) }],
  };
  const before = estimateArgvChars(request);
  const compressed = compressSchema(tool.inputSchema);
  const after = estimateArgvChars({ ...request, tools: [{ ...tool, inputSchema: compressed.schema }] });
  console.log(`argv 추정: 압축 전 ${before}자, 압축 뒤 ${after}자(defs ${compressed.defs}개)`);
  assert.ok(before > WIN_LIMIT, `압축 전 ${before}자는 Windows 한도(${WIN_LIMIT}자)를 넘어야 한다`);
  assert.ok(after < 30_000, `압축 뒤 ${after}자는 30,000자 미만이어야 한다`);
  assert.deepEqual(expandRefs(compressed.schema), tool.inputSchema, '압축 스키마는 원본과 의미가 같다');
});

test('estimateArgvChars: Windows 인용 규칙(따옴표·백슬래시)을 반영한다', () => {
  const plain: LlmRequest = { model: 'pm', system: 'abc', messages: [] };
  const quoted: LlmRequest = { model: 'pm', system: 'a"b\\', messages: [] };
  // 'a"b\' -> "a\"b\\" : 따옴표 앞뒤 인용 2 + 이스케이프 1 + 끝 백슬래시 두 배(+1)
  assert.equal(estimateArgvChars(quoted) - estimateArgvChars(plain), 3);
  const withSchema: LlmRequest = { model: 'pm', system: 'abc', forceTool: 't', tools: [{ name: 't', description: '', inputSchema: { type: 'object' } }], messages: [] };
  assert.ok(estimateArgvChars(withSchema) > estimateArgvChars(plain));
});

class FakeInner implements LlmProvider {
  calls: LlmRequest[] = [];
  closed = false;
  constructor(private readonly mode: 'ok' | 'fail' = 'ok') {}
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    if (this.mode === 'fail') throw new Error('모델 실패');
    return { text: 'x', toolCalls: [], model: 'fake-model', responseId: 'r', usage: { inputTokens: 11, outputTokens: 7 } };
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function bigRequest(n: number): LlmRequest {
  const ids = Array.from({ length: n }, (_, i) => `msg-${randomUUID()}-${i}`);
  const sourceMessageIds = { type: 'array', minItems: 1, items: { type: 'string', enum: ids } };
  const tool = { name: 'interpret', description: 'd', inputSchema: { type: 'object', properties: { a: sourceMessageIds, b: structuredClone(sourceMessageIds), c: structuredClone(sourceMessageIds) } } };
  return { model: 'pm', system: 's', forceTool: 'interpret', tools: [tool], messages: [{ role: 'user', content: '{}' }] };
}

test('MeteredLlm: 한도를 넘으면 onOverflow를 부르고 throw하며 inner를 부르지 않는다', async () => {
  const inner = new FakeInner();
  const overflow: { chars: number; tool?: string }[] = [];
  const usage: MeteredUsage[] = [];
  const llm = new MeteredLlm(inner, { schemaRef: false, argvLimit: 1000, onOverflow: (i) => overflow.push(i), onUsage: (u) => usage.push(u) });
  await assert.rejects(llm.complete(bigRequest(40)), /argv 한도 초과/);
  assert.equal(overflow.length, 1);
  assert.ok(overflow[0]!.chars > 1000);
  assert.equal(overflow[0]!.tool, 'interpret');
  assert.equal(inner.calls.length, 0);
  assert.equal(usage.length, 0);
});

test('MeteredLlm: schemaRef이면 압축한 사본을 inner에 보내고 usage를 기록한다', async () => {
  const inner = new FakeInner();
  const usage: MeteredUsage[] = [];
  const llm = new MeteredLlm(inner, { schemaRef: true, argvLimit: Number.POSITIVE_INFINITY, onOverflow: () => assert.fail('overflow 아님'), onUsage: (u) => usage.push(u) });
  const request = bigRequest(40);
  const response = await llm.complete(request);
  assert.equal(response.usage.inputTokens, 11);
  assert.equal(inner.calls.length, 1);
  const sent = inner.calls[0]!.tools![0]!;
  assert.ok(JSON.stringify(sent.inputSchema).includes('$ref'));
  assert.deepEqual(expandRefs(sent.inputSchema), request.tools![0]!.inputSchema);
  // 원래 요청 객체는 바뀌지 않는다.
  assert.ok(!JSON.stringify(request.tools![0]!.inputSchema).includes('$ref'));
  assert.equal(usage.length, 1);
  assert.deepEqual([usage[0]!.ok, usage[0]!.inputTokens, usage[0]!.outputTokens, usage[0]!.model], [true, 11, 7, 'fake-model']);
  await llm.close();
  assert.equal(inner.closed, true);
});

test('MeteredLlm: inner가 실패하면 ok:false로 보고한 뒤 다시 던진다', async () => {
  const usage: MeteredUsage[] = [];
  const llm = new MeteredLlm(new FakeInner('fail'), { schemaRef: false, argvLimit: Number.POSITIVE_INFINITY, onOverflow: () => undefined, onUsage: (u) => usage.push(u) });
  await assert.rejects(llm.complete({ model: 'pm', messages: [] }), /모델 실패/);
  assert.equal(usage.length, 1);
  assert.equal(usage[0]!.ok, false);
  assert.match(usage[0]!.error ?? '', /모델 실패/);
});
