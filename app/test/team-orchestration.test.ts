import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { project, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import { judgeHandoff } from '@ensemble/orchestrator';
import { MemoryLedgerStore } from '@ensemble/store';
import { FakePmLlm, TEAM_ORCHESTRATION_PLAN } from '../apps/web/lib/fake-connector.ts';
import { buildTaskDetail, buildViewModel } from '../apps/web/lib/build-view-model.ts';
import { WebRuntime } from '../apps/web/lib/runtime.ts';
import { TEAM_PROPOSAL_ID, TEAM_SCENARIO, readVia, teamOrchestrationSeed, viaLabel } from '../apps/web/lib/team-orchestration.ts';
// @ts-expect-error -- plain ESM script without type declarations
import { buildRequest, parseArgs, resultReport, DEFAULT_CONDITIONS } from '../scripts/personal-agent-submit.mjs';

// Fake transport and the rule-based PM model only; plan approval, handoff review, starts and projection are the real code.
const context = { projectId: 'team-demo', targetProductId: 'ensemble-demo' };
const kim = TEAM_ORCHESTRATION_PLAN.members.builder.memberId;
const PR = 'https://github.com/example/ensemble/pull/1';
const via = { channel: 'ide', agent: '김상성의 Coding Agent' } as const;
const report = (conditions: readonly string[] = TEAM_ORCHESTRATION_PLAN.tasks[0].handoffConditions) =>
  resultReport({ task: 'T-1', summary: '로그인 API 구현', pr: PR, agent: via.agent, conditions: [...conditions] }) as string;

/** The ledger after the plan was approved and 김상성's personal agent submitted T-1 (as W1's endpoint is expected to record it). */
function submitted(): NewLedgerEvent[] {
  const pm = { kind: 'system' as const, id: 'pm' }, person = { kind: 'human' as const, id: kim };
  const tasks = TEAM_ORCHESTRATION_PLAN.tasks.map(t => ({ id: t.id, title: t.title, assignee: t.assignee, dependsOn: [...t.dependsOn], handoffConditions: [...t.handoffConditions] }));
  return [
    ...teamOrchestrationSeed(context),
    { ...context, actor: { kind: 'human', id: 'owner' }, type: 'plan_committed', payload: { version: 1, basedOn: null, tasks, reason: 'test', approvedBy: 'owner', sourceMessageIds: [] } },
    { ...context, actor: pm, type: 'task_start_reserved', payload: { taskId: 'T-1', specVersion: 1, trigger: TEAM_PROPOSAL_ID } },
    { ...context, actor: person, type: 'attachment_recorded', payload: { attachmentId: 'pr-link', name: 'Pull Request', mimeType: 'text/uri-list', uri: PR, taskId: 'T-1' } },
    { ...context, actor: person, type: 'attachment_recorded', payload: { attachmentId: 'report', name: 'T-1 결과 보고.md', mimeType: 'text/markdown', uri: `data:text/markdown;base64,${Buffer.from(report()).toString('base64')}`, taskId: 'T-1' } },
    { ...context, actor: person, type: 'result_submitted', payload: { taskId: 'T-1', resultId: 'r-1', planVersion: 1, summary: '로그인 API 구현', artifactIds: ['report'], via } as never },
  ];
}

test('fake PM: the personal agent report meets every T-1 handoff condition (verdict sufficient → checked)', async () => {
  const store = new MemoryLedgerStore();
  await store.append(submitted());
  const events = await store.read({ projectId: context.projectId }) as AnyEvent[];
  const state = project(events);
  const result = events.findLast(e => e.type === 'result_submitted')!.payload as Extract<AnyEvent, { type: 'result_submitted' }>['payload'];
  const judged = await judgeHandoff({ state, result, resultContent: { report: report() }, decisions: [], llm: new FakePmLlm(), model: 'fake-pm' });
  assert.ok(judged.ok, judged.ok ? '' : judged.error);
  assert.equal(judged.review.verdict, 'sufficient');
  assert.deepEqual(judged.review.missing, []);
  assert.equal(judged.review.met.length, 2);
});

test('view model: human/agent badges, via source and the PR link; old results without via stay as they were', async () => {
  const store = new MemoryLedgerStore();
  await store.append(submitted());
  const events = await store.read({ projectId: context.projectId });
  const vm = buildViewModel(events, { me: 'owner', mode: 'scenario', busy: false });
  const kinds = Object.fromEntries(vm.roadmap.tasks.map(t => [t.id, t.assigneeKind]));
  assert.deepEqual(kinds, { 'T-1': 'human', 'T-2': 'agent', 'T-3': 'human' });
  assert.deepEqual(vm.work!.items.map(i => i.ownerKind), ['human', 'agent', 'human']);
  const t1 = vm.work!.items.find(i => i.id === 'T-1')!;
  assert.equal(t1.latestResult?.via?.label, 'IDE · 김상성의 Coding Agent');
  assert.deepEqual(t1.latestResult?.links, [{ name: 'Pull Request', url: PR }]);
  assert.deepEqual(vm.roadmap.tasks[0]!.latestResult, t1.latestResult);
  const line = vm.messages.find(m => m.result);
  assert.equal(line?.authorId, kim);
  assert.match(line!.text, /IDE · 김상성의 Coding Agent/);
  const detail = buildTaskDetail(events, 'T-1', { me: 'owner' })!;
  assert.ok(detail.activity.some(a => a.kind === 'submitted' && a.text.includes('IDE · 김상성의 Coding Agent')));

  // Without via the UI shows no source line and adds no channel message.
  const plain = (await store.read({ projectId: context.projectId })).map(e => e.type === 'result_submitted' ? { ...e, payload: { ...(e.payload as object), via: undefined } } : e);
  const before = buildViewModel(plain, { me: 'owner', mode: 'scenario', busy: false });
  assert.equal(before.work!.items[0]!.latestResult?.via, undefined);
  assert.ok(!before.messages.some(m => m.result));

  // Plan card before approval carries the same badges.
  const seeded = new MemoryLedgerStore();
  await seeded.append(teamOrchestrationSeed(context));
  const card = buildViewModel(await seeded.read({ projectId: context.projectId }), { me: 'owner', mode: 'scenario', busy: false }).cards[0];
  assert.equal(card?.kind, 'plan_approval');
  assert.deepEqual(card?.kind === 'plan_approval' && card.tasks.map(t => t.assigneeKind), ['human', 'agent', 'human']);
});

test('via helpers: label and malformed values', () => {
  assert.equal(viaLabel({ channel: 'ide', agent: '김상성의 Coding Agent' }), 'IDE · 김상성의 Coding Agent');
  assert.equal(viaLabel({ channel: 'slack' }), 'Slack');
  assert.equal(readVia({ via: { channel: 'fax' } }), undefined);
  assert.equal(readVia({}), undefined);
});

test('script: --dry-run body follows the W1 contract', () => {
  const options = parseArgs(['--task', 'T-1', '--member', kim, '--pr', PR, '--summary', '로그인 API 구현', '--dry-run']);
  assert.equal(options.dryRun, true);
  const request = buildRequest(options);
  assert.equal(request.url, 'http://localhost:3000/api/tasks/T-1/result');
  assert.equal(request.headers.Authorization, 'Bearer dev-token');
  assert.deepEqual(request.body.via, via);
  assert.equal(request.body.memberId, kim);
  assert.deepEqual(request.body.artifacts[0], { kind: 'url', name: 'Pull Request', uri: PR });
  assert.equal(request.body.artifacts[1].kind, 'file');
  assert.match(Buffer.from(request.body.artifacts[1].contentBase64, 'base64').toString('utf8'), new RegExp(DEFAULT_CONDITIONS[1]));
  assert.throws(() => parseArgs(['--task', 'T-1', '--summary', 'x']), /--member/);
  assert.throws(() => parseArgs(['--task', 'T-1', '--member', kim, '--summary', 'x', '--pr', 'not-a-url']), /http/);
});

test('runtime: approve the plan → @김상성 notice → personal agent result → T-1 checked → T-2 starts for the UX Agent on its own', async t => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ensemble-team-'));
  const runtime = new WebRuntime({ dataDir, store: new MemoryLedgerStore(), llm: new FakePmLlm(), timers: false });
  t.after(async () => { await runtime.stop(); rmSync(dataDir, { recursive: true, force: true }); });
  await runtime.state('owner'); // initialized before switching projects
  await runtime.startScenario(TEAM_SCENARIO);
  let vm = await runtime.state('owner');
  assert.equal(vm.scenario?.nextLine?.external, undefined);
  assert.equal(vm.cards[0]?.id, TEAM_PROPOSAL_ID);

  await runtime.launchScenario();
  const until = async (check: () => Promise<boolean>, label: string) => {
    for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 25)); }
    assert.fail(`timed out: ${label}`);
  };
  const state = async () => project(await runtime.store.read({ projectId: runtime.meta.projectId }));
  // The real start notice for a reserved human task (orchestrator wording): "@김상성 로그인 API 구현을 곧 시작합니다."
  const notice = (m: { kind: string; text: string }) => m.kind === 'pm' && m.text.startsWith('@김상성') && m.text.includes('로그인 API 구현');
  await until(async () => (await runtime.state('owner')).messages.some(notice), 'PM tells 김상성 in the channel');
  assert.equal((await state()).tasks.get('T-1')?.status, 'reserved');
  vm = await runtime.state('owner');
  assert.equal(vm.scenario?.nextLine?.external, true);
  await assert.rejects(runtime.launchScenario(), { code: 'scenario_external' });

  // Stand-in for W1's endpoint: record the result as the contract describes, then let the PM review it.
  const person = { kind: 'human' as const, id: kim };
  await runtime.store.append([
    { ...context, projectId: runtime.meta.projectId, actor: person, type: 'attachment_recorded', payload: { attachmentId: 'pr-link', name: 'Pull Request', mimeType: 'text/uri-list', uri: PR, taskId: 'T-1' } },
    { ...context, projectId: runtime.meta.projectId, actor: person, type: 'attachment_recorded', payload: { attachmentId: 'report', name: 'T-1 결과 보고.md', mimeType: 'text/markdown', uri: `data:text/markdown;base64,${Buffer.from(report()).toString('base64')}`, taskId: 'T-1' } },
    { ...context, projectId: runtime.meta.projectId, actor: person, type: 'result_submitted', payload: { taskId: 'T-1', resultId: 'r-1', planVersion: 1, summary: '로그인 API 구현', artifactIds: ['report'], via } as never },
  ]);
  const outcome = await runtime.pm.retryValidation('T-1', 'r-1');
  assert.equal(outcome.kind, 'checked');
  await until(async () => (await state()).tasks.get('T-2')?.status === 'running', 'T-2 started by the UX Agent');

  vm = await runtime.state('owner');
  const auto = vm.messages.find(m => m.autoStart);
  assert.ok(auto, 'the channel says T-2 started because T-1 was checked');
  assert.equal(auto!.autoStart!.fromTaskId, 'T-1');
  assert.equal(auto!.autoStart!.toTaskId, 'T-2');
  assert.equal(auto!.autoStart!.viaLabel, 'IDE · 김상성의 Coding Agent');
  assert.equal(vm.work!.items.find(i => i.id === 'T-2')!.autoStartedBy?.agentName, 'UX Agent');
  const detail = await runtime.task('T-2', 'owner');
  assert.ok(detail.activity.some(a => a.kind === 'started' && a.text.includes('자동으로')));

  // The UX Agent's demo review passes the same real review; the release decision goes back to a person.
  await until(async () => (await state()).tasks.get('T-2')?.status === 'checked', 'T-2 checked');
  await until(async () => (await runtime.state('owner')).scenario?.done === true, 'scenario done');
  assert.equal((await state()).tasks.get('T-3')?.status, 'reserved');
});
