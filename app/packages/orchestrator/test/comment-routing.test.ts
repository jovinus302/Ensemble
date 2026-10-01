import { afterEach, expect, it, vi } from 'vitest';
import { project, taskActivity, type AnyEvent } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import type { ContinueTaskInput, SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import { MemoryLedgerStore } from '@ensemble/store';
import { ProjectManager } from '../src/pm.ts';

// MC2 B6 (§5 acceptance 3): a person's comment on an agent's work item reaches that agent verbatim with a
// change_notified record; a comment on a person's work item is not forwarded. Both still go to the coordinator.
let n = 0;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

class FakeConnector implements SessionConnector {
  starts: { agentId: string; input: TaskInstructionsInput }[] = [];
  updates: { agentId: string; input: UpdateInstructionsInput }[] = [];
  continued: { agentId: string; input: ContinueTaskInput }[] = [];
  private turns = 0;
  async startSession(agentId: string) { return { threadId: `thread-${agentId}`, workspace: `/workspace/${agentId}` }; }
  async startTask(agentId: string, input: TaskInstructionsInput) { this.starts.push({ agentId, input }); return `turn-${++this.turns}`; }
  async sendUpdate(agentId: string, input: UpdateInstructionsInput) { this.updates.push({ agentId, input }); return { sent: true as const }; }
  async continueTask(agentId: string, input: ContinueTaskInput) { this.continued.push({ agentId, input }); return `turn-${++this.turns}`; }
  onEvent(_handler: (event: SessionEvent) => void) { return () => undefined; }
  async stop() { /* nothing to stop */ }
}

async function fixture() {
  const ctx = { projectId: `comment-routing-${++n}`, targetProductId: 'product' };
  const llm: LlmProvider = { async complete(request) { throw new Error(`Unexpected call ${request.forceTool}`); } };
  const store = new MemoryLedgerStore();
  const connector = new FakeConnector();
  const pm = new ProjectManager({ ...ctx, store, llm, connector, model: 'fake' });
  cleanup.push(() => pm.stop());
  const owner = { kind: 'human' as const, id: 'owner' };
  await store.append([
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: '디자이너' } },
    { ...ctx, actor: owner, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' } },
    { ...ctx, actor: owner, type: 'goal_set', payload: { text: 'PT 예약 프로토타입', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...ctx, actor: owner, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'research', title: '예약 서비스 대안 조사', assignee: 'research-agent', dependsOn: [], handoffConditions: ['대안 2개가 표로 비교되어 있다'] },
      { id: 'interview', title: '고객 인터뷰', assignee: 'designer', dependsOn: [], handoffConditions: ['5명 인터뷰 메모'] },
    ] } },
  ]);
  const coordinated = vi.spyOn(pm['coordinator'], 'onMessage').mockResolvedValue({ posts: [], events: [] });
  const events = async () => await store.read({ projectId: ctx.projectId }) as AnyEvent[];
  return { ctx, pm, store, connector, events, coordinated };
}
const notices = (events: AnyEvent[]) => events.flatMap(e => e.type === 'change_notified' ? [e.payload] : []);

it('a comment on an agent\'s running work is steered to that agent verbatim and recorded as change_notified, then considered as usual', async () => {
  const f = await fixture();
  await f.pm['dispatcher'].startReady('kickoff');
  expect(project(await f.events()).tasks.get('research')?.status).toBe('running');
  const comment = '비교표에 월 이용료 열도 넣어 주세요';

  await f.pm.postComment('research', 'owner', comment);

  const events = await f.events();
  const message = events.findLast(e => e.type === 'message_recorded')!;
  expect(message.type === 'message_recorded' && message.payload).toMatchObject({ authorId: 'owner', text: comment, threadId: 'task:research' });
  const [notice] = notices(events);
  expect(notice).toMatchObject({ recipientId: 'research-agent', via: 'steer', changeId: `comment:${message.type === 'message_recorded' ? message.payload.messageId : ''}` });
  expect(JSON.parse(notice!.text).change).toEqual([`사용자의 댓글: ${comment}`]);
  expect(f.connector.updates).toHaveLength(1);
  expect(f.connector.updates[0]).toMatchObject({ agentId: 'research-agent', input: { change: [`사용자의 댓글: ${comment}`] } });
  expect(f.coordinated).toHaveBeenCalledTimes(1);
  // The comment is part of the work item's activity.
  expect(taskActivity(events, 'research').filter(a => a.kind === 'comment').map(a => a.text)).toEqual([comment]);

  // Later pending-change delivery never sends the same comment again.
  await f.pm.deliverPendingChanges();
  expect(f.connector.updates).toHaveLength(1);
  expect(f.connector.continued).toHaveLength(0);
});

it('a comment on an agent\'s work whose turn ended is carried by a new turn on the same thread', async () => {
  const f = await fixture();
  await f.pm['dispatcher'].startReady('kickoff');
  // The turn ended (e.g. after a question); the task is still the agent's running work.
  f.pm.sessions['runs'].get('research-agent')!.finished = true;
  await f.pm.postComment('research', 'designer', '경쟁사 두 곳은 빼도 됩니다');
  expect(notices(await f.events())).toEqual([expect.objectContaining({ recipientId: 'research-agent', via: 'next_turn' })]);
  expect(f.connector.continued).toHaveLength(1);
  expect(f.connector.continued[0]!.input.update.change).toEqual(['디자이너의 댓글: 경쟁사 두 곳은 빼도 됩니다']);
});

it('a comment on a person\'s work item is not forwarded to anyone', async () => {
  const f = await fixture();
  await f.pm.postComment('interview', 'owner', '인터뷰는 이번 주 안에 끝내면 좋겠어요');
  const events = await f.events();
  expect(notices(events)).toEqual([]);
  expect(f.connector.updates).toHaveLength(0);
  expect(f.connector.continued).toHaveLength(0);
  expect(events.findLast(e => e.type === 'message_recorded')).toMatchObject({ payload: { threadId: 'task:interview' } });
  expect(f.coordinated).toHaveBeenCalledTimes(1);
});

it('a comment on unknown work is refused', async () => {
  const f = await fixture();
  await expect(f.pm.postComment('nope', 'owner', '안녕하세요')).rejects.toMatchObject({ status: 404 });
});
