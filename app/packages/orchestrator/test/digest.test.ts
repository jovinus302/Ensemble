import { afterEach, expect, it } from 'vitest';
import { digestKey, type AnyEvent, type DigestSettings, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import type { SessionConnector } from '@ensemble/agents';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '../src/pm.ts';

// MC2 B9 (§3, §5 acceptance 5): one code-written digest a day at 09:00 Asia/Seoul (Q4), mentioning only
// the people something changed for; no change, no post; a second call the same day posts nothing.
let n = 0;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

const connector: SessionConnector = {
  async startSession(agentId) { return { threadId: `thread-${agentId}`, workspace: `/workspace/${agentId}` }; },
  async startTask() { throw new Error('no agent work in digest tests'); },
  async sendUpdate() { return { sent: false, reason: 'none' }; },
  onEvent() { return () => undefined; },
  async stop() { /* nothing to stop */ },
};
const T0 = Date.parse('2026-10-01T00:00:00.000Z'); // 09:00 Asia/Seoul
const at = (hours: number) => new Date(T0 + hours * 3_600_000);

async function fixture(digestSettings?: DigestSettings) {
  const ctx = { projectId: `digest-${++n}`, targetProductId: 'product' };
  const llm: LlmProvider = { async complete(request) { throw new Error(`Unexpected call ${request.forceTool}`); } };
  const store = new MemoryLedgerStore();
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'fake', digestSettings });
  cleanup.push(() => pm.stop());
  const seed = (type: NewLedgerEvent['type'], payload: unknown, hours: number, actor: NewLedgerEvent['actor'] = { kind: 'human', id: 'owner' }): NewLedgerEvent => ({ ...ctx, type, actor, payload, at: at(hours).toISOString() });
  await store.append([
    seed('member_joined', { memberId: 'owner', kind: 'human', displayName: '사용자' }, -72),
    seed('member_joined', { memberId: 'designer', kind: 'human', displayName: '디자이너' }, -72),
    seed('member_joined', { memberId: 'marketer', kind: 'human', displayName: '마케터' }, -72),
    seed('member_joined', { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' }, -72),
    seed('goal_set', { text: 'PT 예약 프로토타입', decider: 'owner', delegation: { pmMayApply: [] } }, -72),
    seed('plan_committed', { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'research', title: '예약 서비스 대안 조사', assignee: 'research-agent', dependsOn: [], handoffConditions: ['대안 2개가 표로 비교되어 있다'] },
      { id: 'flow', title: '흐름 설계', assignee: 'designer', dependsOn: ['research'], handoffConditions: ['화면 목록'] },
    ] }, -72),
  ]);
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  /** Overnight: the research agent started and finished its work, and the designer was asked a decision. */
  const overnight = () => store.append([
    seed('task_start_reserved', { taskId: 'research', specVersion: 1, trigger: 'kickoff' }, -4, { kind: 'pm', id: 'pm' }),
    seed('task_started', { taskId: 'research', turnId: 'turn-1' }, -4, { kind: 'agent', id: 'research-agent' }),
    seed('result_submitted', { taskId: 'research', resultId: 'r1', planVersion: 1, summary: '비교표', artifactIds: [] }, -3, { kind: 'agent', id: 'research-agent' }),
    seed('task_checked', { taskId: 'research', resultId: 'r1', reason: '인계 조건 충족' }, -2, { kind: 'pm', id: 'pm' }),
    { ...seed('decision_requested', { requestId: 'req-flow', kind: 'choice', targetMemberId: 'designer', question: '흐름을 모바일 우선으로 할까요?',
      options: [{ optionId: 'mobile', label: '모바일 우선', effects: [{ type: 'none' }], tradeoff: '' }, { optionId: 'hold', label: '보류', effects: [{ type: 'none' }], tradeoff: '' }],
      recommendation: { optionId: 'mobile', rationale: '예약은 대부분 모바일에서 합니다', evidence: [] }, impact: { taskIds: ['flow'], blockedTaskIds: [] }, sourceMessageIds: [] }, -1, { kind: 'pm', id: 'pm' }), idempotencyKey: 'decision:req-flow' },
  ]);
  return { ctx, pm, store, events, overnight };
}
const summaries = (events: AnyEvent[]) => events.filter(e => e.type === 'pm_spoke' && e.payload.kind === 'summary');

it('nothing changed since the last digest: nothing is posted, and the day is recorded as handled', async () => {
  const f = await fixture();
  expect(await f.pm.digest(at(0.5))).toEqual([]);
  const events = await f.events();
  expect(summaries(events)).toHaveLength(0);
  expect(events.find(e => e.idempotencyKey === digestKey(at(0.5)))).toMatchObject({ type: 'pm_considered', payload: { decision: 'silent' } });
  // A change later that day waits for tomorrow's digest instead of posting mid-day.
  await f.overnight();
  expect(await f.pm.digest(at(5))).toEqual([]);
  expect(summaries(await f.events())).toHaveLength(0);
});

it('posts once a day at 09:00, mentioning only the people something changed for', async () => {
  const f = await fixture();
  await f.overnight();
  // 08:00 in Seoul: not yet.
  expect(await f.pm.digest(at(-1))).toEqual([]);

  const posts = await f.pm.digest(at(0.5));

  expect(posts).toEqual([{ kind: 'summary', text: [
    '지난 요약 이후 바뀐 것을 정리했어요.',
    '- @사용자 완료 1건("예약 서비스 대안 조사") · Agent가 새로 시작 1건("예약 서비스 대안 조사")',
    '- @디자이너 새 결정 요청 1건 · 답을 기다리는 결정 1건',
  ].join('\n') }]);
  expect(posts[0]!.text).not.toContain('마케터');
  expect(summaries(await f.events())).toEqual([expect.objectContaining({ idempotencyKey: `${digestKey(at(0.5))}:0`, payload: expect.objectContaining({ text: posts[0]!.text }) })]);

  // The same day again: nothing more.
  expect(await f.pm.digest(at(3))).toEqual([]);
  expect(await f.pm.digest(at(14))).toEqual([]);
  expect(summaries(await f.events())).toHaveLength(1);
  // The next morning, with nothing new since: no post.
  expect(await f.pm.digest(at(24.5))).toEqual([]);
  expect(summaries(await f.events())).toHaveLength(1);
});

it('one setting turns the digest off or moves its hour (Q4)', async () => {
  const off = await fixture({ enabled: false, hourKst: 9 });
  await off.overnight();
  expect(await off.pm.digest(at(0.5))).toEqual([]);
  expect((await off.events()).some(e => e.idempotencyKey?.startsWith('digest:'))).toBe(false);

  const later = await fixture({ enabled: true, hourKst: 18 });
  await later.overnight();
  expect(await later.pm.digest(at(0.5))).toEqual([]);
  expect(await later.pm.digest(at(9.5))).toHaveLength(1);
});
