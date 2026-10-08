import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { project, type NewLedgerEvent } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import {
  FakeFigma, FigmaApiError, FigmaBridge, FigmaRestClient, figmaSpaceItems, parseFigmaLink, pmTag,
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
