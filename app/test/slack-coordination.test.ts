import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { FakeSlackApi, handleSlackEventsRequest, slackSignature, SlackApiError, SlackWebApi, slackConfigFromEnv, verifySlackSignature, type SlackEventCallback, type SlackMessageEvent } from '@ensemble/channel';
import { externalConversation, externalFollowUps, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider, LlmRequest } from '@ensemble/llm';
import { SlackCoordinator } from '@ensemble/orchestrator';
import { MemoryLedgerStore } from '@ensemble/store';

// Slack itself is the in-memory fake; ledger, projection and the coordinator are real. No real Slack is called.
const TEAM = 'T1', CHANNEL = 'C1', BOT_USER = 'UBOT', BOT_ID = 'BBOT', OWNER = 'UOWNER', DESIGNER = 'UDESIGN', AGENT_BOT = 'BAGENT';
const SECRET = 'test-signing-secret';
const headers = (values: Record<string, string>) => new Headers(values);

class ScriptedLlm implements LlmProvider {
  requests: LlmRequest[] = [];
  constructor(private readonly script: Record<string, (request: LlmRequest) => Record<string, unknown> | Error>) {}
  async complete(request: LlmRequest) {
    this.requests.push(request);
    const out = this.script[request.forceTool ?? '']?.(request);
    if (!out) throw new Error(`unexpected model call ${request.forceTool}`);
    if (out instanceof Error) throw out;
    return { text: '', toolCalls: [{ name: request.forceTool!, input: out }], model: 'scripted', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

async function fixture(t: TestContext, options: { llm?: ScriptedLlm; start?: number } = {}) {
  const context = { projectId: 'space-1', targetProductId: 'product' };
  const store = new MemoryLedgerStore();
  const actor = { kind: 'human' as const, id: 'owner' };
  const seed: NewLedgerEvent[] = [
    ...[['owner', 'human', '민지'], ['designer', 'human', '디자이너'], ['research-agent', 'agent', '조사 Agent']].map(([memberId, kind, displayName]) => ({ ...context, actor, type: 'member_joined' as const, payload: { memberId: memberId!, kind: kind as 'human' | 'agent', displayName: displayName! } })),
    { ...context, actor, type: 'goal_set', payload: { text: '온보딩 개선안 출시', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...context, actor, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'approved', approvedBy: 'owner', sourceMessageIds: [], tasks: [
      { id: 'research', title: '사용자 인터뷰 정리', assignee: 'research-agent', dependsOn: [], handoffConditions: [] },
      { id: 'design', title: '온보딩 화면 시안', assignee: 'designer', dependsOn: ['research'], handoffConditions: [] },
    ] } },
    { ...context, actor, type: 'decision_recorded', payload: { decisionId: 'd1', summary: '이메일 가입만 지원한다', sourceMessageIds: [], approvedBy: 'owner', changeKinds: [] } },
  ];
  await store.append(seed.map(e => ({ ...e, at: '2026-10-01T00:00:00.000Z' })));
  let now = new Date('2026-10-07T00:00:00.000Z');
  const slack = new FakeSlackApi({ userId: BOT_USER, botId: BOT_ID, teamId: TEAM });
  const llm = options.llm ?? new ScriptedLlm({});
  const make = () => new SlackCoordinator({ store, llm, model: 'test-model', api: slack, context, clock: () => now,
    binding: { teamId: TEAM, channelId: CHANNEL, botUserId: BOT_USER, botId: BOT_ID, users: { [OWNER]: 'owner', [DESIGNER]: 'designer', [AGENT_BOT]: 'research-agent' } },
    responseTimeoutMs: 60 * 60_000 });
  const coordinator = make();
  t.after(() => store.close());
  let eventCounter = 0;
  const envelope = (event: Partial<SlackMessageEvent> & { ts: string }, eventId = `Ev${++eventCounter}`): SlackEventCallback =>
    ({ type: 'event_callback', team_id: TEAM, event_id: eventId, event_time: 1, event: { type: 'message', channel: CHANNEL, ...event } });
  const events = async () => await store.read({ projectId: context.projectId }) as AnyEvent[];
  const conversation = async () => externalConversation(await events());
  return { store, slack, llm, coordinator, make, envelope, events, conversation, context, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, now: () => now };
}

function signed(body: string, at: Date, secret = SECRET) {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': slackSignature(secret, timestamp, body) };
}

test('signature: v0 HMAC passes; tampered body, wrong secret, stale or missing headers are refused', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  const body = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
  const h = signed(body, now);
  assert.deepEqual(verifySlackSignature({ signingSecret: SECRET, timestamp: h['x-slack-request-timestamp'], signature: h['x-slack-signature'], rawBody: body, now }), { ok: true });
  assert.deepEqual(verifySlackSignature({ signingSecret: SECRET, timestamp: h['x-slack-request-timestamp'], signature: h['x-slack-signature'], rawBody: `${body} `, now }), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(verifySlackSignature({ signingSecret: 'other', timestamp: h['x-slack-request-timestamp'], signature: h['x-slack-signature'], rawBody: body, now }), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(verifySlackSignature({ signingSecret: SECRET, timestamp: h['x-slack-request-timestamp'], signature: h['x-slack-signature'], rawBody: body, now: new Date(now.getTime() + 6 * 60_000) }), { ok: false, reason: 'stale_timestamp' });
  assert.deepEqual(verifySlackSignature({ signingSecret: SECRET, timestamp: null, signature: h['x-slack-signature'], rawBody: body, now }), { ok: false, reason: 'missing_headers' });

  // url_verification answers the challenge only when signed; event callbacks carry the retry headers through.
  assert.equal(handleSlackEventsRequest({ rawBody: body, headers: headers(h), signingSecret: SECRET, now }).body, 'abc');
  assert.equal(handleSlackEventsRequest({ rawBody: body, headers: headers({}), signingSecret: SECRET, now }).status, 401);
  const callback = JSON.stringify({ type: 'event_callback', team_id: TEAM, event_id: 'Ev1', event_time: 1, event: { type: 'app_mention', channel: CHANNEL, user: OWNER, text: 'hi', ts: '1.1' } });
  const result = handleSlackEventsRequest({ rawBody: callback, headers: headers({ ...signed(callback, now), 'x-slack-retry-num': '2', 'x-slack-retry-reason': 'http_timeout' }), signingSecret: SECRET, now });
  assert.equal(result.status, 200);
  assert.equal(result.envelope?.event_id, 'Ev1');
  assert.equal(result.retryNum, 2);
  assert.equal(result.retryReason, 'http_timeout');
  assert.equal(handleSlackEventsRequest({ rawBody: '{not json', headers: headers(signed('{not json', now)), signingSecret: SECRET, now }).status, 400);
});

test('Flow A: a mention in a thread gets a same-thread reply from Space + thread context, and the answer is recorded as a decision', async t => {
  const llm = new ScriptedLlm({
    slack_thread_reply: () => ({ text: '민지님, 인터뷰 정리가 끝나야 시안을 시작할 수 있어요. 이메일 가입만으로 시안을 시작해도 될까요?', kind: 'ask', confirmed: ['이메일 가입만 지원'], remaining: ['시안 시작 여부'], taskIds: ['design', 'unknown-task'] }),
    record_thread_reply: () => ({ kind: 'decision', confirmed: ['이메일 가입만으로 시안 시작'], remaining: ['인터뷰 정리 공유'] }),
  });
  const f = await fixture(t, { llm });
  const root = f.slack.add(CHANNEL, { user: DESIGNER, text: '온보딩 시안 언제 시작하면 될까요?' });
  const mention = f.slack.add(CHANNEL, { user: OWNER, threadTs: root.ts, text: `<@${BOT_USER}> 시안 시작해도 되는지 정리해 줘` });

  const outcome = await f.coordinator.receive(f.envelope({ type: 'app_mention', user: OWNER, text: mention.text, ts: mention.ts, thread_ts: root.ts }));
  assert.equal(outcome.kind, 'replied');
  assert.deepEqual(f.slack.replyReads, [{ channel: CHANNEL, ts: root.ts }]);
  assert.equal(f.slack.posts.length, 1);
  assert.equal(f.slack.posts[0]!.threadTs, root.ts, 'reply goes to the same thread');

  // The model saw the Space's goal, decisions and work and the thread with author kinds.
  const input = JSON.parse(llm.requests[0]!.messages[0]!.content);
  assert.equal(input.space.goal.text, '온보딩 개선안 출시');
  assert.deepEqual(input.space.decisions, ['이메일 가입만 지원한다']);
  assert.ok(input.space.tasks.some((task: { taskId: string }) => task.taskId === 'design'));
  assert.deepEqual(input.thread.map((m: { authorKind: string }) => m.authorKind), ['human', 'human']);
  assert.equal(input.question, '시안 시작해도 되는지 정리해 줘');

  let c = await f.conversation();
  const observed = c.messages.find(m => m.source.messageTs === mention.ts)!;
  assert.deepEqual(observed.source, { provider: 'slack', workspaceId: TEAM, channelId: CHANNEL, messageTs: mention.ts, threadTs: root.ts });
  assert.deepEqual(observed.author, { kind: 'human', externalUserId: OWNER, memberId: 'owner' });
  assert.equal(observed.kind, 'request');
  assert.equal(observed.postedAt, new Date(Number(mention.ts.split('.')[0]) * 1000).toISOString());
  const reply = c.messages.find(m => m.author.kind === 'pm')!;
  assert.equal(reply.inReplyTo, observed.messageId);
  assert.equal(reply.composedBy, 'llm');
  assert.deepEqual(reply.taskIds, ['design'], 'unknown task ids from the model are dropped');
  const request = [...c.requests.values()][0]!;
  assert.equal(request.status, 'awaiting_response');
  assert.equal(request.request.target.externalUserId, OWNER);

  // The owner answers in the thread (no mention): recorded with what it settled, request answered, no PM reply.
  const answer = f.slack.add(CHANNEL, { user: OWNER, threadTs: root.ts, text: '네, 이메일 가입만으로 시작하죠' });
  const recorded = await f.coordinator.receive(f.envelope({ user: OWNER, text: answer.text, ts: answer.ts, thread_ts: root.ts }));
  assert.deepEqual(recorded, { kind: 'recorded', messageId: `slack:${TEAM}:${CHANNEL}:${answer.ts}`, resolved: true, requestId: request.request.requestId });
  assert.equal(f.slack.posts.length, 1);
  c = await f.conversation();
  const settled = c.messages.at(-1)!;
  assert.equal(settled.kind, 'decision');
  assert.deepEqual(settled.confirmed, ['이메일 가입만으로 시안 시작']);
  assert.deepEqual(settled.remaining, ['인터뷰 정리 공유']);
  assert.equal(c.requests.get(request.request.requestId)!.status, 'answered');
  assert.equal(c.requests.get(request.request.requestId)!.reply?.text, answer.text);
});

test('catch-up: replies whose message events never arrived are recovered once from the PM threads', async t => {
  const llm = new ScriptedLlm({
    slack_thread_reply: () => ({ text: '이메일 가입만으로 시안을 시작해도 될까요?', kind: 'ask', confirmed: [], remaining: ['시안 시작 여부'], taskIds: ['design'] }),
    record_thread_reply: () => ({ kind: 'decision', confirmed: ['시안 시작'], remaining: [] }),
  });
  const f = await fixture(t, { llm });
  const root = f.slack.add(CHANNEL, { user: DESIGNER, text: '온보딩 시안 언제 시작하면 될까요?' });
  const early = f.slack.add(CHANNEL, { user: DESIGNER, threadTs: root.ts, text: '참고로 저는 다음 주 휴가예요' });
  const mention = f.slack.add(CHANNEL, { user: OWNER, threadTs: root.ts, text: `<@${BOT_USER}> 정리해 줘` });
  await f.coordinator.receive(f.envelope({ type: 'app_mention', user: OWNER, text: mention.text, ts: mention.ts, thread_ts: root.ts }));
  const untracked = f.slack.add(CHANNEL, { user: OWNER, text: '다른 이야기' });
  f.slack.add(CHANNEL, { user: OWNER, threadTs: untracked.ts, text: '스레드 답글' });
  // The owner answers but only Slack knows: no event reaches the coordinator.
  const answer = f.slack.add(CHANNEL, { user: OWNER, threadTs: root.ts, text: '네, 시작하죠' });

  assert.equal(await f.coordinator.catchUp(), 1);
  assert.equal(await f.coordinator.catchUp(), 0, 'a second pass records nothing');
  // The live event arriving late is a duplicate of what catch-up recorded.
  assert.equal((await f.coordinator.receive(f.envelope({ user: OWNER, text: answer.text, ts: answer.ts, thread_ts: root.ts }))).kind, 'duplicate');
  const c = await f.conversation();
  assert.equal(f.slack.posts.length, 1, 'catch-up never posts');
  assert.deepEqual(f.slack.replyReads.map(r => r.ts), [root.ts, root.ts, root.ts], 'only the PM thread is re-read');
  assert.ok(!c.messages.some(m => m.source.messageTs === early.ts), 'messages before the PM joined are not recorded');
  const recovered = c.messages.find(m => m.source.messageTs === answer.ts)!;
  assert.equal(recovered.text, answer.text);
  assert.equal(recovered.kind, 'decision');
  assert.equal([...c.requests.values()][0]!.status, 'answered');
});

test('dedupe: a redelivered event and a restart never answer twice; own, unmapped-bot and untracked messages are ignored', async t => {
  const llm = new ScriptedLlm({ slack_thread_reply: () => ({ text: '다음 행동은 인터뷰 정리 공유예요.', kind: 'answer' }), record_thread_reply: () => ({ kind: 'proposal' }) });
  const f = await fixture(t, { llm });
  const root = f.slack.add(CHANNEL, { user: OWNER, text: `<@${BOT_USER}> 다음에 뭐 하면 돼?` });
  const mention = f.envelope({ type: 'app_mention', user: OWNER, text: root.text, ts: root.ts }, 'EvSame');
  assert.equal((await f.coordinator.receive(mention)).kind, 'replied');
  assert.deepEqual(await f.coordinator.receive(mention), { kind: 'duplicate', key: 'EvSame' });
  // After a restart the in-memory id set is empty; the ledger key still stops a second answer.
  assert.deepEqual(await f.make().receive({ ...mention, event_id: 'EvRetry' }), { kind: 'duplicate', key: `slack:${TEAM}:${CHANNEL}:${root.ts}` });
  // The same mention also arrives as a plain message event.
  assert.deepEqual(await f.coordinator.receive(f.envelope({ user: OWNER, text: root.text, ts: root.ts })), { kind: 'ignored', reason: 'mention_via_app_mention' });
  assert.equal(f.slack.posts.length, 1);
  assert.equal(llm.requests.length, 1);

  const own = f.slack.posts[0]!;
  assert.deepEqual(await f.coordinator.receive(f.envelope({ user: BOT_USER, bot_id: BOT_ID, text: own.text, ts: own.ts, thread_ts: root.ts })), { kind: 'ignored', reason: 'self' });
  assert.deepEqual(await f.coordinator.receive(f.envelope({ subtype: 'bot_message', bot_id: BOT_ID, text: own.text, ts: own.ts, thread_ts: root.ts })), { kind: 'ignored', reason: 'self' });
  assert.deepEqual(await f.coordinator.receive(f.envelope({ subtype: 'bot_message', bot_id: 'BOTHER', text: 'spam', ts: '9.1', thread_ts: root.ts })), { kind: 'ignored', reason: 'unmapped_bot' });
  assert.deepEqual(await f.coordinator.receive(f.envelope({ subtype: 'message_changed', user: OWNER, ts: '9.2', thread_ts: root.ts })), { kind: 'ignored', reason: 'unsupported_subtype' });
  assert.deepEqual(await f.coordinator.receive(f.envelope({ user: OWNER, text: '다른 이야기', ts: '9.3', thread_ts: '8.0' })), { kind: 'ignored', reason: 'untracked_thread' });
  assert.deepEqual(await f.coordinator.receive(f.envelope({ user: OWNER, text: '채널 잡담', ts: '9.4' })), { kind: 'ignored', reason: 'not_threaded' });
  assert.deepEqual(await f.coordinator.receive({ ...f.envelope({ user: OWNER, text: 'x', ts: '9.5', thread_ts: root.ts }), team_id: 'TOTHER' }), { kind: 'ignored', reason: 'unbound_team' });
  assert.deepEqual(await f.coordinator.receive(f.envelope({ channel: 'COTHER', user: OWNER, text: 'x', ts: '9.6', thread_ts: root.ts })), { kind: 'ignored', reason: 'unbound_channel' });

  // A mapped personal agent's bot message in a tracked thread is recorded with author kind "agent"; its "decision" stays a proposal.
  const agentNote = await f.coordinator.receive(f.envelope({ subtype: 'bot_message', bot_id: AGENT_BOT, text: '인터뷰 요약을 올렸어요', ts: '9.7', thread_ts: root.ts }));
  assert.equal(agentNote.kind, 'recorded');
  const last = (await f.conversation()).messages.at(-1)!;
  assert.deepEqual(last.author, { kind: 'agent', externalUserId: AGENT_BOT, memberId: 'research-agent' });
  assert.equal((await f.conversation()).messages.filter(m => m.author.kind === 'pm').length, 1);
});

test('Flow B: an agent blocker in the Space is raised in Slack first, and the owner reply links back to the task', async t => {
  const llm = new ScriptedLlm({ record_thread_reply: () => ({ kind: 'decision', confirmed: ['인터뷰 5명으로 줄여 진행'], remaining: [] }) });
  const f = await fixture(t, { llm });
  // Changes recorded before the coordinator existed are not raised (no history replay).
  await f.store.append([{ ...f.context, actor: { kind: 'system', id: 'session-runner' }, type: 'task_blocked', at: '2026-10-06T00:00:00.000Z', payload: { taskId: 'research', reason: '오래된 막힘' } }]);
  await f.store.append([{ ...f.context, actor: { kind: 'system', id: 'session-runner' }, type: 'task_blocked', at: f.now().toISOString(), payload: { taskId: 'research', reason: '인터뷰 대상자 10명 중 5명만 응답했어요' } }]);

  const sent = await f.coordinator.syncSpaceChanges();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.kind, 'sent');
  assert.equal(f.slack.posts.length, 1);
  assert.equal(f.slack.posts[0]!.channel, CHANNEL);
  assert.equal(f.slack.posts[0]!.threadTs, undefined, 'a new thread in the designated channel');
  assert.match(f.slack.posts[0]!.text, new RegExp(`^<@${OWNER}> 조사 Agent가 "사용자 인터뷰 정리" 작업에서 막혔어요`));
  assert.deepEqual(await f.coordinator.syncSpaceChanges(), [], 'the same Space change is raised once');
  assert.equal(f.slack.posts.length, 1);

  let c = await f.conversation();
  const [request] = externalFollowUps(c, 'research');
  assert.equal(request!.status, 'awaiting_response');
  assert.equal(request!.request.reason, 'agent_blocker');
  assert.deepEqual(request!.request.target, { kind: 'human', externalUserId: OWNER, memberId: 'owner' });

  // Someone else's reply is recorded in the thread but does not answer the owner's request.
  const ts = f.slack.posts[0]!.ts;
  const other = await f.coordinator.receive(f.envelope({ user: DESIGNER, text: '저도 궁금해요', ts: `${Number(ts) + 1}.000100`, thread_ts: ts }));
  assert.equal(other.kind, 'recorded');
  assert.equal((await f.conversation()).requests.get(request!.request.requestId)!.status, 'awaiting_response');

  const reply = await f.coordinator.receive(f.envelope({ user: OWNER, text: '5명으로 줄여서 진행해 주세요', ts: `${Number(ts) + 2}.000100`, thread_ts: ts }));
  assert.deepEqual(reply, { kind: 'recorded', messageId: `slack:${TEAM}:${CHANNEL}:${Number(ts) + 2}.000100`, resolved: true, requestId: request!.request.requestId });
  c = await f.conversation();
  const [followUp] = externalFollowUps(c, 'research');
  assert.equal(followUp!.status, 'answered');
  assert.equal(followUp!.reply?.text, '5명으로 줄여서 진행해 주세요');
  assert.deepEqual(followUp!.reply?.taskIds, ['research']);
  assert.equal(followUp!.reply?.kind, 'decision');
  assert.deepEqual(followUp!.reply?.confirmed, ['인터뷰 5명으로 줄여 진행']);
});

test('failures: read, compose and send failures are recorded and shown; Flow B retries; unanswered requests become no_response', async t => {
  const llm = new ScriptedLlm({ slack_thread_reply: () => new Error('provider down'), record_thread_reply: () => new Error('provider down') });
  const f = await fixture(t, { llm });

  // Read failure: the person sees a notice in the thread; the ledger shows the failure.
  const a = f.slack.add(CHANNEL, { user: OWNER, text: `<@${BOT_USER}> 상태 알려줘` });
  f.slack.fail.replies.push('not_in_channel');
  assert.deepEqual(await f.coordinator.receive(f.envelope({ type: 'app_mention', user: OWNER, text: a.text, ts: a.ts })), { kind: 'failed', messageId: `slack:${TEAM}:${CHANNEL}:${a.ts}`, stage: 'read', error: 'not_in_channel' });
  assert.match(f.slack.posts.at(-1)!.text, /스레드 맥락을 읽지 못해.*not_in_channel/);

  // Model failure: a fixed template reply from Space state, marked as such.
  const b = f.slack.add(CHANNEL, { user: OWNER, text: `<@${BOT_USER}> 상태 알려줘` });
  const replied = await f.coordinator.receive(f.envelope({ type: 'app_mention', user: OWNER, text: b.text, ts: b.ts }));
  assert.equal(replied.kind === 'replied' && replied.composedBy, 'template');
  assert.match(f.slack.posts.at(-1)!.text, /온보딩 개선안 출시/);

  // Send failure: nothing claims a reply was posted.
  const c1 = f.slack.add(CHANNEL, { user: OWNER, text: `<@${BOT_USER}> 다시` });
  f.slack.fail.post.push('channel_not_found');
  assert.equal((await f.coordinator.receive(f.envelope({ type: 'app_mention', user: OWNER, text: c1.text, ts: c1.ts }))).kind, 'failed');
  let c = await f.conversation();
  assert.deepEqual(c.failures.map(x => [x.stage, x.error]), [['read', 'not_in_channel'], ['compose', 'model_unavailable'], ['compose', 'model_unavailable'], ['send', 'channel_not_found']]);
  assert.equal(c.messages.filter(m => m.author.kind === 'pm' && m.inReplyTo === `slack:${TEAM}:${CHANNEL}:${c1.ts}`).length, 0);

  // Flow B: first send fails (recorded), the next sync retries and succeeds.
  await f.store.append([{ ...f.context, actor: { kind: 'agent', id: 'research-agent' }, type: 'result_submitted', at: f.now().toISOString(), payload: { taskId: 'research', resultId: 'r1', planVersion: 1, summary: '인터뷰 요약 초안', artifactIds: [] } }]);
  f.slack.fail.post.push('ratelimited');
  assert.deepEqual((await f.coordinator.syncSpaceChanges()).map(o => [o.kind, o.kind === 'failed' ? o.error : '']), [['failed', 'ratelimited']]);
  assert.deepEqual((await f.coordinator.syncSpaceChanges()).map(o => o.kind), ['sent']);
  c = await f.conversation();
  const request = [...c.requests.values()].find(r => r.request.reason === 'agent_result')!;
  assert.equal(request.status, 'awaiting_response');

  // No answer before the due time: no_response. A late answer is linked but does not rewrite the outcome.
  assert.deepEqual(await f.coordinator.expireOverdue(), []);
  f.advance(61 * 60_000);
  assert.deepEqual(await f.coordinator.expireOverdue(), [request.request.requestId]);
  assert.deepEqual(await f.coordinator.expireOverdue(), []);
  const late = await f.coordinator.receive(f.envelope({ user: OWNER, text: '늦었지만 좋아요', ts: `${Number(request.request.source.messageTs) + 5}.000100`, thread_ts: request.request.source.messageTs }));
  assert.deepEqual(late, { kind: 'recorded', messageId: `slack:${TEAM}:${CHANNEL}:${Number(request.request.source.messageTs) + 5}.000100`, resolved: false, requestId: request.request.requestId });
  c = await f.conversation();
  assert.equal(c.requests.get(request.request.requestId)!.status, 'no_response');
  assert.equal(c.messages.at(-1)!.kind, 'answer', 'an answer the model could not classify is still marked as an answer');
});

test('Flow B: a recipient without a Slack mapping is recorded once and not retried', async t => {
  const f = await fixture(t);
  const coordinator = new SlackCoordinator({ store: f.store, llm: f.llm, model: 'm', api: f.slack, context: f.context, clock: f.now,
    binding: { teamId: TEAM, channelId: CHANNEL, botUserId: BOT_USER, users: {} } });
  await f.store.append([{ ...f.context, actor: { kind: 'system', id: 'session-runner' }, type: 'task_blocked', at: f.now().toISOString(), payload: { taskId: 'research', reason: '막힘' } }]);
  assert.deepEqual((await coordinator.syncSpaceChanges()).map(o => o.kind === 'failed' && o.error), ['recipient_not_mapped']);
  assert.deepEqual(await coordinator.syncSpaceChanges(), []);
  assert.equal(f.slack.posts.length, 0);
});

test('SlackWebApi: calls the three Web API methods with the bearer token and maps errors without leaking it', async () => {
  const token = 'xoxb-test-not-real';
  const calls: { url: string; init: RequestInit }[] = [];
  const responses: Response[] = [
    Response.json({ ok: true, messages: [{ ts: '1.1', user: 'U1', text: 'root' }, { ts: '1.2', thread_ts: '1.1', bot_id: 'B1', text: 'bot' }], has_more: false }),
    Response.json({ ok: true, channel: 'C1', ts: '1.3' }),
    Response.json({ ok: false, error: 'not_in_channel' }),
    new Response('slow down', { status: 429 }),
  ];
  const api = new SlackWebApi({ token, baseUrl: 'https://slack.invalid/api', fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return responses.shift()!; }) as typeof fetch });
  const thread = await api.conversationsReplies({ channel: 'C1', ts: '1.1' });
  assert.deepEqual(thread, [{ ts: '1.1', user: 'U1', text: 'root' }, { ts: '1.2', threadTs: '1.1', botId: 'B1', text: 'bot' }]);
  assert.match(calls[0]!.url, /conversations\.replies\?channel=C1&ts=1\.1/);
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, `Bearer ${token}`);
  assert.deepEqual(await api.postMessage({ channel: 'C1', text: 'hi', threadTs: '1.1' }), { channel: 'C1', ts: '1.3' });
  assert.deepEqual(JSON.parse(calls[1]!.init.body as string), { channel: 'C1', text: 'hi', thread_ts: '1.1', unfurl_links: false, unfurl_media: false });
  for (const code of ['not_in_channel', 'ratelimited']) {
    const error = await api.postMessage({ channel: 'C1', text: 'x' }).then(() => undefined, (e: unknown) => e);
    assert.ok(error instanceof SlackApiError && error.code === code);
    assert.ok(!String((error as Error).message).includes(token) && !JSON.stringify(error).includes(token));
  }
  assert.ok(!JSON.stringify(api).includes(token));
  assert.deepEqual(slackConfigFromEnv({ SLACK_BOT_TOKEN: 'x' }), { ok: false, missing: ['SLACK_CHANNEL_ID (or SLACK_TEST_CHANNEL_ID)'] });
  // Socket Mode settings: test channel alias, no team/bot ids, no user map.
  assert.deepEqual(slackConfigFromEnv({ SLACK_BOT_TOKEN: 'x', SLACK_APP_TOKEN: 'a', SLACK_SIGNING_SECRET: 's', SLACK_TEST_CHANNEL_ID: 'CTEST' }),
    { ok: true, config: { botToken: 'x', appToken: 'a', signingSecret: 's', channelId: 'CTEST', users: {} } });
  const parsed = slackConfigFromEnv({ SLACK_BOT_TOKEN: 'x', SLACK_SIGNING_SECRET: 's', SLACK_TEAM_ID: 'T', SLACK_CHANNEL_ID: 'C', SLACK_USER_MAP: 'U1=owner, B2=research-agent' });
  assert.ok(parsed.ok && parsed.config.users.B2 === 'research-agent' && parsed.config.users.U1 === 'owner');
});
