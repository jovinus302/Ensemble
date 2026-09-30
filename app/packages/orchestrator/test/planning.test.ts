import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, type AnyEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import type { SessionConnector, TaskInstructionsInput } from '@ensemble/agents';
import { ProjectManager } from '../src/pm.ts';
import type { PlanningMember } from '../src/planning.ts';

const context = { projectId: 'planning', targetProductId: 'product' };
const members = [
  { memberId: 'owner', kind: 'human' as const, displayName: 'Owner', weeklyHours: 10 },
  { memberId: 'designer', kind: 'human' as const, displayName: 'Designer' },
  { memberId: 'research-agent', kind: 'agent' as const, displayName: 'Research', role: 'research' },
  { memberId: 'prototype-agent', kind: 'agent' as const, displayName: 'Builder', role: 'build' },
];
const draft = () => ({ tasks: ['research', 'interview', 'flow', 'prototype'].map(templateKey => ({
  templateKey, title: `Arbitrary title for ${templateKey}`, handoffConditions: ['Concrete artifact'], hours: { min: 2, max: 4 },
})) });
const CUT_OFF = Symbol('max_tokens');
function provider(replies: unknown[]) {
  const calls: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(request) {
    calls.push(request);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    // A response cut off at the output limit carries a tool call with an empty input.
    if (reply === CUT_OFF) return { text: '', model: 'fake', responseId: 'fake', stopReason: 'max_tokens', usage: { inputTokens: 0, outputTokens: 2048 }, toolCalls: [{ name: request.forceTool!, input: {} }] };
    return { text: '', model: 'fake', responseId: 'fake', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input: reply as Record<string, unknown> }] };
  } };
  return { calls, llm };
}
async function setup(replies: unknown[] = [draft()], team: PlanningMember[] = members, decider = 'owner') {
  const store = new MemoryLedgerStore();
  await store.append([
    ...team.map(payload => ({ ...context, actor: { kind: 'system' as const, id: 'seed' }, type: 'member_joined', payload })),
    { ...context, actor: { kind: 'human', id: 'owner' }, type: 'goal_set', payload: { text: 'Seed', decider, delegation: { pmMayApply: [] } } },
  ]);
  const starts: TaskInstructionsInput[] = [];
  const connector: SessionConnector = {
    async startSession(id) { return { threadId: id, workspace: '/fake' }; },
    async startTask(_id, input) { starts.push(input); return 'turn'; },
    async sendUpdate() { return { sent: false, reason: 'No active turn' }; }, onEvent() { return () => {}; }, async stop() {},
  };
  const fake = provider(replies);
  const pm = new ProjectManager({ ...context, store, connector, llm: fake.llm, model: 'fake' });
  return { store, starts, pm, ...fake };
}

it('draft → decider approval commits v1/estimates and starts only ready tasks once', async () => {
  const f = await setup();
  await f.pm.setAvailability('owner', 7);
  const { proposal } = await f.pm.startFreeProject('Ship a prototype', '2026-10-14');
  if (!proposal) throw new Error('expected a proposal');
  expect(project(await f.store.read()).pendingPlans.get(proposal.proposalId)).toEqual(proposal);
  expect(project(await f.store.read()).plan).toBeUndefined();
  expect(f.starts).toHaveLength(0);
  expect(JSON.parse(f.calls[0]!.messages[0]!.content).members.find((m: { memberId: string }) => m.memberId === 'owner').weeklyHours).toBe(7);
  await expect(f.pm.decidePlan(proposal.proposalId, 'designer', true)).rejects.toThrow('decider');
  await Promise.all([f.pm.decideCard(proposal.proposalId, 'owner', true), f.pm.decideCard(proposal.proposalId, 'owner', true)]);
  const state = project(await f.store.read());
  expect(state.plan).toMatchObject({ version: 1, approvedBy: 'owner' });
  expect(state.estimates.get('research')).toEqual({ min: 2, max: 4, source: 'pm' });
  expect(state.pendingPlans.size).toBe(0);
  expect(state.tasks.get('flow')?.status).toBe('waiting');
  expect(f.starts).toHaveLength(1);
  expect(f.starts[0]).toMatchObject({ taskId: 'research', planVersion: 1 });
  await f.pm.stop();
});

it('fixes exactly four task identities, assignments and dependencies independently of titles and output order', async () => {
  const value = draft(); value.tasks.reverse(); value.tasks.forEach(t => { t.title = 'Unrelated title'; });
  const f = await setup([value]);
  const { proposal } = await f.pm.startFreeProject('Ship');
  expect(proposal?.tasks.map(({ id, assignee, dependsOn }) => ({ id, assignee, dependsOn }))).toEqual([
    { id: 'research', assignee: 'research-agent', dependsOn: [] },
    { id: 'interview', assignee: 'owner', dependsOn: [] },
    { id: 'flow', assignee: 'designer', dependsOn: ['research', 'interview'] },
    { id: 'prototype', assignee: 'prototype-agent', dependsOn: ['flow'] },
  ]);
  const schema = f.calls[0]!.tools![0]!.inputSchema as any;
  expect(Object.keys(schema.properties.tasks.items.properties)).toEqual(['templateKey', 'title', 'handoffConditions', 'hours']);
  expect(schema.properties.tasks.items.properties.templateKey.enum).toEqual(['research', 'interview', 'flow', 'prototype']);
  await f.pm.stop();
});

it.each(['dependsOn', 'assignee', 'role', 'conditions', 'estimate', 'duplicate', 'extra task', 'missing task', 'unknown key'])('rejects two invalid %s drafts without recording a proposal or starting work', async kind => {
  const bad = draft();
  if (['dependsOn', 'assignee', 'role'].includes(kind)) Object.assign(bad.tasks[0]!, { [kind]: kind === 'dependsOn' ? ['flow'] : 'invented' });
  if (kind === 'conditions') bad.tasks[0]!.handoffConditions = [];
  if (kind === 'estimate') bad.tasks[0]!.hours = { min: 5, max: 2 };
  if (kind === 'duplicate') bad.tasks[1]!.templateKey = 'research';
  if (kind === 'extra task') bad.tasks.push({ ...bad.tasks[0]! });
  if (kind === 'missing task') bad.tasks.pop();
  if (kind === 'unknown key') bad.tasks[0]!.templateKey = 'invented';
  const f = await setup([bad, bad]);
  const result = await f.pm.startFreeProject('Ship');
  expect(result.failure?.message).toContain('two attempts');
  expect(f.calls).toHaveLength(2);
  expect(JSON.parse(f.calls[1]!.messages[0]!.content).validationError).toBeTruthy();
  expect((await f.store.read()).some(e => e.type === 'plan_proposed')).toBe(false);
  expect(f.starts).toHaveLength(0);
  await f.pm.stop();
});

it.each(['designer', 'research-agent', 'prototype-agent'])('reports missing role %s once without calling the model', async id => {
  const f = await setup([], members.filter(m => m.memberId !== id));
  const result = await f.pm.startFreeProject('Ship');
  expect(result.failure?.reason).toContain(id);
  expect(f.calls).toEqual([]);
  expect(f.starts).toEqual([]);
  const events = await f.store.read() as AnyEvent[];
  expect(events.filter(e => e.type === 'pm_spoke')).toHaveLength(1);
  expect(project(events).pendingPlans.size).toBe(0);
  await f.pm.stop();
});

it('uses the actual human decider for interview', async () => {
  const f = await setup([draft()], members.map(m => m.memberId === 'owner' ? { ...m, memberId: 'alice' } : m), 'alice');
  expect((await f.pm.startFreeProject('Ship')).proposal?.tasks.find(t => t.id === 'interview')?.assignee).toBe('alice');
  await f.pm.stop();
});

it('rejects an agent slot occupied by a human before drafting', async () => {
  const f = await setup([], members.map(m => m.memberId === 'research-agent' ? { ...m, kind: 'human' as const } : m));
  expect((await f.pm.startFreeProject('Ship')).failure?.reason).toContain('research-agent');
  expect(f.calls).toEqual([]);
  await f.pm.stop();
});

it('rejection closes the card, asks once, and allows a new proposal', async () => {
  const f = await setup([draft(), draft()]);
  const { proposal: p } = await f.pm.startFreeProject('Ship');
  if (!p) throw new Error('expected a proposal');
  expect(await f.pm.decideCard(p.proposalId, 'owner', false)).toHaveLength(1);
  expect(await f.pm.decideCard(p.proposalId, 'owner', false)).toEqual([]);
  expect(project(await f.store.read()).plan).toBeUndefined();
  expect(f.starts).toHaveLength(0);
  expect((await f.store.read() as AnyEvent[]).filter(e => e.type === 'pm_spoke')).toHaveLength(2);
  await f.pm.startFreeProject('Ship smaller');
  await f.pm.stop();
});

it('a draft cut off at the output limit is retried with that reason and a larger budget', async () => {
  const f = await setup([CUT_OFF, draft()]);
  const { proposal } = await f.pm.startFreeProject('Ship');
  expect(proposal?.tasks).toHaveLength(4);
  expect(f.calls[0]!.maxTokens).toBeGreaterThan(2048);
  expect(JSON.parse(f.calls[1]!.messages[0]!.content).validationError).toContain('cut off by the output token limit');
  expect(project(await f.store.read()).pendingPlans.size).toBe(1);
  await f.pm.stop();
});

it.each([
  ['cut off twice', [CUT_OFF, CUT_OFF], '초안이 너무 길어 모델 응답이 중간에 잘렸습니다', 'cut off'],
  ['provider error twice', [new Error('proxy timeout'), new Error('proxy timeout')], 'PM 모델을 호출하지 못했습니다', 'proxy timeout'],
] as const)('final drafting failure (%s) records the goal and a PM notice instead of throwing', async (_kind, replies, reason, detail) => {
  const f = await setup([...replies]);
  const result = await f.pm.startFreeProject('Ship', '2026-10-14');
  expect(result.proposal).toBeUndefined();
  expect(result.failure?.reason).toBe(reason);
  expect(result.failure?.detail).toContain(detail);
  const events = await f.store.read() as AnyEvent[];
  const state = project(events);
  expect(state.goal).toMatchObject({ text: 'Ship', deadline: '2026-10-14', decider: 'owner' });
  expect(state.pendingPlans.size).toBe(0);
  expect(state.plan).toBeUndefined();
  const spoke = events.filter(e => e.type === 'pm_spoke');
  expect(spoke).toHaveLength(1);
  expect((spoke[0]!.payload as { text: string }).text).toBe(`계획 초안을 만들지 못했습니다: ${reason}. 목표를 조금 더 구체적으로 적어 '자유형식'에서 다시 시작해 주세요.`);
  expect((spoke[0]!.payload as { text: string }).text).not.toContain(detail);
  expect(f.starts).toHaveLength(0);
  await f.pm.stop();
});

it('availability accepts zero, rejects non-human and invalid amounts without authority cards', async () => {
  const f = await setup();
  await f.pm.setAvailability('designer', 0);
  for (const n of [-1, NaN, Infinity]) await expect(f.pm.setAvailability('designer', n)).rejects.toThrow();
  await expect(f.pm.setAvailability('research-agent', 4)).rejects.toThrow('human');
  expect(project(await f.store.read()).availability.get('designer')).toBe(0);
  expect(project(await f.store.read()).pendingAuthority.size).toBe(0);
  await f.pm.stop();
});
