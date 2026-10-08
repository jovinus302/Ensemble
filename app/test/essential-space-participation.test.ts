import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { LocalFolderWorkspace, WorkspaceAccessError, type DeliveryResult, type PersonalRequest, type PersonalWorkspace, type WorkspaceFs, type WorkspaceInspection } from '@ensemble/agents';
import { MAX_REQUEST_DEPTH, participation, project, type AnyEvent, type NewLedgerEvent, type ParticipationPayloads } from '@ensemble/core';
import { ParticipationError, SpaceParticipation, spaceContextMarkdown, type ComposeInput, type LinkInput, type RequestComposer } from '@ensemble/orchestrator';
import { MemoryLedgerStore } from '@ensemble/store';

// Only the person's environment can be fake (FakeWorkspace); folder tests use a real temporary directory.
class FakeWorkspace implements PersonalWorkspace {
  mode: 'ok' | 'disconnected' | 'denied' = 'ok';
  delivered: PersonalRequest[] = [];
  inspections = 0;
  async inspect(): Promise<WorkspaceInspection> {
    if (this.mode === 'disconnected') throw new WorkspaceAccessError('unreachable', '작업 폴더에 접근할 수 없습니다');
    this.inspections++;
    return { files: [{ path: 'notes.md', sha256: 'a'.repeat(64), bytes: 5, mtime: '2026-10-07T00:00:00.000Z', content: 'hello' }], rejected: [], truncated: false };
  }
  async deliverRequest(request: PersonalRequest): Promise<DeliveryResult> {
    if (this.mode === 'disconnected') return { delivered: false, reason: 'unreachable', detail: 'offline' };
    if (this.mode === 'denied') return { delivered: false, reason: 'permission_denied', detail: 'EACCES' };
    if (!this.delivered.some(r => r.requestId === request.requestId)) this.delivered.push(request);
    return { delivered: true, location: `fake://${request.requestId}` };
  }
  async status() { return { reachable: this.mode === 'ok', root: 'fake' }; }
}

async function fixture(t: TestContext, options: { workspace?: PersonalWorkspace; composer?: RequestComposer; root?: string } = {}) {
  const store = new MemoryLedgerStore();
  const context = { projectId: 'project-a', targetProductId: 'product' };
  const owner = { kind: 'human' as const, id: 'owner' };
  const composed: ComposeInput[] = [];
  const composer: RequestComposer = options.composer ?? (async input => { composed.push(input); return input.trigger.inReplyTo && input.trigger.kind === 'result' && input.depth > MAX_REQUEST_DEPTH + 5 ? null : `PM 후속 요청 (${input.trigger.text})`; });
  const workspace = options.workspace ?? new FakeWorkspace();
  const space = new SpaceParticipation({ ...context, store, composer, ...(options.root ? {} : { workspaceFor: () => workspace }), defaultSpaceUrl: 'http://space.test' });
  const seed: NewLedgerEvent[] = [
    { ...context, actor: owner, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...context, actor: owner, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' } },
    { ...context, actor: owner, type: 'goal_set', payload: { text: '로그인 폼 문구 정리', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...context, actor: owner, type: 'decision_recorded', payload: { decisionId: 'd1', summary: '이메일 로그인만 지원한다', sourceMessageIds: [], approvedBy: 'owner', changeKinds: [] } },
    { ...context, actor: owner, type: 'plan_committed', payload: { version: 1, basedOn: null, reason: 'ok', approvedBy: 'owner', sourceMessageIds: [], tasks: [{ id: 'copy', title: '문구 정리', assignee: 'research-agent', dependsOn: [], handoffConditions: [] }] } },
  ];
  await store.append(seed);
  const root = options.root ?? path.join(tmpdir(), 'unused-root');
  const token = await link(space, { participantId: 'my-codex', displayName: '내 Codex', tool: 'codex', workspaceRoot: root });
  const events = async () => await store.read({ projectId: context.projectId }) as AnyEvent[];
  t.after(() => store.close());
  return { store, space, workspace, composed, events, context, token };
}
/** The person asks to link and confirms with the one-time code (shown only on the server console); returns the agent's token. */
async function link(space: SpaceParticipation, input: LinkInput, by = 'owner') {
  const requested = await space.requestLink(input, by);
  return (await space.confirmLink(requested.linkRequestId, requested.code, by)).token;
}
const of = <K extends AnyEvent['type']>(events: AnyEvent[], type: K) => events.filter((e): e is Extract<AnyEvent, { type: K }> => e.type === type);

test('a person links an existing agent; the agent reads goals, decisions and open work as Markdown or JSON, and the read is recorded', async t => {
  const { space, store, events, context, token } = await fixture(t);
  await assert.rejects(space.requestLink({ participantId: 'x', displayName: 'x', tool: 'codex', workspaceRoot: tmpdir() }, 'research-agent'), /사람만/);
  await assert.rejects(space.requestLink({ participantId: 'owner', displayName: 'x', tool: 'codex', workspaceRoot: tmpdir() }, 'owner'), /멤버와 같은 id/);
  await assert.rejects(space.requestLink({ participantId: 'y', displayName: 'y', tool: 'codex', workspaceRoot: 'relative/dir' }, 'owner'), /절대 경로/);
  const json = await space.readContext('my-codex', token, 'json');
  assert.equal(json.project.goal, '로그인 폼 문구 정리');
  assert.deepEqual(json.decisions.map(d => d.summary), ['이메일 로그인만 지원한다']);
  assert.deepEqual(json.tasks.map(t => t.title), ['문구 정리']);
  assert.equal(json.howToPost.url, 'http://space.test/api/space/participants/my-codex/posts');
  const md = spaceContextMarkdown(await space.readContext('my-codex', token, 'md'));
  assert.match(md, /목표: 로그인 폼 문구 정리/);
  assert.match(md, /POST http:\/\/space\.test\/api\/space\/participants\/my-codex\/posts/);
  const reads = of(await events(), 'space_context_read');
  assert.deepEqual(reads.map(r => [r.actor.kind, r.actor.id, r.payload.format]), [['agent', 'my-codex', 'json'], ['agent', 'my-codex', 'md']]);
  // A participant is not a project member: the PM never plans work onto it.
  assert.equal(project(await events()).members.has('my-codex'), false);
  await store.append([{ ...context, actor: { kind: 'human', id: 'owner' }, type: 'participant_linked', payload: { ...(of(await events(), 'participant_linked')[0]!.payload), scopes: { readSpace: false, post: true, receiveRequests: true, pmReadWorkspace: true } } }]);
  await assert.rejects(space.readContext('my-codex', token, 'md'), /읽기 권한/);
});

test('a repeated share is one post, and author, source and observation time are kept', async t => {
  const { space, events, token } = await fixture(t);
  const first = await space.post('my-codex', token, { kind: 'result', text: '문구 초안을 README에 반영했습니다', clientPostId: 'share-1', taskId: 'copy' });
  const again = await space.post('my-codex', token, { kind: 'result', text: '문구 초안을 README에 반영했습니다', clientPostId: 'share-1', taskId: 'copy' });
  assert.equal(first.duplicate, false);
  assert.deepEqual(again, { postId: first.postId, duplicate: true });
  const posts = of(await events(), 'space_post_recorded');
  assert.equal(posts.length, 1);
  const [post] = posts;
  assert.deepEqual(post!.actor, { kind: 'agent', id: 'my-codex' });
  assert.equal(post!.idempotencyKey, 'space-post:my-codex:share-1');
  assert.deepEqual(post!.payload.source, { tool: 'codex', workspaceRoot: path.join(tmpdir(), 'unused-root'), via: 'space_http' });
  assert.equal(post!.payload.taskId, 'copy');
  assert.ok(Number.isFinite(Date.parse(post!.payload.observedAt)));
  await assert.rejects(space.post('my-codex', token, { kind: 'result', text: 'x', clientPostId: 'share-2', taskId: 'missing' }), /작업을 찾지/);
  await assert.rejects(space.post('my-codex', token, { kind: 'result', text: 'x', clientPostId: 'share-3', inReplyTo: 'req-unknown' }), /요청을 찾지/);
  await assert.rejects(space.post('nobody', token, { kind: 'note', text: 'x', clientPostId: 'a' }), /찾지 못했습니다/);
});

test('folder inspection stays inside the granted paths: outside paths, link escapes and oversized files are refused', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'ensemble-personal-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'), outside = path.join(base, 'outside');
  await mkdir(path.join(root, 'src'), { recursive: true }); await mkdir(outside);
  await writeFile(path.join(root, 'README.md'), '# private readme');
  await writeFile(path.join(root, 'src', 'login.txt'), '로그인 문구 초안입니다. 길게 이어지는 내용');
  await writeFile(path.join(root, 'src', 'big.bin'), Buffer.alloc(4096, 1));
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  // A junction needs no admin rights on Windows; elsewhere it is a plain directory symlink.
  await symlink(outside, path.join(root, 'src', 'escape'), 'junction');
  const workspace = new LocalFolderWorkspace({ root, allowedPaths: ['src'], maxFileBytes: 12, maxHashBytes: 1024 });
  const full = await workspace.inspect();
  assert.deepEqual(full.files.map(f => f.path), ['src/login.txt']);
  assert.equal(full.files[0]!.contentTruncated, true);
  assert.ok(Buffer.byteLength(full.files[0]!.content!) <= 12);
  assert.match(full.files[0]!.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(full.rejected.map(r => r.path), ['src/big.bin']);
  const named = await workspace.inspect(['README.md', '../outside/secret.txt', 'src/escape/secret.txt', 'src/login.txt']);
  assert.deepEqual(named.files.map(f => f.path), ['src/login.txt']);
  assert.deepEqual(named.rejected.map(r => [r.path, r.reason]), [
    ['README.md', '허용된 경로가 아닙니다'], ['../outside/secret.txt', '작업 폴더 밖을 가리킵니다'], ['src/escape/secret.txt', '작업 폴더 밖을 가리킵니다'],
  ]);
  assert.throws(() => new LocalFolderWorkspace({ root, allowedPaths: ['../outside'] }), /inside the workspace root/);
  await assert.rejects(new LocalFolderWorkspace({ root: path.join(base, 'missing') }).inspect(), (error: unknown) => error instanceof WorkspaceAccessError && error.reason === 'unreachable');

  // Through the participation path the PM records metadata only, and later reads report what changed.
  const { space, events } = await fixture(t, { root });
  await link(space, { participantId: 'my-codex', displayName: '내 Codex', tool: 'codex', workspaceRoot: root, allowedPaths: ['src'] });
  const first = await space.inspect('my-codex');
  await writeFile(path.join(root, 'src', 'login.txt'), '바뀐 문구');
  await writeFile(path.join(root, 'src', 'new.txt'), '새 파일');
  const second = await space.inspect('my-codex');
  assert.deepEqual(first.observation.changes.added, ['src/big.bin', 'src/login.txt']);
  assert.deepEqual(second.observation.changes, { added: ['src/new.txt'], modified: ['src/login.txt'], removed: [] });
  const observed = of(await events(), 'workspace_context_observed');
  assert.equal(observed.length, 2);
  assert.equal(observed[1]!.actor.kind, 'pm');
  assert.equal(observed[1]!.payload.source, 'local_workspace');
  assert.ok(!JSON.stringify(observed).includes('바뀐 문구'), 'file contents stay out of the ledger');
});

test('a request lands as one inbox file in the real folder and touches nothing else there', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-inbox-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'README.md'), '# my project');
  const { space, events } = await fixture(t, { root });
  const created = await space.createRequest({ participantId: 'my-codex', text: 'README의 로그인 문구를 이메일 기준으로 고쳐 주세요.', actor: { kind: 'human', id: 'owner' }, taskId: 'copy' });
  assert.equal(created.delivery && 'location' in created.delivery, true);
  const location = path.join(root, '.ensemble', 'inbox', `${created.requestId}.md`);
  const file = await readFile(location, 'utf8');
  assert.match(file, new RegExp(`^---\\nrequestId: "${created.requestId}"\\nproject: "project-a"`));
  assert.match(file, new RegExp(`inReplyTo: "${created.requestId}"`));
  assert.match(file, /replyUrl: "http:\/\/space\.test\/api\/space\/participants\/my-codex\/posts"/);
  assert.match(file, /README의 로그인 문구를 이메일 기준으로/);
  assert.deepEqual((await readdir(root)).sort(), ['.ensemble', 'README.md']);
  assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), '# my project');
  // Delivering again neither rewrites the file nor records a second delivery.
  await space.deliver(created.requestId);
  assert.equal(of(await events(), 'personal_request_delivered').length, 1);
  await assert.rejects(space.createRequest({ participantId: 'my-codex', text: 'x', actor: { kind: 'human', id: 'research-agent' } }), /사람만/);
});

test('an unreachable or read-only folder keeps the request pending without touching the work; a later sweep delivers it once', async t => {
  const { space, workspace, events } = await fixture(t);
  const fake = workspace as FakeWorkspace;
  fake.mode = 'disconnected';
  const first = await space.createRequest({ participantId: 'my-codex', text: '확인 부탁드립니다', actor: { kind: 'pm', id: 'pm' } });
  assert.deepEqual(first.delivery && 'reason' in first.delivery ? [first.delivery.reason, first.delivery.attempt] : null, ['unreachable', 1]);
  fake.mode = 'denied';
  await space.sweep();
  let state = participation(await events());
  assert.equal(state.requests.get(first.requestId)!.status, 'pending');
  assert.equal(state.requests.get(first.requestId)!.lastFailure!.reason, 'permission_denied');
  assert.equal(fake.delivered.length, 0);
  fake.mode = 'ok';
  await space.sweep(); await space.sweep();
  state = participation(await events());
  assert.equal(state.requests.get(first.requestId)!.status, 'delivered');
  assert.equal(state.requests.get(first.requestId)!.attempts, 3);
  assert.equal(fake.delivered.length, 1);
  assert.equal(of(await events(), 'personal_request_delivered').length, 1);

  // The same with the real folder adapter: the folder appears later (e.g. a drive reconnects).
  const base = await mkdtemp(path.join(tmpdir(), 'ensemble-offline-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'later');
  const real = await fixture(t, { root });
  const pending = await real.space.createRequest({ participantId: 'my-codex', text: '나중에 확인', actor: { kind: 'pm', id: 'pm' } });
  assert.equal(pending.delivery && 'reason' in pending.delivery && pending.delivery.reason, 'unreachable');
  await mkdir(root);
  await real.space.sweep();
  assert.ok((await readdir(path.join(root, '.ensemble', 'inbox'))).includes(`${pending.requestId}.md`));
});

test('the agent sees the request in the Space and answers with inReplyTo; the request becomes answered and keeps its links', async t => {
  const { space, events, token } = await fixture(t);
  const post = await space.post('my-codex', token, { kind: 'question', text: '소셜 로그인도 넣을까요?', clientPostId: 'q1', taskId: 'copy' });
  const liaison = await space.liaison(post.postId);
  assert.equal(liaison.outcome, 'request');
  const requestId = liaison.requestId!;
  const context = await space.readContext('my-codex', token, 'json');
  assert.deepEqual(context.requests.map(r => [r.requestId, r.status]), [[requestId, 'delivered']]);
  let state = participation(await events());
  assert.equal(state.requests.get(requestId)!.status, 'seen');
  await space.post('my-codex', token, { kind: 'result', text: '이메일만 남겼습니다', clientPostId: 'a1', inReplyTo: requestId });
  await space.post('my-codex', token, { kind: 'note', text: '추가 메모', clientPostId: 'a2', inReplyTo: requestId });
  state = participation(await events());
  const request = state.requests.get(requestId)!;
  assert.equal(request.status, 'answered');
  assert.equal(request.request.triggerPostId, post.postId);
  assert.equal(request.request.taskId, 'copy');
  assert.ok(request.request.observationId, 'the request names the folder observation it was based on');
  assert.equal(of(await events(), 'personal_request_answered').length, 1);
  const reply = [...state.posts.values()].find(p => p.clientPostId === 'a1')!;
  assert.equal(reply.taskId, 'copy', 'a reply inherits the request task');
  assert.equal((await space.readContext('my-codex', token, 'json')).requests.length, 0);
});

test('PM-authored posts, notes and repeated triggers never start another request', async t => {
  const { space, store, context, composed, events, workspace, token } = await fixture(t);
  await store.append([{ ...context, actor: { kind: 'pm', id: 'pm' }, type: 'space_post_recorded', idempotencyKey: 'pm-post', payload: {
    postId: 'pm-post', participantId: 'my-codex', kind: 'question', text: 'PM이 쓴 글', clientPostId: 'pm', source: { tool: 'pm', workspaceRoot: '', via: 'space_http' }, observedAt: new Date().toISOString() } } satisfies NewLedgerEvent]);
  assert.equal((await space.liaison('pm-post')).outcome, 'skipped');
  const note = await space.post('my-codex', token, { kind: 'note', text: '메모', clientPostId: 'n1' });
  assert.equal((await space.liaison(note.postId)).outcome, 'skipped');
  const question = await space.post('my-codex', token, { kind: 'question', text: '질문', clientPostId: 'q1' });
  const [a, b] = await Promise.all([space.liaison(question.postId), space.liaison(question.postId)]);
  assert.equal(a.requestId, b.requestId);
  assert.equal(composed.length, 1, 'the composer ran once');
  assert.equal((workspace as FakeWorkspace).inspections, 1);
  const created = of(await events(), 'personal_request_created');
  assert.equal(created.length, 1);
  assert.equal(created[0]!.idempotencyKey, `request-from:${question.postId}`);
  assert.equal(created[0]!.actor.kind, 'pm');
  assert.equal(of(await events(), 'liaison_considered').length, 3);
});

test('a thread deeper than the cap stops for a person instead of asking again; a composer saying nothing records silence', async t => {
  const { space, events, token } = await fixture(t);
  let post = await space.post('my-codex', token, { kind: 'question', text: '시작', clientPostId: 'p0' });
  for (let depth = 1; depth <= MAX_REQUEST_DEPTH; depth++) {
    const outcome = await space.liaison(post.postId);
    assert.equal(outcome.outcome, 'request');
    assert.equal(outcome.depth, depth);
    post = await space.post('my-codex', token, { kind: 'result', text: `답 ${depth}`, clientPostId: `p${depth}`, inReplyTo: outcome.requestId! });
  }
  const stopped = await space.liaison(post.postId);
  assert.equal(stopped.outcome, 'needs_human');
  assert.equal(stopped.depth, MAX_REQUEST_DEPTH + 1);
  assert.equal(of(await events(), 'personal_request_created').length, MAX_REQUEST_DEPTH);

  const quiet = await fixture(t, { composer: async () => null });
  const result = await quiet.space.post('my-codex', quiet.token, { kind: 'result', text: '끝났습니다', clientPostId: 'r1' });
  const silent = await quiet.space.liaison(result.postId);
  assert.equal(silent.outcome, 'none');
  assert.ok(silent.observationId);
  assert.equal(of(await quiet.events(), 'personal_request_created').length, 0);
  const payload: ParticipationPayloads['liaison_considered'] | undefined = of(await quiet.events(), 'liaison_considered')[0]?.payload;
  assert.equal(payload?.triggerPostId, result.postId);
});

test('the web runtime records an agent post at once and the PM follows up in the background, visible in the dashboard state', async t => {
  const { WebRuntime } = await import('../apps/web/lib/runtime.ts');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'ensemble-web-space-'));
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-web-folder-'));
  await writeFile(path.join(root, 'README.md'), '# existing work');
  const composed: ComposeInput[] = [];
  const codes: string[] = [];
  const runtime = new WebRuntime({ dataDir, store: new MemoryLedgerStore(), timers: false, llm: { async complete() { throw new Error('no model in this test'); } },
    composer: async input => { composed.push(input); return input.trigger.kind === 'question' ? '답: 이메일만 지원합니다. README를 고쳐 주세요.' : null; },
    announceLinkCode: notice => { codes.push(notice.code); } });
  t.after(async () => { await runtime.stop(); await rm(dataDir, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  const pending = await runtime.requestParticipantLink({ participantId: 'my-codex', displayName: '내 Codex', tool: 'codex', workspaceRoot: root, spaceUrl: 'http://127.0.0.1:9' }, 'owner');
  assert.equal(JSON.stringify(pending).includes(codes[0]!), false, 'the API caller never gets the code');
  assert.deepEqual((await runtime.spaceStatus()).pendingLinks.map(l => [l.id, l.participantId, l.workspaceRoot]), [[pending.linkRequestId, 'my-codex', root]]);
  assert.equal((await runtime.spaceStatus()).participants.length, 0, 'nothing is granted before the confirmation');
  const { token } = await runtime.confirmParticipantLink(pending.linkRequestId, 'owner', codes[0]!);
  assert.equal((await runtime.spaceStatus()).pendingLinks.length, 0);
  await assert.rejects(runtime.spaceContext('my-codex', 'md', undefined), (error: unknown) => (error as { status?: number }).status === 401);
  assert.match(await runtime.spaceContext('my-codex', 'md', token) as string, /POST http:\/\/127\.0\.0\.1:9\/api\/space\/participants\/my-codex\/posts/);
  const accepted = await runtime.spacePost('my-codex', token, { kind: 'question', text: '소셜 로그인도 넣을까요?', clientPostId: 'q1' });
  assert.equal((await runtime.spacePost('my-codex', token, { kind: 'question', text: '소셜 로그인도 넣을까요?', clientPostId: 'q1' })).duplicate, true);
  await assert.rejects(runtime.spacePost('my-codex', 'wrong-token', { kind: 'note', text: '가짜', clientPostId: 'forged' }), (error: unknown) => (error as { status?: number }).status === 401);
  for (let i = 0; i < 100 && !(await runtime.spaceStatus()).requests.length; i++) await new Promise(r => setTimeout(r, 20));
  const status = await runtime.spaceStatus();
  assert.equal(composed.length, 1);
  assert.equal(composed[0]!.observation?.files[0]?.path, 'README.md');
  assert.deepEqual(status.requests.map(r => [r.status, r.triggerPostId, r.byPm]), [['delivered', accepted.postId, true]]);
  assert.ok((await readdir(path.join(root, '.ensemble', 'inbox'))).length === 1);
  assert.equal((await runtime.state('owner')).space?.posts.length, 1);
  await assert.rejects(runtime.inspectParticipant('my-codex', 'research-agent'), /사람만/);
});

// ── Review regressions (PR #85) ──

test('F1: a request the folder never received is retried by the sweep even after the agent saw it in the Space', async t => {
  const { space, workspace, events, token } = await fixture(t);
  const fake = workspace as FakeWorkspace;
  fake.mode = 'disconnected';
  const { requestId } = await space.createRequest({ participantId: 'my-codex', text: '확인 부탁드립니다', actor: { kind: 'pm', id: 'pm' } });
  // Reading the Space is not reaching the folder: seen and delivered stay separate facts.
  assert.deepEqual((await space.readContext('my-codex', token, 'json')).requests.map(r => r.requestId), [requestId]);
  let entry = participation(await events()).requests.get(requestId)!;
  assert.ok(entry.seenAt);
  assert.equal(entry.delivered, undefined);
  fake.mode = 'ok';
  const swept = await space.sweep();
  assert.deepEqual(swept.map(r => r.requestId), [requestId]);
  entry = participation(await events()).requests.get(requestId)!;
  assert.ok(entry.delivered, 'the reconnected folder receives the request');
  assert.ok(entry.seenAt);
  assert.equal(fake.delivered.length, 1);
  assert.deepEqual(await space.sweep(), []);

  // An answered request needs no folder copy any more, delivered or not.
  fake.mode = 'disconnected';
  const answered = await space.createRequest({ participantId: 'my-codex', text: '두 번째 요청', actor: { kind: 'pm', id: 'pm' } });
  await space.post('my-codex', token, { kind: 'result', text: 'Space에서 보고 처리했습니다', clientPostId: 'answer-without-folder', inReplyTo: answered.requestId });
  fake.mode = 'ok';
  assert.deepEqual(await space.sweep(), []);
  assert.equal(fake.delivered.length, 1);
});

test('F2: an .ensemble or inbox link pointing outside the folder is refused before anything is created outside it', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'ensemble-escape-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const outside = path.join(base, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep.txt'), 'outside');
  const request = (requestId: string): PersonalRequest => ({ requestId, projectId: 'p', participantId: 'my-codex', text: '요청', createdAt: '2026-10-08T00:00:00.000Z',
    reply: { postUrl: 'http://space.test/posts', contextUrl: 'http://space.test/context', inReplyTo: requestId } });

  // .ensemble itself is a junction (or directory symlink) to a folder outside the workspace.
  const first = path.join(base, 'first');
  await mkdir(first);
  await symlink(outside, path.join(first, '.ensemble'), 'junction');
  const viaEnsemble = await new LocalFolderWorkspace({ root: first }).deliverRequest(request('req-a'));
  assert.deepEqual(viaEnsemble.delivered ? null : viaEnsemble.reason, 'permission_denied');
  assert.deepEqual(await readdir(outside), ['keep.txt'], 'no inbox directory was created outside');

  // .ensemble is real but its inbox is a link outside.
  const second = path.join(base, 'second');
  await mkdir(path.join(second, '.ensemble'), { recursive: true });
  await symlink(outside, path.join(second, '.ensemble', 'inbox'), 'junction');
  const viaInbox = await new LocalFolderWorkspace({ root: second }).deliverRequest(request('req-b'));
  assert.deepEqual(viaInbox.delivered ? null : viaInbox.reason, 'permission_denied');
  assert.deepEqual(await readdir(outside), ['keep.txt'], 'no request file was written outside');

  // Reads: a link inside a granted path to another part of the root that was not granted is not followed either.
  const third = path.join(base, 'third');
  await mkdir(path.join(third, 'src'), { recursive: true }); await mkdir(path.join(third, 'private'));
  await writeFile(path.join(third, 'src', 'a.txt'), 'a'); await writeFile(path.join(third, 'private', 'secret.txt'), 'secret');
  await symlink(path.join(third, 'private'), path.join(third, 'src', 'to-private'), 'junction');
  await symlink(outside, path.join(third, 'src', 'to-outside'), 'junction');
  const reading = new LocalFolderWorkspace({ root: third, allowedPaths: ['src'] });
  assert.deepEqual((await reading.inspect()).files.map(f => f.path), ['src/a.txt']);
  const named = await reading.inspect(['src/to-private/secret.txt', 'src/to-private', 'src/to-outside/keep.txt', 'src/to-outside']);
  assert.deepEqual(named.files, []);
  assert.deepEqual(named.rejected.map(r => r.reason), ['허용된 경로가 아닙니다', '허용된 경로가 아닙니다', '작업 폴더 밖을 가리킵니다', '작업 폴더 밖을 가리킵니다']);
});

test('F3: a blank or empty allowlist is refused instead of granting the whole folder', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-allow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'private.txt'), 'synthetic secret');
  const { space } = await fixture(t, { root });
  for (const allowedPaths of [['   '], [''], [], ['src', ' ']]) {
    await assert.rejects(space.requestLink({ participantId: 'narrow', displayName: '좁은 권한', tool: 'codex', workspaceRoot: root, allowedPaths }, 'owner'), /허용 경로/, JSON.stringify(allowedPaths));
  }
  // The adapter never widens an explicit grant: [] reads nothing, a blank entry is a programming error.
  const none = new LocalFolderWorkspace({ root, allowedPaths: [] });
  assert.deepEqual((await none.inspect()).files, []);
  assert.deepEqual((await none.inspect(['private.txt'])).rejected.map(r => r.reason), ['허용된 경로가 아닙니다']);
  assert.throws(() => new LocalFolderWorkspace({ root, allowedPaths: ['  '] }), /empty/);
  assert.throws(() => new LocalFolderWorkspace({ root, allowedPaths: [''] }), /empty/);
  // Omitting the allowlist is the documented default: the whole folder.
  assert.deepEqual((await new LocalFolderWorkspace({ root }).inspect()).files.map(f => f.path), ['private.txt']);
});

test('F4: linking only asks; nothing is granted until a person confirms with the one-time code, and only the issued token acts as the agent', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'ensemble-grant-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const victim = path.join(base, 'victim');
  await mkdir(victim);
  await writeFile(path.join(victim, 'private.txt'), 'synthetic secret');
  let now = new Date('2026-10-08T00:00:00.000Z');
  const store = new MemoryLedgerStore();
  t.after(() => store.close());
  const context = { projectId: 'project-a', targetProductId: 'product' };
  await store.append([{ ...context, actor: { kind: 'human', id: 'owner' }, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } }]);
  const space = new SpaceParticipation({ ...context, store, composer: async () => '요청', clock: () => now, defaultSpaceUrl: 'http://space.test' });
  const events = async () => await store.read({ projectId: context.projectId }) as AnyEvent[];
  const unauthorized = (error: unknown) => error instanceof ParticipationError && error.code === 'unauthorized' && error.status === 401;
  const input: LinkInput = { participantId: 'intruder', displayName: '침입', tool: 'curl', workspaceRoot: victim };

  // An unconfirmed request grants nothing: no participant, no folder read, no inbox write, no Space read.
  const asked = await space.requestLink(input, 'owner');
  assert.match(asked.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(participation(await events()).participants.size, 0);
  await assert.rejects(space.inspect('intruder'), /찾지 못했습니다/);
  await assert.rejects(space.createRequest({ participantId: 'intruder', text: 'x', actor: { kind: 'pm', id: 'pm' } }), /찾지 못했습니다/);
  await assert.rejects(space.readContext('intruder', undefined, 'md'), /찾지 못했습니다/);
  assert.deepEqual(await readdir(victim), ['private.txt']);
  assert.ok(!JSON.stringify(await events()).includes(asked.code), 'only a hash of the code is recorded');

  // Wrong code, a non-person, an unknown request: refused. Five wrong codes lock the request even for the right code.
  await assert.rejects(space.confirmLink(asked.linkRequestId, 'AAAA-AAAA', 'owner'), /확인 코드/);
  await assert.rejects(space.confirmLink(asked.linkRequestId, asked.code, 'intruder'), /사람만/);
  await assert.rejects(space.confirmLink('missing', asked.code, 'owner'), /찾지 못했습니다/);
  for (let i = 0; i < 4; i++) await assert.rejects(space.confirmLink(asked.linkRequestId, 'AAAA-AAAA', 'owner'), /확인 코드/);
  await assert.rejects(space.confirmLink(asked.linkRequestId, asked.code, 'owner'), /다시 요청/);
  // An expired request cannot be confirmed either.
  const late = await space.requestLink(input, 'owner');
  now = new Date(now.getTime() + 11 * 60_000);
  await assert.rejects(space.confirmLink(late.linkRequestId, late.code, 'owner'), /만료/);
  assert.equal(participation(await events()).participants.size, 0);

  // The person confirms: the token is returned once and stored only as a hash.
  const fresh = await space.requestLink(input, 'owner');
  const confirmed = await space.confirmLink(fresh.linkRequestId, fresh.code.toLowerCase().replace('-', ' '), 'owner');
  assert.equal(confirmed.link.linkedBy, 'owner');
  assert.ok(!JSON.stringify(await events()).includes(confirmed.token));
  await assert.rejects(space.confirmLink(fresh.linkRequestId, fresh.code, 'owner'), /이미/);
  await assert.rejects(space.readContext('intruder', undefined, 'md'), unauthorized);
  await assert.rejects(space.readContext('intruder', 'not-the-token', 'md'), unauthorized);
  await assert.rejects(space.post('intruder', undefined, { kind: 'note', text: 'x', clientPostId: 'a' }), unauthorized);
  await assert.rejects(space.post('intruder', `${confirmed.token}x`, { kind: 'note', text: 'x', clientPostId: 'a' }), unauthorized);
  assert.equal((await space.readContext('intruder', confirmed.token, 'json')).participant.id, 'intruder');
  assert.equal((await space.post('intruder', confirmed.token, { kind: 'note', text: '정상', clientPostId: 'ok' })).duplicate, false);

  // Re-linking replaces the grant and the token: the old token stops working.
  const again = await space.requestLink(input, 'owner');
  const rotated = await space.confirmLink(again.linkRequestId, again.code, 'owner');
  await assert.rejects(space.readContext('intruder', confirmed.token, 'md'), unauthorized);
  assert.equal((await space.readContext('intruder', rotated.token, 'json')).participant.id, 'intruder');

  // A link recorded without a token (before this check existed) accepts no agent calls until a person links it again.
  const legacy: Record<string, unknown> = { ...participation(await events()).participants.get('intruder')!.link, participantId: 'legacy' };
  delete legacy.tokenHash;
  await store.append([{ ...context, actor: { kind: 'human', id: 'owner' }, type: 'participant_linked', payload: legacy as unknown as ParticipationPayloads['participant_linked'] }]);
  await assert.rejects(space.readContext('legacy', '', 'md'), unauthorized);
});

test('F4: the Space HTTP routes refuse non-loopback callers and cross-site pages before doing anything', async () => {
  const route = await import('../apps/web/app/api/[...path]/route.ts');
  const params = (...path: string[]) => ({ params: Promise.resolve({ path }) });
  const body = JSON.stringify({ me: 'owner', participantId: 'x', displayName: 'x', tool: 'curl', workspaceRoot: tmpdir() });
  const post = (url: string, headers: Record<string, string> = {}) => route.POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), params('space', 'participants'));
  for (const response of [
    await post('http://192.168.0.10:3000/api/space/participants', { host: '192.168.0.10:3000' }),
    await post('http://evil.example/api/space/participants', { host: 'evil.example' }),
    await post('http://localhost:3000/api/space/participants', { host: 'localhost:3000', 'x-forwarded-for': '203.0.113.5' }),
    await post('http://localhost:3000/api/space/participants', { host: 'localhost:3000', origin: 'http://evil.example' }),
    await route.GET(new Request('http://evil.example/api/space/participants/x/context', { headers: { host: 'evil.example' } }), params('space', 'participants', 'x', 'context')),
  ]) {
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'local_only');
  }
  // The same machine, its own dashboard page, and the agent's bearer token pass.
  const { localOnlyRefusal, bearerToken } = await import('../apps/web/lib/local-access.ts');
  const local = (host: string, headers: Record<string, string> = {}) => localOnlyRefusal(new Request(`http://${host}/api/space`, { headers: { host, ...headers } }));
  assert.equal(local('localhost:3000'), null);
  assert.equal(local('127.0.0.1:3181', { 'x-forwarded-for': '127.0.0.1' }), null);
  assert.equal(local('[::1]:3000', { 'x-forwarded-for': '::1' }), null);
  assert.equal(local('localhost:3000', { origin: 'http://localhost:3000' }), null);
  assert.notEqual(local('localhost:3000', { origin: 'http://localhost:4000' }), null);
  assert.equal(bearerToken(new Request('http://localhost/', { headers: { authorization: 'Bearer ens_abc' } })), 'ens_abc');
  assert.equal(bearerToken(new Request('http://localhost/')), undefined);
});

// ── Re-review regressions (PR #85: N1 swaps during access, N2 every route local-only, N3 credential destination) ──

/** Real node:fs/promises, with `onCall` run before each call so a test can swap a directory between the adapter's check and use. */
function racingFs(onCall: (method: string, target: string) => Promise<void>): WorkspaceFs {
  const wrapped: Record<string, unknown> = {};
  for (const name of ['lstat', 'mkdir', 'open', 'readdir', 'realpath', 'rename', 'rm', 'rmdir', 'stat', 'unlink'] as const) {
    const real = nodeFs[name] as (...args: unknown[]) => Promise<unknown>;
    wrapped[name] = async (...args: unknown[]) => { await onCall(name, String(args[0])); return real(...args); };
  }
  return wrapped as unknown as WorkspaceFs;
}
const samePath = (a: string, b: string) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
/** Runs `swap` once, right before the first call matching `when`. */
const swapOnce = (when: (method: string, target: string) => boolean, swap: () => Promise<void>) => {
  let done = false;
  return async (method: string, target: string) => { if (!done && when(method, target)) { done = true; await swap(); } };
};
/** Replaces `dir` by a junction to `to`; the original directory moves to `keep`. */
const junctionSwap = async (dir: string, keep: string, to: string) => { await rename(dir, keep); await symlink(to, dir, 'junction'); };

test('N1: a directory swapped for an outside junction between check and use leaves nothing outside and is never reported delivered', async t => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'ensemble-race-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const request = (requestId: string): PersonalRequest => ({ requestId, projectId: 'p', participantId: 'my-codex', text: 'SYNTHETIC_REQUEST', createdAt: '2026-10-08T00:00:00.000Z',
    reply: { postUrl: 'http://127.0.0.1:3000/posts', contextUrl: 'http://127.0.0.1:3000/context', inReplyTo: requestId } });
  const setup = async (name: string) => {
    const root = path.join(base, name), outside = path.join(base, `${name}-outside`);
    await mkdir(path.join(root, '.ensemble', 'inbox'), { recursive: true }); await mkdir(outside);
    await writeFile(path.join(outside, 'keep.txt'), 'outside');
    return { root, outside, ensemble: path.join(root, '.ensemble'), inbox: path.join(root, '.ensemble', 'inbox') };
  };
  const refused = (result: DeliveryResult) => { assert.equal(result.delivered, false, JSON.stringify(result)); assert.equal(!result.delivered && result.reason, 'permission_denied'); };

  // (a) `.ensemble` becomes a junction after it was checked, just before its `inbox` level is looked at.
  const a = await setup('a');
  await rm(a.inbox, { recursive: true });
  const viaEnsemble = await new LocalFolderWorkspace({ root: a.root, fs: racingFs(swapOnce((_m, p) => samePath(p, a.inbox), () => junctionSwap(a.ensemble, path.join(base, 'a-moved'), a.outside))) }).deliverRequest(request('req-a'));
  refused(viaEnsemble);
  assert.deepEqual(await readdir(a.outside), ['keep.txt'], 'the inbox made through the swapped link is removed again');

  // (b) `inbox` becomes a junction after it was checked, just before the request file is created.
  const b = await setup('b');
  const viaInbox = await new LocalFolderWorkspace({ root: b.root, fs: racingFs(swapOnce((_m, p) => samePath(p, path.join(b.inbox, 'req-b.md')), () => junctionSwap(b.inbox, path.join(base, 'b-moved'), b.outside))) }).deliverRequest(request('req-b'));
  refused(viaInbox);
  assert.deepEqual(await readdir(b.outside), ['keep.txt'], 'no request or temporary file stays outside');

  // (c) The written inbox itself is carried outside (and linked back) just before the rename.
  const c = await setup('c');
  const carried = path.join(c.outside, 'carried');
  const viaRename = await new LocalFolderWorkspace({ root: c.root, fs: racingFs(swapOnce(m => m === 'rename', () => junctionSwap(c.inbox, carried, carried))) }).deliverRequest(request('req-c'));
  refused(viaRename);
  assert.deepEqual(await readdir(carried), [], 'the request that ended up outside is deleted, not reported delivered');

  // Without interference the same adapter still delivers once and stays idempotent.
  const d = await setup('d');
  const plain = new LocalFolderWorkspace({ root: d.root });
  assert.equal((await plain.deliverRequest(request('req-d'))).delivered, true);
  assert.equal((await plain.deliverRequest(request('req-d'))).delivered, true);
  assert.deepEqual(await readdir(d.inbox), ['req-d.md']);
});

test('N1: a granted folder swapped for an outside junction while it is being read yields no outside content', async t => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'ensemble-read-race-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'root'), outside = path.join(base, 'outside'), src = path.join(root, 'src');
  await mkdir(src, { recursive: true }); await mkdir(outside);
  await writeFile(path.join(src, 'a.txt'), 'granted text');
  await writeFile(path.join(outside, 'a.txt'), 'SYNTHETIC_OUTSIDE_SECRET');
  const reads = new Set(['open', 'stat']);
  const workspace = new LocalFolderWorkspace({ root, allowedPaths: ['src'], fs: racingFs(swapOnce((m, p) => reads.has(m) && samePath(p, path.join(src, 'a.txt')), () => junctionSwap(src, path.join(base, 'moved-src'), outside))) });
  const result = await workspace.inspect(['src/a.txt']);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_OUTSIDE_SECRET'), JSON.stringify(result));
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.rejected.map(r => r.path), ['src/a.txt']);
});

test('confirm accounting: concurrent wrong codes cannot exceed the failure budget before the right code is tried', async t => {
  const store = new MemoryLedgerStore();
  t.after(() => store.close());
  const context = { projectId: 'project-a', targetProductId: 'product' };
  await store.append([{ ...context, actor: { kind: 'human', id: 'owner' }, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } }]);
  const space = new SpaceParticipation({ ...context, store, composer: async () => null, defaultSpaceUrl: 'http://127.0.0.1:3000' });
  const asked = await space.requestLink({ participantId: 'burst', displayName: 'b', tool: 'curl', workspaceRoot: tmpdir() }, 'owner');
  const outcomes = await Promise.allSettled([...Array.from({ length: 6 }, () => space.confirmLink(asked.linkRequestId, 'AAAA-AAAA', 'owner')), space.confirmLink(asked.linkRequestId, asked.code, 'owner')]);
  assert.equal(outcomes.at(-1)!.status, 'rejected', 'the right code after five wrong ones in the same burst is refused');
  assert.equal(participation(await store.read({ projectId: context.projectId }) as AnyEvent[]).participants.size, 0);
});

async function webRuntimeFixture(t: TestContext) {
  const { WebRuntime } = await import('../apps/web/lib/runtime.ts');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'ensemble-web-guard-'));
  const root = await mkdtemp(path.join(tmpdir(), 'ensemble-web-guard-folder-'));
  const codes: string[] = [];
  const runtime = new WebRuntime({ dataDir, store: new MemoryLedgerStore(), timers: false, liaison: false, llm: { async complete() { throw new Error('no model in this test'); } },
    composer: async () => null, announceLinkCode: notice => { codes.push(notice.code); } });
  const global = globalThis as typeof globalThis & { ensembleRuntime?: unknown };
  const previous = global.ensembleRuntime;
  global.ensembleRuntime = runtime;
  t.after(async () => { global.ensembleRuntime = previous; await runtime.stop(); await rm(dataDir, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  const route = await import('../apps/web/app/api/[...path]/route.ts');
  const params = (p: string) => ({ params: Promise.resolve({ path: p.split('/') }) });
  const LOCAL = 'http://127.0.0.1:3000';
  const get = (p: string, headers: Record<string, string> = {}) => route.GET(new Request(`${LOCAL}/api/${p}`, { headers: { host: '127.0.0.1:3000', ...headers } }), params(p.split('?')[0]!));
  const post = (p: string, body: unknown, headers: Record<string, string> = {}) => route.POST(new Request(`${LOCAL}/api/${p}`, { method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), params(p));
  return { runtime, root, codes, get, post, LOCAL };
}

test('N2: every API route answers only this machine; the dashboard state never leaks Space data to a foreign Host or Origin', async t => {
  const { runtime, root, codes, get, post } = await webRuntimeFixture(t);
  const pending = await runtime.requestParticipantLink({ participantId: 'my-codex', displayName: '내 Codex', tool: 'codex', workspaceRoot: root }, 'owner');
  const { token } = await runtime.confirmParticipantLink(pending.linkRequestId, 'owner', codes[0]!);
  await runtime.spacePost('my-codex', token, { kind: 'note', text: 'SYNTHETIC_PRIVATE_SPACE_POST', clientPostId: 'marker' });

  const foreign: Record<string, string>[] = [{ host: 'rebinding.attacker.invalid:3000' }, { host: 'rebinding.attacker.invalid' }, { origin: 'http://evil.example' },
    { origin: 'https://127.0.0.1:3000' }, { host: '127.0.0.1:4000' }, { 'x-forwarded-for': '203.0.113.5' }];
  for (const headers of foreign) {
    for (const p of ['state?me=owner', 'space', 'archives', 'archives/any', 'tasks/copy', 'events', 'attachments/any']) {
      const response = await get(p, headers);
      const text = await response.text();
      assert.equal(response.status, 403, `${p} ${JSON.stringify(headers)}`);
      assert.ok(!text.includes('SYNTHETIC_PRIVATE_SPACE_POST'));
      assert.match(text, /local_only/);
    }
    for (const p of ['messages', 'availability', 'scenario/start', 'decisions/x', 'tasks/copy/comments']) assert.equal((await post(p, { me: 'owner' }, headers)).status, 403, `${p} ${JSON.stringify(headers)}`);
  }
  // This machine's own dashboard (loopback Host, its own Origin) still gets the state with the Space block.
  for (const headers of <Record<string, string>[]>[{}, { origin: 'http://127.0.0.1:3000' }, { host: 'localhost:3000', origin: 'http://localhost:3000' }, { host: '[::1]:3000', 'x-forwarded-for': '::1' }]) {
    const response = await get('state?me=owner', headers);
    assert.equal(response.status, 200, JSON.stringify(headers));
    assert.match(await response.text(), /SYNTHETIC_PRIVATE_SPACE_POST/);
  }
});

test('N3: the agent is only ever told to send its token to this server, never to a URL from the link request', async t => {
  const { runtime, root, codes, get, post, LOCAL } = await webRuntimeFixture(t);
  const link = { me: 'owner', participantId: 'my-codex', displayName: '내 Codex', tool: 'codex', workspaceRoot: root };
  for (const spaceUrl of ['https://attacker.invalid', 'http://127.0.0.1:3000.attacker.invalid', 'http://localhost:6666', 'https://127.0.0.1:3000']) {
    const refused = await post('space/participants', { ...link, spaceUrl });
    assert.equal(refused.status, 400, spaceUrl);
  }
  assert.equal((await runtime.spaceStatus()).pendingLinks.length, 0, 'a refused link request leaves nothing to confirm');
  const asked = await post('space/participants', { ...link, spaceUrl: `${LOCAL}/` });
  assert.equal(asked.status, 202);
  const { linkRequestId } = await asked.json() as { linkRequestId: string };
  const confirmed = await post(`space/links/${linkRequestId}/confirm`, { me: 'owner', code: codes.at(-1) });
  assert.equal(confirmed.status, 201);
  const { token, contextUrl, postUrl } = await confirmed.json() as { token: string; contextUrl: string; postUrl: string };
  assert.equal(postUrl, `${LOCAL}/api/space/participants/my-codex/posts`);
  assert.equal(contextUrl, `${LOCAL}/api/space/participants/my-codex/context?format=md`);
  const context = await (await get('space/participants/my-codex/context?format=json', { authorization: `Bearer ${token}` })).json() as { howToPost: { url: string } };
  assert.equal(context.howToPost.url, postUrl);
  assert.equal((await post('space/participants/my-codex/requests', { me: 'owner', text: '확인 부탁드립니다' })).status, 201);
  const [inboxFile] = await readdir(path.join(root, '.ensemble', 'inbox'));
  const file = await readFile(path.join(root, '.ensemble', 'inbox', inboxFile!), 'utf8');
  const urls = file.match(/https?:\/\/[^\s"']+/g) ?? [];
  assert.ok(urls.length >= 3);
  for (const url of urls) assert.ok(url.startsWith(`${LOCAL}/api/space/participants/my-codex/`), url);

  // The library refuses a non-local Space URL too, and ignores one recorded before this check.
  const store = new MemoryLedgerStore();
  t.after(() => store.close());
  const ctx = { projectId: 'project-a', targetProductId: 'product' };
  await store.append([{ ...ctx, actor: { kind: 'human', id: 'owner' }, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } }]);
  const space = new SpaceParticipation({ ...ctx, store, composer: async () => null, defaultSpaceUrl: LOCAL });
  await assert.rejects(space.requestLink({ participantId: 'x', displayName: 'x', tool: 'curl', workspaceRoot: root, spaceUrl: 'https://attacker.invalid' }, 'owner'), /Space 주소/);
  const ok = await space.requestLink({ participantId: 'legacy', displayName: 'l', tool: 'curl', workspaceRoot: root }, 'owner');
  const { link: linked, token: legacyToken } = await space.confirmLink(ok.linkRequestId, ok.code, 'owner');
  await store.append([{ ...ctx, actor: { kind: 'human', id: 'owner' }, type: 'participant_linked', payload: { ...linked, spaceUrl: 'https://attacker.invalid' } }]);
  assert.equal((await space.readContext('legacy', legacyToken, 'json')).howToPost.url, `${LOCAL}/api/space/participants/legacy/posts`);
});
