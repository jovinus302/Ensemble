import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { sceneEvents, SCENE_NOW } from '@ensemble/scenarios';
import { buildTaskDetail, buildViewModel } from '../../../apps/web/lib/build-view-model.ts';
import { ProjectManager } from '../src/pm.ts';

it('builds actor-specific cards, evidence, attachment URLs and calculated roadmap from the ledger', async () => {
  const store = new MemoryLedgerStore(), context = { projectId: 'web', targetProductId: 'web' };
  const base = { ...context, actor: { kind: 'system' as const, id: 'pm' } };
  await store.append([
    ...sceneEvents(2, context),
    { ...base, type: 'plan_proposed', payload: { proposalId: 'p', version: 1, forMemberId: 'owner', tasks: [], estimates: [], reason: 'Review' } },
    { ...base, type: 'authority_requested', payload: { requestId: 'a', personId: 'designer', changeKinds: ['human_commitment'], text: 'Hours?' } },
    { ...base, type: 'attachment_recorded', payload: { attachmentId: 'file', name: 'flow.md', mimeType: 'text/markdown', uri: 'data:text/markdown;base64,YQ==' } },
    { ...base, type: 'message_recorded', payload: { messageId: 'm', authorId: 'designer', text: 'Draft', attachmentIds: ['file'] } },
    { ...base, type: 'pm_considered', payload: { considerationId: 'c', triggerId: 'm', whoseAction: 'owner', alreadyKnows: 'no', evidence: ['m'], decision: 'speak', reason: 'Approval needed', openTopics: [] } },
    { ...base, type: 'pm_spoke', payload: { considerationId: 'c', messageId: 'speech', text: 'Review', kind: 'ask' } },
  ]);
  const events = await store.read();
  const owner = buildViewModel(events, { me: 'owner', mode: 'scenario', busy: false, now: SCENE_NOW });
  const designer = buildViewModel(events, { me: 'designer', mode: 'scenario', busy: false, now: SCENE_NOW });
  expect(owner.cards.map(c => c.id)).toEqual(['p']);
  expect(designer.cards.map(c => c.id)).toEqual(['a']);
  expect(owner.roadmap.forecast?.ok).toBe(true);
  expect(owner.roadmap.tasks.find(t => t.id === 'prototype')?.startDay).toBeGreaterThan(0);
  expect(owner.messages.find(m => m.id === 'm')?.attachments[0]?.url).toBe('/api/attachments/file');
  expect(owner.messages.find(m => m.id === 'speech')?.pm).toMatchObject({ reason: 'Approval needed', evidence: ['메시지 · 디자이너: "Draft"'] });
  await store.append([{ ...base, type: 'plan_decided', payload: { proposalId: 'p', memberId: 'owner', approved: false } }]);
  expect(buildViewModel(await store.read(), { me: 'owner', mode: 'free', busy: false }).cards).toHaveLength(0);
});

it('records uploaded binary bytes without a UTF-8 round trip', async () => {
  const store = new MemoryLedgerStore(), context = { projectId: 'binary', targetProductId: 'web' };
  await store.append(sceneEvents(2, context));
  const pm = new ProjectManager({ ...context, store, model: 'fake',
    connector: { async startSession() { return { threadId: 'fake', workspace: '/fake' }; }, async startTask() { return 'fake'; }, async sendUpdate() { return { sent: false, reason: 'fake' }; }, onEvent() { return () => {}; }, async stop() {} },
    llm: { async complete(request) {
      const input = request.forceTool === 'route_message' ? { kind: 'chat' } : request.forceTool === 'interpret_coordination' ? { category: 'chat', summary: '', ops: [], conflicts: [] } : { whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: 'No action', openTopics: [], text: '' };
      return { text: '', model: 'fake', responseId: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
    } },
  });
  const bytes = Buffer.from([0, 255, 128, 1]);
  await pm.postMessage('owner', 'Binary attachment', [{ name: 'test.bin', mimeType: 'application/octet-stream', content: bytes.toString('utf8'), contentBase64: bytes.toString('base64') }]);
  const attachment = (await store.read()).find(e => e.type === 'attachment_recorded')!.payload as { uri: string };
  expect(Buffer.from(attachment.uri.split(',')[1]!, 'base64')).toEqual(bytes);
  await pm.stop();
});

it('MD2 builds the work panel, decision cards and task detail from the ledger without showing task ids', async () => {
  const store = new MemoryLedgerStore(), context = { projectId: 'work', targetProductId: 'web' };
  const as = (kind: 'human' | 'pm' | 'agent' | 'system', id: string) => ({ ...context, actor: { kind, id } });
  const spec = (id: string, title: string, assignee: string, extra: Record<string, unknown> = {}) => ({ id, title, baseTitle: title, assignee, dependsOn: [] as string[], handoffConditions: [`${title} 시안`], exclusions: [], limits: [], ...extra });
  const hold = { optionId: 'hold', label: '보류', effects: [{ type: 'none' as const }], tradeoff: '지금은 그대로 둬요' };
  await store.append([
    { ...as('system', 'setup'), type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...as('system', 'setup'), type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: '디자이너' } },
    { ...as('system', 'setup'), type: 'member_joined', payload: { memberId: 'prototype-agent', kind: 'agent', displayName: '프로토타입 Agent', role: '웹 프로토타입 구현' } },
    { ...as('system', 'setup'), type: 'goal_set', payload: { text: '예약 시제품', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...as('human', 'designer'), type: 'message_recorded', payload: { messageId: 'm1', authorId: 'designer', text: '로그인 화면이 필요해요', attachmentIds: [] } },
    { ...as('pm', 'pm'), type: 'plan_committed', payload: { version: 1, basedOn: null, approvedBy: 'owner', reason: '초기 합의', sourceMessageIds: [], tasks: [
      spec('screens-work', '화면 묶음', 'prototype-agent'), spec('login-screen', '로그인 화면', 'prototype-agent', { parentId: 'screens-work' }),
      spec('signup-screen', '가입 화면', 'prototype-agent', { parentId: 'screens-work' }), spec('review-work', '디자인 검토', 'designer', { dependsOn: ['screens-work'] }),
    ] } },
    { ...as('pm', 'pm'), type: 'task_meta_set', payload: { taskId: 'login-screen', priority: 'high',
      routing: { executor: 'agent', reason: 'agent_capable', note: 'login-screen 화면 구현은 Agent가 할 수 있어요' },
      brief: { why: '[login-screen 로그인 화면] 없이는 task:signup-screen 다음 흐름을 볼 수 없어요', sourceMessageIds: ['m1'], decisionIds: [], attachmentIds: [], constraints: ['이메일 로그인만'] },
      origin: { createdBy: 'designer', planVersion: 1, sourceMessageIds: ['m1'] } } },
    { ...as('pm', 'pm'), type: 'task_start_reserved', payload: { taskId: 'login-screen', specVersion: 1, trigger: 'test' } },
    { ...as('agent', 'prototype-agent'), type: 'task_started', payload: { taskId: 'login-screen', turnId: 't1' } },
    { ...as('pm', 'pm'), type: 'decision_requested', payload: { requestId: 'ask-login', kind: 'missing_info', targetMemberId: 'owner',
      question: 'login-screen 작업에서 묻습니다: 소셜 로그인도 넣을까요?', sourceMessageIds: [],
      options: [{ optionId: 'answer', label: '답하기', effects: [{ type: 'answer', taskId: 'login-screen' }], tradeoff: '바로 이어서 진행해요' }, hold],
      recommendation: { optionId: 'answer', rationale: '답이 있어야 작업이 이어져요', evidence: ['m1', 'opaque-ledger-key'] },
      impact: { taskIds: ['login-screen'], blockedTaskIds: ['login-screen'] } } },
    { ...as('pm', 'pm'), type: 'decision_requested', payload: { requestId: 'add-pay', kind: 'plan_change', targetMemberId: 'owner', question: '결제 화면을 새로 만들까요?', sourceMessageIds: ['m1'],
      options: [{ optionId: 'apply', label: '반영', tradeoff: '', effects: [{ type: 'plan_ops', ops: [{ type: 'create_task', tempId: 'pay-screen', title: '결제 화면', assignee: 'prototype-agent', parentId: 'screens-work', handoffConditions: ['결제 시안'], dependsOn: [], priority: 'normal',
        routing: { executor: 'agent', reason: 'agent_capable', note: '' }, brief: { why: '', sourceMessageIds: [], decisionIds: [], attachmentIds: [], constraints: [] }, sourceMessageIds: ['m1'] }] }] }, hold],
      recommendation: { optionId: 'apply', rationale: 'pay-screen 없이는 예약을 마칠 수 없어요', evidence: ['m1'] }, impact: { taskIds: ['pay-screen'], blockedTaskIds: [] }, editable: ['title', 'include'] } },
    { ...as('pm', 'pm'), type: 'pm_spoke', payload: { considerationId: 'c1', messageId: 'speech', text: '@사용자 로그인 화면 작업에서 묻습니다.', kind: 'ask', taskIds: ['login-screen', 'ghost'], requestId: 'ask-login' } },
    { ...as('human', 'designer'), type: 'message_recorded', payload: { messageId: 'comment-1', authorId: 'designer', text: '버튼은 짧게', threadId: 'task:login-screen', attachmentIds: [] } },
    { ...as('pm', 'pm'), type: 'pm_spoke', payload: { considerationId: 'c2', messageId: 'note-1', text: '댓글을 Agent에게 전했어요', kind: 'fact', threadId: 'task:login-screen' } },
    { ...as('agent', 'prototype-agent'), type: 'update_sent', payload: { updateId: 'u1', taskId: 'login-screen', fromVersion: 1, toVersion: 1, turnId: 't1' } },
    // A digest record cites raw task, request and digest keys (orchestrator digest.ts); people must read names only.
    { ...as('system', 'pm'), type: 'pm_considered', payload: { considerationId: 'digest:2026-10-01', triggerId: 'digest:2026-10-01', whoseAction: 'owner', alreadyKnows: 'no',
      evidence: ['login-screen', 'signup-screen', 'pay-screen', 'ask-login', 'digest:2026-10-01', 'opaque-ledger-key', 'm1'], decision: 'speak', reason: 'login-screen 하루 요약', openTopics: [] } },
    { ...as('pm', 'pm'), type: 'pm_spoke', payload: { considerationId: 'digest:2026-10-01', messageId: 'digest:2026-10-01:0', text: '지난 요약 이후 login-screen 완료', kind: 'summary' } },
  ]);
  const events = await store.read();
  const owner = buildViewModel(events, { me: 'owner', mode: 'free', busy: false });
  const designer = buildViewModel(events, { me: 'designer', mode: 'free', busy: false });
  const items = new Map(owner.work!.items.map(i => [i.id, i]));
  // Tree, rolled-up parent status, waiting on a person, metadata and routing.
  expect(owner.work!.items.map(i => i.id)).toEqual(['screens-work', 'login-screen', 'signup-screen', 'review-work']);
  expect(items.get('screens-work')).toMatchObject({ status: 'in_progress', childIds: ['login-screen', 'signup-screen'], ownerKind: 'agent' });
  expect(items.get('screens-work')!.routingNote).toBeUndefined();
  expect(items.get('login-screen')).toMatchObject({ parentId: 'screens-work', status: 'waiting_human', priority: 'high', waitingOn: { memberId: 'owner', requestId: 'ask-login' },
    routingNote: '로그인 화면 화면 구현은 Agent가 할 수 있어요', origin: { createdByName: '디자이너', messageIds: ['m1'] },
    brief: { why: '[로그인 화면] 없이는 가입 화면 다음 흐름을 볼 수 없어요', sources: [{ messageId: 'm1', excerpt: '로그인 화면이 필요해요' }], constraints: ['이메일 로그인만'] } });
  expect(items.get('signup-screen')).toMatchObject({ status: 'todo', routingNote: 'Agent가 할 수 있는 일이라 바로 맡겼어요' });
  expect(items.get('review-work')).toMatchObject({ status: 'todo', ownerKind: 'human' });
  expect(owner.work!.team.find(r => r.memberId === 'owner')).toMatchObject({ state: '결정 2건 대기', openDecisions: 2 });
  expect(owner.work!.team.find(r => r.memberId === 'prototype-agent')).toMatchObject({ currentItemId: 'login-screen', state: '사용자님 결정 대기' });
  // Decision cards only for the person asked, with readable recommendation, effects and impact.
  expect(designer.decisionCards).toEqual([]);
  expect(owner.decisionCards!.map(c => [c.id, c.answerMode])).toEqual([['ask-login', 'text'], ['add-pay', 'choose']]);
  const [ask, add] = owner.decisionCards!;
  expect(ask!).toMatchObject({ question: '로그인 화면 작업에서 묻습니다: 소셜 로그인도 넣을까요?', impact: { taskTitles: ['로그인 화면'], blockedTitles: ['로그인 화면'] },
    recommendation: { optionId: 'answer', evidence: ['메시지 · 디자이너: "로그인 화면이 필요해요"'] } });
  expect(add!).toMatchObject({ requestKind: 'plan_change', editable: ['title', 'include'], impact: { taskTitles: ['결제 화면'] }, recommendation: { rationale: '결제 화면 없이는 예약을 마칠 수 없어요' } });
  expect(add!.options[0]!.summary).toEqual(['새 작업 "결제 화면" 만들기 · 담당 프로토타입 Agent · "화면 묶음" 아래']);
  expect(add!.options[1]!.summary).toEqual(['변경 없음']);
  // The PM line presents its card and names its work; work comments stay out of the channel.
  expect(owner.messages.find(m => m.id === 'speech')).toMatchObject({ cardId: 'ask-login', taskIds: ['login-screen'] });
  expect(owner.messages.map(m => m.id)).not.toEqual(expect.arrayContaining(['comment-1']));
  expect(owner.messages.some(m => m.id === 'comment-1' || m.id === 'note-1')).toBe(false);
  // Nothing a person reads carries a task id (no JIRA-style keys).
  const ids = ['screens-work', 'login-screen', 'signup-screen', 'review-work', 'pay-screen'];
  const visible = JSON.stringify([owner.decisionCards, owner.work!.items.map(i => [i.title, i.routingNote, i.brief, i.handoffConditions]), owner.work!.team.map(r => r.state), owner.messages.map(m => m.text)]);
  for (const id of ids) expect(visible).not.toContain(id);
  expect(visible).not.toContain('opaque-ledger-key');
  // PM judgement log and message evidence: task ids become titles, digest/request keys become labels, unreadable keys drop.
  const digestLog = owner.pmLog.find(j => j.triggerMessageId === 'digest:2026-10-01')!;
  expect(digestLog).toMatchObject({ triggerLabel: '하루 요약', reason: '로그인 화면 하루 요약', spokenText: '지난 요약 이후 로그인 화면 완료',
    evidence: ['로그인 화면', '가입 화면', '결제 화면', '결정 요청 · 로그인 화면 작업에서 묻습니다: 소셜 로그인도 넣…', '하루 요약', '메시지 · 디자이너: "로그인 화면이 필요해요"'] });
  expect(owner.messages.find(m => m.id === 'digest:2026-10-01:0')!.pm!.evidence).toEqual(digestLog.evidence);
  const logText = JSON.stringify([owner.pmLog.map(({ triggerMessageId: _key, ...shown }) => shown), owner.messages.map(m => m.pm)]);
  for (const id of [...ids, 'ask-login', 'digest:', 'opaque-ledger-key']) expect(logText).not.toContain(id);

  const detail = buildTaskDetail(events, 'login-screen', { me: 'owner' })!;
  expect(detail.item).toEqual(items.get('login-screen'));
  expect(detail.comments.map(c => [c.id, c.authorId, c.threadId])).toEqual([['comment-1', 'designer', 'task:login-screen'], ['note-1', 'pm', 'task:login-screen']]);
  expect(detail.activity.map(a => a.kind)).toEqual(['created', 'started', 'decision_requested', 'comment', 'comment', 'changed']);
  // The PM delivered the change, not the agent that received it.
  expect(detail.activity.at(-1)).toMatchObject({ actorId: 'pm', text: '바뀐 내용을 담당에게 전달했어요' });
  expect(detail.activity[1]).toMatchObject({ actorId: 'prototype-agent' });
  expect(detail.activity[0]).toMatchObject({ actorId: 'pm', text: '디자이너의 발언에서 작업이 생겼어요', messageId: 'm1' });
  expect(detail.activity[2]!.text).toBe('사용자님에게 결정을 요청했어요: 로그인 화면 작업에서 묻습니다: 소셜 로그인도 넣을까요?');
  for (const id of ids) expect(JSON.stringify(detail.activity.map(a => a.text))).not.toContain(id);
  expect(buildTaskDetail(events, 'missing', { me: 'owner' })).toBeUndefined();
});

it('bundles a person\'s open decision requests beyond three into the third card and reads agent-question evidence as words', async () => {
  const store = new MemoryLedgerStore(), context = { projectId: 'bundle', targetProductId: 'web' };
  const as = (kind: 'human' | 'pm' | 'agent' | 'system', id: string) => ({ ...context, actor: { kind, id } });
  const hold = { optionId: 'hold', label: '보류', effects: [{ type: 'none' as const }], tradeoff: '' };
  const ask = (requestId: string, targetMemberId: string, evidence: string[] = []) => ({ ...as('pm', 'pm'), type: 'decision_requested' as const, payload: {
    requestId, kind: 'choice' as const, targetMemberId, question: `${requestId}?`, sourceMessageIds: [], options: [{ ...hold, optionId: 'go', label: '진행' }, hold],
    recommendation: { optionId: 'hold', rationale: '기다려요', evidence }, impact: { taskIds: [], blockedTaskIds: [] } } });
  await store.append([
    { ...as('system', 'setup'), type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
    { ...as('system', 'setup'), type: 'member_joined', payload: { memberId: 'designer', kind: 'human', displayName: '디자이너' } },
    { ...as('system', 'setup'), type: 'member_joined', payload: { memberId: 'prototype-agent', kind: 'agent', displayName: '프로토타입 Agent' } },
    { ...as('system', 'setup'), type: 'goal_set', payload: { text: '예약 시제품', decider: 'owner', delegation: { pmMayApply: [] } } },
    { ...as('pm', 'pm'), type: 'plan_committed', payload: { version: 1, basedOn: null, approvedBy: 'owner', reason: '초기', sourceMessageIds: [], tasks: [
      { id: 'login-screen', title: '로그인 화면', baseTitle: '로그인 화면', assignee: 'prototype-agent', dependsOn: [], handoffConditions: ['시안'], exclusions: [], limits: [] }] } },
    ask('r-a', 'owner', ['question:login-screen:1']), ask('r-b', 'owner'), ask('r-c', 'owner'), ask('r-d', 'owner'), ask('r-e', 'owner'), ask('r-x', 'designer'),
  ]);
  const events = await store.read();
  const owner = buildViewModel(events, { me: 'owner', mode: 'free', busy: false });
  // Five open requests: three cards, the last carrying the fourth and fifth (core bundleDecisions).
  expect(owner.decisionCards!.map(c => [c.id, ...(c.bundled ?? []).map(b => b.id)])).toEqual([['r-a'], ['r-b'], ['r-c', 'r-d', 'r-e']]);
  expect(owner.decisionCards![2]!.bundled![0]).toMatchObject({ kind: 'decision', question: 'r-d?', answerMode: 'choose' });
  const designer = buildViewModel(events, { me: 'designer', mode: 'free', busy: false });
  expect(designer.decisionCards!.map(c => c.id)).toEqual(['r-x']);
  expect(designer.decisionCards![0]!.bundled).toBeUndefined();
  // An agent question cited as evidence names who asked and on which work, not a bare "Agent 질문".
  expect(owner.decisionCards![0]!.recommendation.evidence).toEqual(['프로토타입 Agent의 질문 · 로그인 화면']);
});
