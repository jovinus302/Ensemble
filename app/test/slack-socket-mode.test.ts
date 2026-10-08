import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeSlackApi, openSocketModeUrl, SlackApiError, SlackSocketModeClient, type SlackEventCallback, type SlackSocket, type SocketModeLog } from '@ensemble/channel';
import { externalConversation, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import { ANY_SLACK_HUMAN, SlackCoordinator, slackBindingFromConfig } from '@ensemble/orchestrator';
import { MemoryLedgerStore } from '@ensemble/store';

// Socket Mode with a fake socket and a fake Slack Web API; no network.
class FakeSocket implements SlackSocket {
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, ((event: { data: unknown }) => void)[]>();
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { if (this.closed) return; this.closed = true; this.emit('close'); }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string, data?: unknown) { for (const l of this.listeners.get(type) ?? []) l({ data }); }
  frame(value: unknown) { this.emit('message', JSON.stringify(value)); }
  acks() { return this.sent.map(s => JSON.parse(s).envelope_id as string); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

function harness(onEvent: (envelope: SlackEventCallback, meta: { retryNum?: number }) => unknown = () => {}, openUrl?: () => Promise<string>) {
  const sockets: FakeSocket[] = [];
  const logs: SocketModeLog[] = [];
  let opened = 0;
  const client = new SlackSocketModeClient({ openUrl: openUrl ?? (async () => `wss://fake/${++opened}`), createSocket: url => { const s = new FakeSocket(url); sockets.push(s); return s; },
    onEvent, onLog: entry => logs.push(entry), reconnectDelayMs: () => 1 });
  return { client, sockets, logs };
}
const callback = (eventId: string, event: Record<string, unknown>): SlackEventCallback =>
  ({ type: 'event_callback', team_id: 'T1', event_id: eventId, event_time: 1, event: { type: 'app_mention', channel: 'C1', ts: '1.1', ...event } as SlackEventCallback['event'] });

test('Socket Mode: acks every envelope, dispatches events_api, rotates on disconnect, reconnects on close, stops cleanly', async t => {
  const received: { id: string; retryNum?: number }[] = [];
  const h = harness((envelope, meta) => { received.push({ id: envelope.event_id, ...(meta.retryNum ? { retryNum: meta.retryNum } : {}) }); });
  t.after(() => h.client.stop());
  await h.client.start();
  const first = h.sockets[0]!;
  first.emit('open');
  first.frame({ type: 'hello', num_connections: 1 });
  first.frame({ type: 'events_api', envelope_id: 'env-1', payload: callback('Ev1', {}), retry_attempt: 0 });
  first.frame({ type: 'events_api', envelope_id: 'env-2', payload: callback('Ev1', {}), retry_attempt: 1, retry_reason: 'timeout' });
  first.frame({ type: 'slash_commands', envelope_id: 'env-3', payload: {} });
  first.emit('message', 'not json');
  await tick();
  assert.deepEqual(first.acks(), ['env-1', 'env-2', 'env-3'], 'every envelope is acknowledged with its envelope_id');
  assert.deepEqual(received, [{ id: 'Ev1' }, { id: 'Ev1', retryNum: 1 }], 'only events_api reaches the handler; dedupe is the coordinator\'s (event_id)');

  // disconnect: a new connection opens and the old one closes without scheduling another.
  first.frame({ type: 'disconnect', reason: 'refresh_requested' });
  await tick();
  assert.equal(first.closed, true);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[1]!.url, 'wss://fake/2');

  // An unexpected close reconnects.
  h.sockets[1]!.close();
  await tick();
  assert.equal(h.sockets.length, 3);
  assert.ok(h.logs.some(l => l.step === 'closed' && l.reconnectInMs === 1));

  h.client.stop();
  await tick();
  assert.equal(h.sockets[2]!.closed, true);
  assert.equal(h.sockets.length, 3, 'no reconnect after stop');
});

test('Socket Mode: a bad app token fails start; transient open errors retry; apps.connections.open uses the app token', async () => {
  const fatal = harness(undefined, async () => { throw new SlackApiError('invalid_auth', false); });
  await assert.rejects(fatal.client.start(), { code: 'invalid_auth' });
  assert.deepEqual(fatal.logs.at(-1), { step: 'open_failed', error: 'invalid_auth', reconnectInMs: null });

  let calls = 0;
  const flaky = harness(undefined, async () => { if (++calls === 1) throw new SlackApiError('network_error', true); return 'wss://fake/ok'; });
  await flaky.client.start();
  await tick();
  assert.equal(flaky.sockets.length, 1);
  assert.equal(flaky.sockets[0]!.url, 'wss://fake/ok');
  flaky.client.stop();

  const seen: { url: string; auth: string }[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => { seen.push({ url, auth: (init.headers as Record<string, string>).Authorization! }); return Response.json(seen.length === 1 ? { ok: true, url: 'wss://wss.slack.invalid/link' } : { ok: false, error: 'missing_scope', needed: 'connections:write' }); }) as typeof fetch;
  assert.equal(await openSocketModeUrl('xapp-test-not-real', { fetch: fetchStub }), 'wss://wss.slack.invalid/link');
  assert.deepEqual(seen[0], { url: 'https://slack.com/api/apps.connections.open', auth: 'Bearer xapp-test-not-real' });
  const error = await openSocketModeUrl('xapp-test-not-real', { fetch: fetchStub }).then(() => undefined, (e: unknown) => e);
  assert.ok(error instanceof SlackApiError && error.code === 'missing_scope' && error.needed === 'connections:write');
  assert.ok(!(error as Error).message.includes('xapp-test-not-real'));
});

test('Socket Mode end to end with the unmapped-human fallback: Flow A reply once despite redelivery, Flow B answered by anyone in the channel', async t => {
  const store = new MemoryLedgerStore();
  t.after(() => store.close());
  const context = { projectId: 'live', targetProductId: 'p' };
  const actor = { kind: 'human' as const, id: 'owner' };
  await store.append(([
    { ...context, actor, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '담당자' } },
    { ...context, actor, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' } },
    { ...context, actor, type: 'goal_set', payload: { text: '온보딩 개선', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...context, actor, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'r', approvedBy: 'owner', sourceMessageIds: [], tasks: [{ id: 'research', title: '인터뷰 정리', assignee: 'research-agent', dependsOn: [], handoffConditions: [] }] } },
  ] as NewLedgerEvent[]).map(e => ({ ...e, at: '2026-10-01T00:00:00.000Z' })));
  const slack = new FakeSlackApi({ userId: 'UBOT', botId: 'BBOT', teamId: 'T1' });
  // No team id, bot user id or user map in the settings: auth.test fills them, the fallback maps people to the decider.
  const binding = await slackBindingFromConfig({ channelId: 'C1', users: {} }, slack);
  assert.deepEqual(binding, { teamId: 'T1', channelId: 'C1', botUserId: 'UBOT', botId: 'BBOT', users: {}, unmappedHumans: 'goal_decider' });
  const llm: LlmProvider = { async complete(request) {
    const input = request.forceTool === 'slack_thread_reply' ? { text: '인터뷰 정리가 먼저예요. 시작해도 될까요?', kind: 'ask' } : { kind: 'decision', confirmed: ['시작'] };
    return { text: '', toolCalls: [{ name: request.forceTool!, input }], model: 'm', responseId: 'r', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const progress: string[] = [];
  const coordinator = new SlackCoordinator({ store, llm, model: 'm', api: slack, binding, context, onProgress: entry => progress.push(entry.step) });
  const pending: Promise<unknown>[] = [];
  const h = harness((envelope, meta) => { const p = coordinator.receive(envelope, meta); pending.push(p); return p; });
  t.after(() => h.client.stop());
  await h.client.start();
  const socket = h.sockets[0]!;

  // Flow A over the socket, delivered twice with the same event_id.
  const root = slack.add('C1', { user: 'UHUMAN', text: '<@UBOT> 다음 단계?' });
  const mention = callback('EvA', { user: 'UHUMAN', text: root.text, ts: root.ts });
  socket.frame({ type: 'events_api', envelope_id: 'e1', payload: mention });
  socket.frame({ type: 'events_api', envelope_id: 'e2', payload: mention, retry_attempt: 1 });
  await tick(); await Promise.all(pending);
  assert.equal(slack.posts.length, 1);
  assert.equal(slack.posts[0]!.threadTs, root.ts);
  let c = externalConversation(await store.read({ projectId: 'live' }) as AnyEvent[]);
  assert.deepEqual(c.messages[0]!.author, { kind: 'human', externalUserId: 'UHUMAN', memberId: 'owner' }, 'unmapped human counts as the goal decider');

  // Flow B: no Slack account for the decider, so the PM addresses them by name and anyone in the thread may answer.
  await store.append([{ ...context, actor: { kind: 'system', id: 'session-runner' }, type: 'task_blocked', payload: { taskId: 'research', reason: '응답자 부족' } }]);
  const [sent] = await coordinator.syncSpaceChanges();
  assert.equal(sent!.kind, 'sent');
  assert.match(slack.posts[1]!.text, /^담당자님, 조사 Agent가 "인터뷰 정리" 작업에서 막혔어요/);
  c = externalConversation(await store.read({ projectId: 'live' }) as AnyEvent[]);
  const request = [...c.requests.values()].find(r => r.request.reason === 'agent_blocker')!;
  assert.equal(request.request.target.externalUserId, ANY_SLACK_HUMAN);
  const ts = slack.posts[1]!.ts;
  socket.frame({ type: 'events_api', envelope_id: 'e3', payload: { ...callback('EvB', { type: 'message', user: 'UOTHER', text: '3명만 더 모으고 진행', ts: `${Number(ts) + 1}.000100`, thread_ts: ts }) } });
  await tick(); await Promise.all(pending);
  c = externalConversation(await store.read({ projectId: 'live' }) as AnyEvent[]);
  assert.equal(c.requests.get(request.request.requestId)!.status, 'answered');
  assert.deepEqual(c.requests.get(request.request.requestId)!.reply?.taskIds, ['research']);
  for (const step of ['event_received', 'thread_read', 'reply_posted', 'request_sent', 'reply_recorded', 'event_skipped']) assert.ok(progress.includes(step), step);
});
