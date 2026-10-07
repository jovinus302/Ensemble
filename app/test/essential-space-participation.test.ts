import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { LocalFolderWorkspace, WorkspaceAccessError, type DeliveryResult, type PersonalRequest, type PersonalWorkspace, type WorkspaceInspection } from '@ensemble/agents';
import { MAX_REQUEST_DEPTH, participation, project, type AnyEvent, type NewLedgerEvent, type ParticipationPayloads } from '@ensemble/core';
import { SpaceParticipation, spaceContextMarkdown, type ComposeInput, type RequestComposer } from '@ensemble/orchestrator';
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
  await space.link({ participantId: 'my-codex', displayName: '내 Codex', tool: 'codex', workspaceRoot: root }, 'owner');
  const events = async () => await store.read({ projectId: context.projectId }) as AnyEvent[];
  t.after(() => store.close());
  return { store, space, workspace, composed, events, context };
}
const of = <K extends AnyEvent['type']>(events: AnyEvent[], type: K) => events.filter((e): e is Extract<AnyEvent, { type: K }> => e.type === type);

test('a person links an existing agent; the agent reads goals, decisions and open work as Markdown or JSON, and the read is recorded', async t => {
  const { space, store, events, context } = await fixture(t);
  await assert.rejects(space.link({ participantId: 'x', displayName: 'x', tool: 'codex', workspaceRoot: tmpdir() }, 'research-agent'), /사람만/);
  await assert.rejects(space.link({ participantId: 'owner', displayName: 'x', tool: 'codex', workspaceRoot: tmpdir() }, 'owner'), /멤버와 같은 id/);
  await assert.rejects(space.link({ participantId: 'y', displayName: 'y', tool: 'codex', workspaceRoot: 'relative/dir' }, 'owner'), /절대 경로/);
  const json = await space.readContext('my-codex', 'json');
  assert.equal(json.project.goal, '로그인 폼 문구 정리');
  assert.deepEqual(json.decisions.map(d => d.summary), ['이메일 로그인만 지원한다']);
  assert.deepEqual(json.tasks.map(t => t.title), ['문구 정리']);
  assert.equal(json.howToPost.url, 'http://space.test/api/space/participants/my-codex/posts');
  const md = spaceContextMarkdown(await space.readContext('my-codex', 'md'));
  assert.match(md, /목표: 로그인 폼 문구 정리/);
  assert.match(md, /POST http:\/\/space\.test\/api\/space\/participants\/my-codex\/posts/);
  const reads = of(await events(), 'space_context_read');
  assert.deepEqual(reads.map(r => [r.actor.kind, r.actor.id, r.payload.format]), [['agent', 'my-codex', 'json'], ['agent', 'my-codex', 'md']]);
  // A participant is not a project member: the PM never plans work onto it.
  assert.equal(project(await events()).members.has('my-codex'), false);
  await store.append([{ ...context, actor: { kind: 'human', id: 'owner' }, type: 'participant_linked', payload: { ...(of(await events(), 'participant_linked')[0]!.payload), scopes: { readSpace: false, post: true, receiveRequests: true, pmReadWorkspace: true } } }]);
  await assert.rejects(space.readContext('my-codex', 'md'), /읽기 권한/);
});

test('a repeated share is one post, and author, source and observation time are kept', async t => {
  const { space, events } = await fixture(t);
  const first = await space.post('my-codex', { kind: 'result', text: '문구 초안을 README에 반영했습니다', clientPostId: 'share-1', taskId: 'copy' });
  const again = await space.post('my-codex', { kind: 'result', text: '문구 초안을 README에 반영했습니다', clientPostId: 'share-1', taskId: 'copy' });
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
  await assert.rejects(space.post('my-codex', { kind: 'result', text: 'x', clientPostId: 'share-2', taskId: 'missing' }), /작업을 찾지/);
  await assert.rejects(space.post('my-codex', { kind: 'result', text: 'x', clientPostId: 'share-3', inReplyTo: 'req-unknown' }), /요청을 찾지/);
  await assert.rejects(space.post('nobody', { kind: 'note', text: 'x', clientPostId: 'a' }), /찾지 못했습니다/);
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
  await space.link({ participantId: 'my-codex', displayName: '내 Codex', tool: 'codex', workspaceRoot: root, allowedPaths: ['src'] }, 'owner');
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
  const { space, events } = await fixture(t);
  const post = await space.post('my-codex', { kind: 'question', text: '소셜 로그인도 넣을까요?', clientPostId: 'q1', taskId: 'copy' });
  const liaison = await space.liaison(post.postId);
  assert.equal(liaison.outcome, 'request');
  const requestId = liaison.requestId!;
  const context = await space.readContext('my-codex', 'json');
  assert.deepEqual(context.requests.map(r => [r.requestId, r.status]), [[requestId, 'delivered']]);
  let state = participation(await events());
  assert.equal(state.requests.get(requestId)!.status, 'seen');
  await space.post('my-codex', { kind: 'result', text: '이메일만 남겼습니다', clientPostId: 'a1', inReplyTo: requestId });
  await space.post('my-codex', { kind: 'note', text: '추가 메모', clientPostId: 'a2', inReplyTo: requestId });
  state = participation(await events());
  const request = state.requests.get(requestId)!;
  assert.equal(request.status, 'answered');
  assert.equal(request.request.triggerPostId, post.postId);
  assert.equal(request.request.taskId, 'copy');
  assert.ok(request.request.observationId, 'the request names the folder observation it was based on');
  assert.equal(of(await events(), 'personal_request_answered').length, 1);
  const reply = [...state.posts.values()].find(p => p.clientPostId === 'a1')!;
  assert.equal(reply.taskId, 'copy', 'a reply inherits the request task');
  assert.equal((await space.readContext('my-codex', 'json')).requests.length, 0);
});

test('PM-authored posts, notes and repeated triggers never start another request', async t => {
  const { space, store, context, composed, events, workspace } = await fixture(t);
  await store.append([{ ...context, actor: { kind: 'pm', id: 'pm' }, type: 'space_post_recorded', idempotencyKey: 'pm-post', payload: {
    postId: 'pm-post', participantId: 'my-codex', kind: 'question', text: 'PM이 쓴 글', clientPostId: 'pm', source: { tool: 'pm', workspaceRoot: '', via: 'space_http' }, observedAt: new Date().toISOString() } } satisfies NewLedgerEvent]);
  assert.equal((await space.liaison('pm-post')).outcome, 'skipped');
  const note = await space.post('my-codex', { kind: 'note', text: '메모', clientPostId: 'n1' });
  assert.equal((await space.liaison(note.postId)).outcome, 'skipped');
  const question = await space.post('my-codex', { kind: 'question', text: '질문', clientPostId: 'q1' });
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
  const { space, events } = await fixture(t);
  let post = await space.post('my-codex', { kind: 'question', text: '시작', clientPostId: 'p0' });
  for (let depth = 1; depth <= MAX_REQUEST_DEPTH; depth++) {
    const outcome = await space.liaison(post.postId);
    assert.equal(outcome.outcome, 'request');
    assert.equal(outcome.depth, depth);
    post = await space.post('my-codex', { kind: 'result', text: `답 ${depth}`, clientPostId: `p${depth}`, inReplyTo: outcome.requestId! });
  }
  const stopped = await space.liaison(post.postId);
  assert.equal(stopped.outcome, 'needs_human');
  assert.equal(stopped.depth, MAX_REQUEST_DEPTH + 1);
  assert.equal(of(await events(), 'personal_request_created').length, MAX_REQUEST_DEPTH);

  const quiet = await fixture(t, { composer: async () => null });
  const result = await quiet.space.post('my-codex', { kind: 'result', text: '끝났습니다', clientPostId: 'r1' });
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
  const runtime = new WebRuntime({ dataDir, store: new MemoryLedgerStore(), timers: false, llm: { async complete() { throw new Error('no model in this test'); } },
    composer: async input => { composed.push(input); return input.trigger.kind === 'question' ? '답: 이메일만 지원합니다. README를 고쳐 주세요.' : null; } });
  t.after(async () => { await runtime.stop(); await rm(dataDir, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); });
  await runtime.linkParticipant({ participantId: 'my-codex', displayName: '내 Codex', tool: 'codex', workspaceRoot: root, spaceUrl: 'http://127.0.0.1:9' }, 'owner');
  assert.match(await runtime.spaceContext('my-codex', 'md') as string, /POST http:\/\/127\.0\.0\.1:9\/api\/space\/participants\/my-codex\/posts/);
  const accepted = await runtime.spacePost('my-codex', { kind: 'question', text: '소셜 로그인도 넣을까요?', clientPostId: 'q1' });
  assert.equal((await runtime.spacePost('my-codex', { kind: 'question', text: '소셜 로그인도 넣을까요?', clientPostId: 'q1' })).duplicate, true);
  for (let i = 0; i < 100 && !(await runtime.spaceStatus()).requests.length; i++) await new Promise(r => setTimeout(r, 20));
  const status = await runtime.spaceStatus();
  assert.equal(composed.length, 1);
  assert.equal(composed[0]!.observation?.files[0]?.path, 'README.md');
  assert.deepEqual(status.requests.map(r => [r.status, r.triggerPostId, r.byPm]), [['delivered', accepted.postId, true]]);
  assert.ok((await readdir(path.join(root, '.ensemble', 'inbox'))).length === 1);
  assert.equal((await runtime.state('owner')).space?.posts.length, 1);
  await assert.rejects(runtime.inspectParticipant('my-codex', 'research-agent'), /사람만/);
});
