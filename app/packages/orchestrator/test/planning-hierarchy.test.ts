import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, type AnyEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import type { SessionConnector, TaskInstructionsInput } from '@ensemble/agents';
import { ProjectManager } from '../src/pm.ts';
import { MAX_SUBTASKS } from '../src/planning.ts';

// MC1 §3 B2: a first plan may hold subtasks; its work metadata is recorded with the commit.
const context = { projectId: 'planning-hierarchy', targetProductId: 'product' };
const members = [
  { memberId: 'owner', kind: 'human' as const, displayName: 'Owner' },
  { memberId: 'designer', kind: 'human' as const, displayName: 'Designer' },
  { memberId: 'research-agent', kind: 'agent' as const, displayName: 'Research', role: 'research' },
  { memberId: 'prototype-agent', kind: 'agent' as const, displayName: 'Builder', role: 'build' },
];
const sub = (title: string) => ({ title, handoffConditions: [`${title} 표`], hours: { min: 1, max: 2 } });
const draft = (subtasks: Record<string, unknown[]> = {}) => ({ tasks: ['research', 'interview', 'flow', 'prototype'].map(templateKey => ({
  templateKey, title: `${templateKey} 작업`, handoffConditions: ['결과물'], hours: { min: 2, max: 4 }, ...(subtasks[templateKey] ? { subtasks: subtasks[templateKey] } : {}),
})) });
function provider(replies: unknown[]) {
  const calls: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request) {
    calls.push(request);
    return { text: '', model: 'fake', responseId: 'fake', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: replies.shift() as Record<string, unknown> }] };
  } };
  return { calls, llm };
}
async function setup(replies: unknown[]) {
  const store = new MemoryLedgerStore();
  await store.append([
    ...members.map(payload => ({ ...context, actor: { kind: 'system' as const, id: 'seed' }, type: 'member_joined', payload })),
    { ...context, actor: { kind: 'human', id: 'owner' }, type: 'goal_set', payload: { text: 'Seed', decider: 'owner', delegation: { pmMayApply: [] } } },
  ]);
  const starts: TaskInstructionsInput[] = [];
  const connector: SessionConnector = {
    async startSession(id) { return { threadId: id, workspace: '/fake' }; },
    async startTask(_id, input) { starts.push(input); return `turn-${starts.length}`; },
    async sendUpdate() { return { sent: false, reason: 'No active turn' }; }, onEvent() { return () => {}; }, async stop() {},
  };
  const fake = provider(replies);
  const pm = new ProjectManager({ ...context, store, connector, llm: fake.llm, model: 'fake' });
  return { store, starts, pm, ...fake };
}

it('(4) commits subtasks under their template task with metadata for every task in the same commit', async () => {
  const f = await setup([draft({ research: [sub('경쟁사 조사'), sub('유사 사례 조사')] })]);
  const { proposal } = await f.pm.startFreeProject('예약 서비스 시제품');
  if (!proposal) throw new Error('expected a proposal');
  expect(proposal.tasks.map(t => [t.id, t.parentId, t.assignee, t.dependsOn])).toEqual([
    ['research', undefined, 'research-agent', []],
    ['research-1', 'research', 'research-agent', []],
    ['research-2', 'research', 'research-agent', []],
    ['interview', undefined, 'owner', []],
    ['flow', undefined, 'designer', ['research', 'interview']],
    ['prototype', undefined, 'prototype-agent', ['flow']],
  ]);
  expect(proposal.estimates.map(e => e.taskId)).toContain('research-2');
  await f.pm.decideCard(proposal.proposalId, 'owner', true);
  const events = await f.store.read() as AnyEvent[];
  const committed = events.find(e => e.type === 'plan_committed')!;
  const metas = events.filter((e): e is Extract<AnyEvent, { type: 'task_meta_set' }> => e.type === 'task_meta_set');
  expect(metas.map(e => e.payload.taskId)).toEqual(proposal.tasks.map(t => t.id));
  // Same transaction: nothing but the commit's own estimates sits between the plan and its metadata.
  const between = events.filter(e => e.seq > committed.seq && e.seq < metas.at(-1)!.seq).map(e => e.type);
  expect(new Set(between)).toEqual(new Set(['estimate_updated', 'task_meta_set']));
  const research1 = metas.find(e => e.payload.taskId === 'research-1')!.payload;
  expect(research1).toMatchObject({ priority: 'normal', routing: { executor: 'agent', reason: 'agent_capable' }, origin: { createdBy: 'pm', planVersion: 1, sourceMessageIds: [] } });
  expect(research1.brief!.why).toContain('research 작업');
  expect(metas.find(e => e.payload.taskId === 'interview')!.payload.routing).toMatchObject({ executor: 'human', reason: 'needs_human_judgement' });

  // The parent never runs; its first subtask starts with the goal chain and brief in the input.
  const state = project(events);
  expect(state.tasks.get('research')!.status).toBe('waiting');
  expect(f.starts.map(s => s.taskId)).toEqual(['research-1']);
  const texts = f.starts[0]!.inputs.map(i => i.text);
  expect(texts[0]).toBe('[목표 사슬] 목표: 예약 서비스 시제품 → 상위 작업: research 작업 → 이 작업: 경쟁사 조사');
  expect(texts[1]).toContain('[맥락] 이 작업이 필요한 이유:');
  await f.pm.stop();
});

it('keeps a plan without subtasks exactly four tasks, each with its metadata', async () => {
  const f = await setup([draft()]);
  const { proposal } = await f.pm.startFreeProject('예약 서비스 시제품');
  expect(proposal!.tasks.map(t => t.id)).toEqual(['research', 'interview', 'flow', 'prototype']);
  await f.pm.decideCard(proposal!.proposalId, 'owner', true);
  const state = project(await f.store.read());
  expect([...state.tasks.values()].map(t => [t.spec.id, t.meta?.routing?.executor])).toEqual([['research', 'agent'], ['interview', 'human'], ['flow', 'human'], ['prototype', 'agent']]);
  expect(f.starts[0]!.inputs[0]!.text).toBe('[목표 사슬] 목표: 예약 서비스 시제품 → 이 작업: research 작업');
  await f.pm.stop();
});

it('sends too many or malformed subtasks back to the model', async () => {
  const tooMany = draft({ flow: Array.from({ length: MAX_SUBTASKS + 1 }, (_, i) => sub(`화면 ${i + 1}`)) });
  const f = await setup([tooMany, draft({ flow: [{ title: '화면', hours: { min: 1, max: 2 } }] }), draft({ flow: [sub('가입 화면'), sub('예약 화면')] })]);
  const { proposal } = await f.pm.startFreeProject('예약 서비스 시제품');
  // Two attempts: the first and second drafts are rejected, so drafting fails rather than inventing structure.
  expect(proposal).toBeUndefined();
  expect(JSON.parse(f.calls[1]!.messages[0]!.content).validationError).toContain(`at most ${MAX_SUBTASKS}`);
  expect((f.calls[0]!.tools![0]!.inputSchema as any).properties.tasks.items.properties.subtasks.maxItems).toBe(MAX_SUBTASKS);
  await f.pm.stop();
});
