import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { project, type NewLedgerEvent } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import {
  FakeFigma, FigmaApiError, FigmaBridge, FigmaRestClient, composeMentionAnswer, figmaMentionItems, figmaSpaceItems, mentionIdFor, mentionTriggers,
  parseFigmaLink, pmTag, spaceContextItems,
} from '../packages/orchestrator/src/figma/index.ts';

// Only Figma is fake: the bridge, its ledger records and the Space projection are real.
const FILE = 'AbCdEf1234567890';
const URL_WITH_FRAME = `https://www.figma.com/design/${FILE}/Checkout?node-id=12-34&t=x`;
const designer = { id: 'figma-designer', handle: 'Mina' };
const context = { projectId: 'space-a', targetProductId: 'product' };

async function fixture(options: { nodes?: { id: string; name: string; type: string }[] } = {}) {
  const store = new MemoryLedgerStore();
  const owner = { kind: 'human' as const, id: 'owner' };
  const seed: NewLedgerEvent[] = [
    ...([['owner', 'human'], ['mina', 'human'], ['mina-agent', 'agent']] as const).map(([id, kind]) => ({ ...context, actor: owner, type: 'member_joined', payload: { memberId: id, kind, displayName: id } })),
    { ...context, actor: owner, type: 'goal_set', payload: { text: '가입 전환율을 높이는 결제 화면', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...context, actor: owner, type: 'decision_recorded', payload: { decisionId: 'd-coupon', summary: '쿠폰 입력은 결제 화면에서 뺀다', sourceMessageIds: [], approvedBy: 'owner', changeKinds: ['scope_reduce'] } },
  ];
  await store.append(seed);
  const figma = new FakeFigma().addFile(FILE, 'Checkout', options.nodes ?? [{ id: '12:34', name: 'Checkout / Mobile', type: 'FRAME' }]);
  let tick = 0;
  const bridge = new FigmaBridge({ ...context, store, client: figma, clock: () => new Date(Date.UTC(2026, 9, 7, 1, 0, tick++)) });
  const events = () => store.read({ projectId: context.projectId });
  const posts = () => figma.calls.filter(c => c.op === 'postComment').length;
  return { store, figma, bridge, events, posts };
}
const share = (f: Awaited<ReturnType<typeof fixture>>, url = URL_WITH_FRAME) =>
  f.bridge.shareLink({ url, question: '모바일 결제 버튼을 하단 고정으로 바꿔도 될까요?', sharedBy: 'mina-agent', onBehalfOf: 'mina' });

test('Figma links resolve to file key and API node id; other hosts and malformed nodes are refused', () => {
  assert.deepEqual(parseFigmaLink(URL_WITH_FRAME), { kind: 'design', fileKey: FILE, nodeId: '12:34', url: URL_WITH_FRAME });
  assert.equal(parseFigmaLink(`https://figma.com/file/${FILE}/Old?node-id=1%3A2`)?.nodeId, '1:2');
  assert.equal(parseFigmaLink(`https://www.figma.com/design/${FILE}/branch/BrAnCh123456/Name?node-id=I1-2;3-4`)?.fileKey, 'BrAnCh123456');
  assert.equal(parseFigmaLink(`https://www.figma.com/design/${FILE}/branch/BrAnCh123456/Name?node-id=I1-2;3-4`)?.nodeId, 'I1:2;3:4');
  assert.equal(parseFigmaLink(`https://www.figma.com/design/${FILE}/Name`)?.nodeId, undefined);
  assert.equal(parseFigmaLink(`https://evil.example/design/${FILE}/Name`), null);
  assert.equal(parseFigmaLink(`http://www.figma.com/design/${FILE}/Name`), null);
  assert.equal(parseFigmaLink(`https://www.figma.com/design/${FILE}/Name?node-id=abc`), null);
  assert.equal(parseFigmaLink('not a url'), null);
});

test('one round trip: share → inspect → tagged frame comment → reply becomes a claimed Space follow-up, once', async () => {
  const f = await fixture();
  const before = f.figma.addComment(FILE, designer, '여기 버튼 색 확정인가요?', undefined, '12:34');
  const shared = await share(f);
  assert.equal((await share(f)).duplicate, true, 're-received share is the same request');
  assert.equal((await f.events()).filter(e => e.type === 'figma_request_opened').length, 1);
  assert.equal((await f.events()).find(e => e.type === 'figma_request_opened')?.actor.id, 'mina-agent');

  const inspected = await f.bridge.inspect(shared.requestId);
  assert.equal(inspected.status, 'inspected');
  assert.deepEqual(inspected.inspection?.nodes, [{ id: '12:34', found: true, name: 'Checkout / Mobile', type: 'FRAME' }]);
  assert.equal(inspected.inspection?.version, '1');
  assert.ok(inspected.inspection?.lastModified && inspected.inspection.observedAt);
  assert.deepEqual(inspected.inspection?.relatedCommentIds, [before.id]);
  assert.deepEqual(inspected.inspection?.space, { goal: '가입 전환율을 높이는 결제 화면', decisionIds: ['d-coupon'] });
  assert.equal(inspected.inspection?.pm.id, 'user-account', 'the PM acts through the user’s own account');

  const [delivered, again] = await Promise.all([f.bridge.deliver(shared.requestId), f.bridge.deliver(shared.requestId)]);
  assert.equal(f.posts(), 1, 'concurrent delivery posts once');
  assert.equal(delivered.status, 'awaiting_reply');
  assert.equal(again.delivery?.commentId, delivered.delivery?.commentId);
  const pmComment = f.figma.commentsOf(FILE).find(c => c.id === delivered.delivery?.commentId)!;
  assert.equal(pmComment.nodeId, '12:34');
  assert.ok(pmComment.message.includes(pmTag(shared.requestId)) && pmComment.message.includes('Space space-a'));
  assert.ok(pmComment.message.includes('모바일 결제 버튼') && pmComment.message.includes('파일 버전 1'));
  await f.bridge.deliver(shared.requestId);
  assert.equal(f.posts(), 1, 'delivered request never posts again');

  assert.equal((await f.bridge.pollReplies(shared.requestId)).newReplies, 0);
  const reply = f.figma.addComment(FILE, designer, '네, 하단 고정으로 바꾸겠습니다. 오늘 반영할게요.', pmComment.id);
  const polled = await f.bridge.pollReplies(shared.requestId);
  assert.deepEqual([polled.newReplies, polled.skippedOwn], [1, 0]);
  assert.equal(polled.view.status, 'reply_received');
  assert.deepEqual(polled.view.replies.map(r => [r.commentId, r.parentId, r.author.id]), [[reply.id, pmComment.id, 'figma-designer']]);
  const followUp = polled.view.followUps[0]!;
  assert.equal(followUp.verification, 'claimed', 'a reply is a claim, not an inspected change');
  const count = (await f.events()).length;
  const repoll = await f.bridge.pollReplies(shared.requestId);
  assert.deepEqual([repoll.newReplies, repoll.duplicates], [0, 1]);
  assert.equal((await f.events()).length, count, 're-polling writes nothing');

  assert.deepEqual(figmaSpaceItems(await f.events()).map(i => [i.status, i.followUps.map(x => [x.verification, x.author])]), [['reply_received', [['claimed', 'Mina']]]]);
  assert.equal((await f.bridge.recheck(followUp.followUpId)).verification, 'no_change_observed');
  f.figma.edit(FILE);
  const rechecked = await f.bridge.recheck(followUp.followUpId);
  assert.equal(rechecked.verification, 'file_changed_unconfirmed');
  assert.deepEqual([rechecked.recheck?.baselineVersion, rechecked.recheck?.observedVersion], ['1', '2']);
  const reported = await f.bridge.reportFollowUp(followUp.followUpId, { by: 'mina-agent', outcome: 'applied', note: '하단 고정 버튼으로 수정함' });
  assert.equal(reported.reports.length, 1);
  assert.equal(reported.verification, 'file_changed_unconfirmed', 'an Agent report does not upgrade verification');
  await f.bridge.reportFollowUp(followUp.followUpId, { by: 'mina-agent', outcome: 'applied', note: '하단 고정 버튼으로 수정함' });
  assert.equal((await f.bridge.view(shared.requestId)).followUps[0]?.reports.length, 1);
  await assert.rejects(f.bridge.reportFollowUp(followUp.followUpId, { by: 'stranger', outcome: 'blocked', note: 'x' }), { code: 'forbidden' });
});

test('Figma records leave the core Space projection untouched', async () => {
  const f = await fixture();
  const baseline = project(await f.events());
  const { requestId } = await share(f);
  await f.bridge.inspect(requestId); await f.bridge.deliver(requestId);
  const after = project(await f.events());
  assert.deepEqual([after.messages, after.tasks.size, after.decisions.size, after.automation], [baseline.messages, baseline.tasks.size, baseline.decisions.size, baseline.automation]);
});

test('access failure is recorded and blocks delivery; a missing frame is not commented on', async () => {
  const f = await fixture();
  const { requestId } = await share(f);
  f.figma.denied.add(FILE);
  const denied = await f.bridge.inspect(requestId);
  assert.equal(denied.status, 'access_failed');
  assert.deepEqual([denied.problem && 'stage' in denied.problem ? denied.problem.stage : '', denied.problem?.kind], ['file', 'forbidden']);
  await assert.rejects(f.bridge.deliver(requestId), { code: 'invalid_state' });
  f.figma.denied.delete(FILE);
  const ok = await f.bridge.inspect(requestId);
  assert.equal(ok.status, 'inspected');
  assert.equal(ok.problem, undefined);

  const g = await fixture({ nodes: [{ id: '99:1', name: 'Other', type: 'FRAME' }] });
  const missing = await share(g);
  assert.equal((await g.bridge.inspect(missing.requestId)).status, 'frame_not_found');
  await assert.rejects(g.bridge.deliver(missing.requestId), { code: 'invalid_state' });
  assert.equal(g.posts(), 0);

  const h = await fixture();
  const me = await share(h);
  h.figma.failNext('me', new FigmaApiError('unauthorized', 'Figma GET /v1/me → 401: Invalid token', 401));
  const noMe = await h.bridge.inspect(me.requestId);
  assert.deepEqual([noMe.status, noMe.problem?.kind], ['access_failed', 'unauthorized']);
});

test('a rejected write is a delivery failure, not a delivery; retry posts once', async () => {
  const f = await fixture();
  const { requestId } = await share(f);
  await f.bridge.inspect(requestId);
  f.figma.failNext('postComment', new FigmaApiError('forbidden', 'Figma POST → 403: missing file_comments:write', 403));
  const failed = await f.bridge.deliver(requestId);
  assert.equal(failed.status, 'delivery_failed');
  assert.equal(failed.delivery, undefined);
  assert.ok((await f.events()).some(e => e.type === 'figma_comment_attempted'), 'the drafted comment is recorded but is not delivery');
  assert.equal(f.figma.commentsOf(FILE).length, 0);
  const retried = await f.bridge.deliver(requestId);
  assert.equal(retried.status, 'awaiting_reply');
  assert.equal(f.figma.commentsOf(FILE).length, 1);
});

test('an unknown write outcome is reconciled against Figma before posting again', async () => {
  const f = await fixture();
  const { requestId } = await share(f);
  await f.bridge.inspect(requestId);
  f.figma.failNext('postComment', new FigmaApiError('network', 'socket hang up', undefined, true), true);
  assert.equal((await f.bridge.deliver(requestId)).status, 'delivery_unknown');
  const reconciled = await f.bridge.deliver(requestId);
  assert.deepEqual([reconciled.status, reconciled.delivery?.reconciled], ['awaiting_reply', true]);
  assert.equal(f.figma.commentsOf(FILE).length, 1, 'the landed comment is found, not duplicated');
  assert.equal(f.posts(), 1);

  const g = await fixture();
  const lost = await share(g);
  await g.bridge.inspect(lost.requestId);
  g.figma.failNext('postComment', new FigmaApiError('network', 'connect ECONNRESET', undefined, true));
  assert.equal((await g.bridge.deliver(lost.requestId)).status, 'delivery_unknown');
  g.figma.failNext('comments', new FigmaApiError('server', '502', 502));
  assert.equal((await g.bridge.deliver(lost.requestId)).status, 'delivery_unknown', 'cannot reconcile → does not post blindly');
  assert.equal(g.posts(), 1);
  const reposted = await g.bridge.deliver(lost.requestId);
  assert.deepEqual([reposted.status, reposted.delivery?.reconciled, g.figma.commentsOf(FILE).length], ['awaiting_reply', false, 1]);
});

test('PM and user share one Figma account: own comments are judged by ledger comment ids, human replies are kept', async () => {
  const f = await fixture();
  const { requestId } = await share(f);
  await f.bridge.inspect(requestId);
  const root = (await f.bridge.deliver(requestId)).delivery!.commentId;
  const other = await f.bridge.shareLink({ url: URL_WITH_FRAME, question: '두 번째 질문', sharedBy: 'mina-agent', onBehalfOf: 'mina' });
  await f.bridge.inspect(other.requestId);
  const otherRoot = (await f.bridge.deliver(other.requestId)).delivery!.commentId;
  f.figma.reparent(FILE, otherRoot, root);
  const plain = f.figma.addComment(FILE, f.figma.user, '(같은 계정의 디자이너) 프레임 1:2 버튼 색상은 유지, 라벨만 변경', root);
  const quoted = f.figma.addComment(FILE, f.figma.user, `${pmTag(requestId)} 이 요청 말씀이시죠? 반영할게요`, root);
  f.figma.addComment(FILE, designer, '다른 스레드 댓글');
  f.figma.addComment(FILE, f.figma.user, '(같은 계정) 태그 없는 새 최상위 댓글: 헤더도 바꿔 주세요', undefined, '12:34');
  f.figma.addComment(FILE, f.figma.user, `${pmTag(requestId)} 태그를 붙인 새 최상위 댓글`, undefined, '12:34');
  const polled = await f.bridge.pollReplies(requestId);
  assert.deepEqual([polled.newReplies, polled.skippedOwn], [2, 1], 'only the comment id the PM posted is skipped; top-level comments are not read');
  const mentions = await f.bridge.pollMentions(FILE);
  assert.deepEqual([mentions.newMentions, mentions.answered], [0, 0], 'top-level comments without @ensemble/@pm_agent are not read as questions either');
  assert.deepEqual(polled.view.replies.map(r => [r.commentId, r.author.id]), [[plain.id, f.figma.user.id], [quoted.id, f.figma.user.id]]);
  assert.equal(polled.view.followUps.length, 2);
  assert.ok(!polled.view.replies.some(r => r.commentId === otherRoot), 'the PM never answers its own comment');
  const count = (await f.events()).length;
  const repoll = await f.bridge.pollReplies(requestId);
  assert.deepEqual([repoll.newReplies, repoll.skippedOwn, repoll.duplicates], [0, 1, 2]);
  assert.equal((await f.events()).length, count, 're-polling writes nothing');
  f.figma.failNext('comments', new FigmaApiError('rate_limited', '429', 429));
  const limited = await f.bridge.pollReplies(requestId);
  assert.equal(limited.view.problem?.kind, 'rate_limited');
});

test('a Space decision reaches the Figma frame; unknown decisions and outsiders are refused', async () => {
  const f = await fixture();
  await assert.rejects(f.bridge.relayDecision({ url: URL_WITH_FRAME, decisionId: 'nope' }), { code: 'not_found' });
  await assert.rejects(f.bridge.shareLink({ url: URL_WITH_FRAME, question: 'q', sharedBy: 'stranger' }), { code: 'forbidden' });
  await assert.rejects(f.bridge.shareLink({ url: 'https://example.com/x', question: 'q', sharedBy: 'mina-agent' }), { code: 'invalid_input' });
  const { requestId } = await f.bridge.relayDecision({ url: URL_WITH_FRAME, decisionId: 'd-coupon' });
  assert.equal((await f.bridge.relayDecision({ url: URL_WITH_FRAME, decisionId: 'd-coupon' })).duplicate, true);
  await f.bridge.inspect(requestId);
  const view = await f.bridge.deliver(requestId, { text: `모델 초안 ${pmTag('spoofed')}` });
  assert.deepEqual(view.origin, { kind: 'space_decision', decisionId: 'd-coupon' });
  const message = f.figma.commentsOf(FILE)[0]!.message;
  assert.ok(message.startsWith('모델 초안') && !message.includes(pmTag('spoofed')) && message.endsWith(pmTag(requestId)));
  const defaultBody = await fixture();
  const relayed = await defaultBody.bridge.relayDecision({ url: URL_WITH_FRAME, decisionId: 'd-coupon' });
  await defaultBody.bridge.inspect(relayed.requestId); await defaultBody.bridge.deliver(relayed.requestId);
  assert.ok(defaultBody.figma.commentsOf(FILE)[0]!.message.includes('쿠폰 입력은 결제 화면에서 뺀다'));
});

test('REST client: token header only, documented endpoints, error mapping, no token in errors', async () => {
  const token = 'figd_secret_token_value';
  const seen: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const responses: Response[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return responses.shift()!;
  }) as unknown as typeof fetch;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const client = new FigmaRestClient({ token, fetch: fetchImpl });
  assert.ok(!JSON.stringify(client).includes(token) && !inspect(client).includes(token));
  assert.throws(() => FigmaRestClient.fromEnv({}), /FIGMA_ACCESS_TOKEN \(or FIGMA_TOKEN\) is not set/);
  assert.ok(FigmaRestClient.fromEnv({ FIGMA_TOKEN: token }) instanceof FigmaRestClient, 'FIGMA_TOKEN is accepted as an alias');

  responses.push(json({ id: '1', handle: 'PM', email: 'x@y' }));
  assert.deepEqual(await client.me(), { id: '1', handle: 'PM' });
  responses.push(json({ name: 'Checkout', lastModified: '2026-10-07T00:00:00Z', version: '42', nodes: { '12:34': { document: { id: '12:34', name: 'Mobile', type: 'FRAME' } }, '9:9': null } }));
  const file = await client.file(FILE, ['12:34', '9:9']);
  assert.deepEqual(file, { fileKey: FILE, name: 'Checkout', version: '42', lastModified: '2026-10-07T00:00:00Z', nodes: { '12:34': { id: '12:34', name: 'Mobile', type: 'FRAME' }, '9:9': null } });
  responses.push(json({ comments: [{ id: 'c2', parent_id: 'c1', user: { id: 'u', handle: 'Mina' }, message: 'ok', created_at: 't', resolved_at: null, client_meta: null }] }));
  assert.deepEqual(await client.comments(FILE), [{ id: 'c2', parentId: 'c1', user: { id: 'u', handle: 'Mina' }, message: 'ok', createdAt: 't' }]);
  responses.push(json({ id: 'c3', user: { id: '1', handle: 'PM' }, message: 'm', created_at: 't', client_meta: { node_id: '12:34', node_offset: { x: 0, y: 0 } } }));
  assert.equal((await client.postComment(FILE, { message: 'm', nodeId: '12:34' })).nodeId, '12:34');
  responses.push(json({ id: 'c4', parent_id: 'c3', user: { id: '1', handle: 'PM' }, message: 'r', created_at: 't' }));
  await client.postComment(FILE, { message: 'r', replyTo: 'c3', nodeId: '12:34' });

  assert.deepEqual(seen.map(s => `${s.method} ${s.url}`), [
    'GET https://api.figma.com/v1/me',
    `GET https://api.figma.com/v1/files/${FILE}/nodes?ids=12%3A34%2C9%3A9&depth=1`,
    `GET https://api.figma.com/v1/files/${FILE}/comments`,
    `POST https://api.figma.com/v1/files/${FILE}/comments`,
    `POST https://api.figma.com/v1/files/${FILE}/comments`,
  ]);
  assert.ok(seen.every(s => s.headers['X-Figma-Token'] === token && !s.url.includes(token)));
  assert.deepEqual(seen[3]?.body, { message: 'm', client_meta: { node_id: '12:34', node_offset: { x: 0, y: 0 } } });
  assert.deepEqual(seen[4]?.body, { message: 'r', comment_id: 'c3' });

  responses.push(json({ name: 'Checkout', version: '42', lastModified: 't', document: { children: [
    { id: '0:1', type: 'CANVAS', children: [{ id: '5:5', type: 'SECTION', name: 'S' }, { id: '7:7', type: 'FRAME', name: 'First frame' }] },
    { id: '0:2', type: 'CANVAS', children: [{ id: '8:8', type: 'FRAME', name: 'Page 2' }] },
  ] } }));
  assert.deepEqual(await client.firstFrame(FILE), { id: '7:7', name: 'First frame', type: 'FRAME' });
  assert.equal(seen.at(-1)?.url, `https://api.figma.com/v1/files/${FILE}?depth=2`);
  responses.push(json({ name: 'Empty', version: '1', lastModified: 't', document: { children: [{ id: '0:1', type: 'CANVAS', children: [] }] } }));
  assert.equal(await client.firstFrame(FILE), null);

  responses.push(json({ status: 403, err: 'Invalid token' }, 403));
  await assert.rejects(client.comments(FILE), (e: FigmaApiError) => e.kind === 'forbidden' && e.status === 403 && !e.ambiguous && !e.message.includes(token));
  responses.push(new Response('bad gateway', { status: 502 }));
  await assert.rejects(client.postComment(FILE, { message: 'm' }), (e: FigmaApiError) => e.kind === 'server' && e.ambiguous);
  responses.push(new Response('{}', { status: 429, headers: { 'retry-after': '30' } }));
  await assert.rejects(client.postComment(FILE, { message: 'm' }), (e: FigmaApiError) => e.kind === 'rate_limited' && !e.ambiguous && e.retryAfterSeconds === 30);
  const offline = new FigmaRestClient({ token, fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
  await assert.rejects(offline.postComment(FILE, { message: 'm' }), (e: FigmaApiError) => e.kind === 'network' && e.ambiguous && !e.message.includes(token));
  await assert.rejects(offline.comments(FILE), (e: FigmaApiError) => e.kind === 'network' && !e.ambiguous);
});

// Text-trigger context queries: `@ensemble` / `@pm_agent` arrive as plain text (Figma mentions resolve only to real users).
const answerOf = (f: Awaited<ReturnType<typeof fixture>>, commentId: string) => f.figma.commentsOf(FILE).find(c => c.id === commentId)!;

test('a top-level @ensemble comment is answered once on it, citing overlapping Space items with sources', async () => {
  const f = await fixture();
  const q = f.figma.addComment(FILE, designer, '@Ensemble 쿠폰 입력 관련해서 결정된 게 있어?', undefined, '12:34');
  f.figma.addComment(FILE, designer, '헤더 여백 좀 줄여도 될까요?', undefined, '12:34');
  const polled = await f.bridge.pollMentions(FILE);
  assert.deepEqual([polled.newMentions, polled.answered, polled.skippedOwn, polled.duplicates], [1, 1, 0, 0], 'only the mention-bearing comment is a question');
  const mention = polled.mentions[0]!;
  assert.equal(mention.mentionId, mentionIdFor(FILE, q.id));
  assert.deepEqual([mention.commentId, mention.rootId, mention.parentId, mention.nodeId, mention.author.id, mention.triggers], [q.id, q.id, undefined, '12:34', 'figma-designer', ['ensemble']]);
  assert.equal(mention.query, '쿠폰 입력 관련해서 결정된 게 있어?');
  assert.ok(mention.createdAt && mention.observedAt);
  const answer = answerOf(f, mention.answer!.commentId);
  assert.equal(answer.parentId, q.id, 'the answer is a reply on the question');
  assert.ok(answer.message.includes('[결정] 쿠폰 입력은 결제 화면에서 뺀다 — 출처: Space 결정 d-coupon'));
  assert.ok(answer.message.endsWith(`Space space-a ${pmTag(mention.mentionId)}`));
  assert.deepEqual([mention.answer?.selection, mention.answer?.citedItemIds[0], mention.answer?.reconciled], ['keyword', 'd-coupon', false]);

  const count = (await f.events()).length;
  const repoll = await f.bridge.pollMentions(FILE);
  assert.deepEqual([repoll.newMentions, repoll.answered, repoll.duplicates], [0, 0, 1]);
  assert.equal((await f.events()).length, count, 're-polling writes nothing');
  assert.equal(f.posts(), 1, 'answered once');
  assert.deepEqual(figmaMentionItems(await f.events()).map(i => [i.commentId, i.status, i.answerCommentId, i.author]), [[q.id, 'answered', mention.answer!.commentId, 'Mina']]);
});

test('a reply mention is answered on its thread root; @pm_agent; same account is human; the PM’s own comments never trigger', async () => {
  const f = await fixture();
  const { requestId } = await share(f);
  await f.bridge.inspect(requestId);
  const pmRoot = (await f.bridge.deliver(requestId)).delivery!.commentId;
  // Same Figma account as the PM (same-account premise): still a human question, because its id is not a PM id.
  const inPmThread = f.figma.addComment(FILE, f.figma.user, '확인했어요. @PM_AGENT 이 화면 목표가 뭐였죠?', pmRoot);
  const humanRoot = f.figma.addComment(FILE, designer, '여기 간격 이상해요', undefined, '12:34');
  const inHumanThread = f.figma.addComment(FILE, designer, '@ensemble 결제 버튼 쪽 남은 일 있나요?', humanRoot.id);
  f.figma.addComment(FILE, designer, '메일은 team@ensemble.com 으로, @ensembles 는 다른 팀');
  const relayed = await f.bridge.relayDecision({ url: URL_WITH_FRAME, decisionId: 'd-coupon' });
  await f.bridge.inspect(relayed.requestId);
  await f.bridge.deliver(relayed.requestId, { text: '@ensemble 인용: 쿠폰 입력 제거 결정을 전달합니다' });

  const polled = await f.bridge.pollMentions(FILE);
  assert.deepEqual([polled.newMentions, polled.answered, polled.skippedOwn], [2, 2, 1], 'the PM comment quoting @ensemble is skipped by its ledger id');
  const byComment = new Map(polled.mentions.map(m => [m.commentId, m]));
  const a = byComment.get(inPmThread.id)!;
  assert.deepEqual([a.rootId, a.parentId, a.triggers, a.author.id], [pmRoot, pmRoot, ['pm_agent'], f.figma.user.id]);
  assert.equal(answerOf(f, a.answer!.commentId).parentId, pmRoot, 'a reply mention is answered on the thread root');
  assert.ok(answerOf(f, a.answer!.commentId).message.includes('가입 전환율을 높이는 결제 화면'), 'the goal is cited');
  const b = byComment.get(inHumanThread.id)!;
  assert.equal(answerOf(f, b.answer!.commentId).parentId, humanRoot.id);
  assert.deepEqual(mentionTriggers('a@ensemble.com @ensembles (@ensemble) @ensemble.'), ['ensemble']);

  const count = (await f.events()).length;
  const again = await f.bridge.pollMentions(FILE);
  assert.deepEqual([again.newMentions, again.answered, again.duplicates, again.skippedOwn], [0, 0, 2, 1]);
  assert.equal((await f.events()).length, count);
  // A model-written answer that quotes @ensemble is still the PM's own (ledger id) and never re-triggers.
  const g = await fixture();
  g.figma.addComment(FILE, designer, '@ensemble 쿠폰?', undefined, '12:34');
  await g.bridge.pollMentions(FILE, { compose: () => '@ensemble 모델이 쓴 답: 쿠폰 입력은 뺐습니다' });
  const quoted = await g.bridge.pollMentions(FILE);
  assert.deepEqual([quoted.newMentions, quoted.skippedOwn, g.posts()], [0, 1, 1]);
  assert.equal(quoted.mentions[0]!.answer?.selection, 'caller');

  // The PM's answer inside its request thread is not a human reply; the human mention reply is.
  const replies = await f.bridge.pollReplies(requestId);
  assert.deepEqual([replies.newReplies, replies.skippedOwn], [1, 1]);
  assert.deepEqual(replies.view.replies.map(r => r.commentId), [inPmThread.id]);
});

test('answer delivery: a rejected write retries; an unknown write is reconciled by tag; a PM-signed comment never triggers', async () => {
  const f = await fixture();
  f.figma.addComment(FILE, designer, '@ensemble 쿠폰 결정?', undefined, '12:34');
  f.figma.failNext('postComment', new FigmaApiError('forbidden', 'Figma POST → 403', 403));
  const failed = await f.bridge.pollMentions(FILE);
  assert.deepEqual([failed.newMentions, failed.answered, failed.mentions[0]?.status, failed.mentions[0]?.problem?.kind], [1, 0, 'answer_failed', 'forbidden']);
  const retried = await f.bridge.pollMentions(FILE);
  assert.deepEqual([retried.newMentions, retried.answered, retried.mentions[0]?.status], [0, 1, 'answered']);
  assert.equal(f.figma.commentsOf(FILE).length, 2);

  const g = await fixture();
  const q = g.figma.addComment(FILE, designer, '@ensemble 쿠폰 결정?', undefined, '12:34');
  g.figma.failNext('postComment', new FigmaApiError('network', 'socket hang up', undefined, true), true);
  const unknown = await g.bridge.pollMentions(FILE);
  assert.equal(unknown.mentions[0]?.status, 'answer_unknown');
  g.figma.failNext('comments', new FigmaApiError('rate_limited', '429', 429));
  assert.ok((await g.bridge.pollMentions(FILE)).problem?.includes('429'));
  g.figma.failNext('comments', new FigmaApiError('server', '502', 502));
  assert.equal((await g.bridge.answerMention(mentionIdFor(FILE, q.id))).status, 'answer_unknown', 'cannot read the thread → does not post blindly');
  const reconciled = await g.bridge.pollMentions(FILE);
  assert.deepEqual([reconciled.answered, reconciled.mentions[0]?.status, reconciled.mentions[0]?.answer?.reconciled], [1, 'answered', true]);
  assert.deepEqual([g.posts(), g.figma.commentsOf(FILE).length], [1, 2], 'the landed answer is found, not duplicated');

  // A PM write with an unknown outcome is not in the ledger yet; its signature line still marks it as the PM's.
  const h = await fixture();
  const { requestId } = await share(h);
  await h.bridge.inspect(requestId);
  h.figma.failNext('postComment', new FigmaApiError('network', 'socket hang up', undefined, true), true);
  assert.equal((await h.bridge.deliver(requestId, { text: '@ensemble 가 확인 중입니다' })).status, 'delivery_unknown');
  const scan = await h.bridge.scanMentions(FILE);
  assert.deepEqual([scan.fresh.length, scan.skippedOwn], [0, 1]);
  assert.deepEqual([(await h.bridge.pollMentions(FILE)).newMentions, h.posts()], [0, 1]);

  // An answer of unknown outcome landing in a PM request thread is not taken as a human reply before it is reconciled.
  const k = await fixture();
  const asked = await share(k);
  await k.bridge.inspect(asked.requestId);
  const pmRoot = (await k.bridge.deliver(asked.requestId)).delivery!.commentId;
  const human = k.figma.addComment(FILE, k.figma.user, '@ensemble 쿠폰 결정 있었나요?', pmRoot);
  k.figma.failNext('postComment', new FigmaApiError('server', '502', 502, true), true);
  assert.equal((await k.bridge.pollMentions(FILE)).mentions[0]?.status, 'answer_unknown');
  const replies = await k.bridge.pollReplies(asked.requestId);
  assert.deepEqual([replies.newReplies, replies.skippedOwn, replies.view.replies.map(r => r.commentId)], [1, 1, [human.id]]);
});

test('no self-echo or double answer: unrecorded PM comments, a concurrent unknown write, a clean failure after an unknown one', async () => {
  // (1) A PM-signed comment with no recorded id (e.g. a duplicate answer) in a request thread is never a human follow-up.
  const f = await fixture();
  const asked = await share(f);
  await f.bridge.inspect(asked.requestId);
  const pmRoot = (await f.bridge.deliver(asked.requestId)).delivery!.commentId;
  f.figma.addComment(FILE, f.figma.user, `중복 답변\n\n— Ensemble PM Agent · Space space-a ${pmTag('figma-mention-0000000000000000')}`, pmRoot);
  const replies = await f.bridge.pollReplies(asked.requestId);
  assert.deepEqual([replies.newReplies, replies.skippedOwn, replies.view.followUps.length], [0, 1, 0]);
  assert.ok(!spaceContextItems(await f.events()).some(i => i.source.startsWith('Figma 요청')), 'no open item from the PM’s own text');

  // (2) An answer attempt that ends unknown while the poll composes is reconciled against a fresh list, not the poll's stale one.
  const g = await fixture();
  g.figma.addComment(FILE, designer, '@ensemble 쿠폰 결정?', undefined, '12:34');
  const polled = await g.bridge.pollMentions(FILE, { compose: async mention => {
    g.figma.failNext('postComment', new FigmaApiError('network', 'socket hang up', undefined, true), true);
    assert.equal((await g.bridge.answerMention(mention.mentionId)).status, 'answer_unknown');
    return undefined;
  } });
  assert.deepEqual([polled.answered, polled.mentions[0]?.answer?.reconciled, g.posts(), g.figma.commentsOf(FILE).length], [1, true, 1, 2]);

  // (3) A clean failure after an unknown attempt does not clear "needs reconcile": the late-landing first write is found.
  const h = await fixture();
  const root = h.figma.addComment(FILE, designer, '@ensemble 쿠폰 결정?', undefined, '12:34');
  const mentionId = mentionIdFor(FILE, root.id);
  h.figma.failNext('postComment', new FigmaApiError('network', 'socket hang up', undefined, true));
  assert.equal((await h.bridge.pollMentions(FILE)).mentions[0]?.status, 'answer_unknown');
  h.figma.failNext('postComment', new FigmaApiError('forbidden', '403', 403));
  const failed = await h.bridge.answerMention(mentionId);
  assert.deepEqual([failed.status, !!failed.unconfirmedAttemptId, h.posts()], ['answer_failed', true, 2]);
  h.figma.addComment(FILE, h.figma.user, `늦게 보인 첫 답\n\n— Ensemble PM Agent · Space space-a ${pmTag(mentionId)}`, root.id);
  const reconciled = await h.bridge.answerMention(mentionId);
  assert.deepEqual([reconciled.status, reconciled.answer?.reconciled, reconciled.unconfirmedAttemptId, h.posts()], ['answered', true, undefined, 2]);
});

test('answer context: Space goal, decisions and open items from Space, meeting, Slack and Figma, with sources; fallback without overlap', async () => {
  const f = await fixture();
  const actor = { kind: 'pm' as const, id: 'pm' };
  await f.store.append([
    { ...context, actor, type: 'pm_considered', payload: { considerationId: 'c-1', triggerId: 't', whoseAction: null, alreadyKnows: 'unknown', evidence: [], decision: 'silent', reason: 'r', openTopics: ['배송비 표기 위치 미정'] } },
    { ...context, actor, type: 'meeting_note_recorded', payload: { noteId: 'note-1', meetingId: 'meet-1', kind: 'open', text: '결제 버튼 문구 확정 필요', author: { kind: 'pm', id: 'pm' }, source: {}, observedAt: 't' } },
    { ...context, actor, type: 'external_message_observed', payload: { messageId: 'slack-1', source: { provider: 'slack', workspaceId: 'T', channelId: 'C1', messageTs: '1.2' }, author: { kind: 'human', externalUserId: 'U', memberId: 'owner' }, text: '결제 버튼은 파란색 유지', postedAt: 't', kind: 'decision', remaining: ['버튼 아이콘 여부'] } },
  ] as NewLedgerEvent[]);
  const items = spaceContextItems(await f.events());
  const sources = new Map(items.map(i => [i.id, `${i.kind}|${i.source}`]));
  assert.equal(sources.get('d-coupon'), 'decision|Space 결정 d-coupon');
  assert.equal(sources.get('note-1'), 'open|회의 meet-1 기록 note-1');
  assert.equal(sources.get('slack-1'), 'decision|Slack C1 1.2 (메시지 slack-1)');
  assert.equal(sources.get('slack-1#1'), 'open|Slack C1 1.2 (메시지 slack-1) 남은 일');
  assert.equal(sources.get('c-1#1'), 'open|PM 미해결 주제 (pm_considered c-1)');
  assert.equal(sources.get('goal'), 'goal|Space 목표 (goal_set, 결정권자 owner)');

  const keyword = composeMentionAnswer('space-a', { mentionId: 'm', query: '결제 버튼 어떻게 하기로 했어?' }, items);
  assert.equal(keyword.selection, 'keyword');
  assert.deepEqual(keyword.citedItemIds.slice(0, 2).sort(), ['note-1', 'slack-1'], 'items sharing more words rank first');
  const fallback = composeMentionAnswer('space-a', { mentionId: 'm', query: '로그인 흐름은?' }, items);
  assert.equal(fallback.selection, 'fallback');
  assert.ok(fallback.citedItemIds.includes('d-coupon') && fallback.citedItemIds.includes('goal') && fallback.citedItemIds.length <= 6);
  assert.ok(fallback.message.includes('겹치는 항목이 없어'));

  // An open Figma follow-up (a reply to a PM comment) is an open item with its request and reply ids.
  const { requestId } = await share(f);
  await f.bridge.inspect(requestId);
  const root = (await f.bridge.deliver(requestId)).delivery!.commentId;
  const reply = f.figma.addComment(FILE, designer, '하단 고정 버튼은 다음 주 반영', root);
  await f.bridge.pollReplies(requestId);
  const followUp = spaceContextItems(await f.events()).find(i => i.source.startsWith('Figma 요청'));
  assert.deepEqual([followUp?.kind, followUp?.source], ['open', `Figma 요청 ${requestId} · 답글 ${reply.id}`]);
});

test('a designer Agent’s canvas change report is a claim; the PM re-reads the file version', async () => {
  const f = await fixture();
  const { requestId } = await f.bridge.relayDecision({ url: URL_WITH_FRAME, decisionId: 'd-coupon' });
  await f.bridge.inspect(requestId); await f.bridge.deliver(requestId);
  const q = f.figma.addComment(FILE, designer, '@ensemble 쿠폰 결정?', undefined, '12:34');
  await f.bridge.pollMentions(FILE);
  const mentionId = mentionIdFor(FILE, q.id);
  await assert.rejects(f.bridge.reportChange({ by: 'stranger', summary: 'x', requestId }), { code: 'forbidden' });
  await assert.rejects(f.bridge.reportChange({ by: 'mina-agent', summary: 'x' }), { code: 'invalid_input' });
  const report = await f.bridge.reportChange({ by: 'mina-agent', summary: '쿠폰 입력 칸을 프레임에서 제거함', url: URL_WITH_FRAME, requestId, mentionId });
  assert.deepEqual([report.verification, report.baseline?.version, report.nodeId, report.mentionId], ['claimed', '1', '12:34', mentionId]);
  assert.equal((await f.bridge.reportChange({ by: 'mina-agent', summary: '쿠폰 입력 칸을 프레임에서 제거함', url: URL_WITH_FRAME, requestId, mentionId })).reportId, report.reportId, 'same report recorded once');
  assert.equal((await f.events()).filter(e => e.type === 'figma_change_reported').length, 1);
  assert.equal((await f.events()).find(e => e.type === 'figma_change_reported')?.actor.id, 'mina-agent');
  assert.equal((await f.bridge.recheckChange(report.reportId)).recheck?.verification, 'no_change_observed');
  f.figma.edit(FILE);
  const changed = await f.bridge.recheckChange(report.reportId);
  assert.deepEqual([changed.verification, changed.recheck?.verification, changed.recheck?.baselineVersion, changed.recheck?.observedVersion], ['claimed', 'file_changed_unconfirmed', '1', '2']);
  const noBase = await fixture();
  const lone = await noBase.bridge.reportChange({ by: 'mina-agent', summary: '버튼 라벨 변경', url: URL_WITH_FRAME });
  assert.equal((await noBase.bridge.recheckChange(lone.reportId)).recheck?.verification, 'no_baseline');
});
