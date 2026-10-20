import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { project, type AnyEvent, type LedgerEvent } from '@ensemble/core';
import { parseBacklog } from '../dogfood/backlog.ts';
import { appDir, parseArgs, runLayout } from '../dogfood/config.ts';
import { startHost, type DogfoodHost } from '../dogfood/host.ts';
import { submitHumanResult } from '../dogfood/human-result.ts';
import { DogfoodLedger } from '../dogfood/ledger.ts';
import { runDecisionProxy, runMemberWorker } from '../dogfood/proxy.ts';
import { settle, type RoleContext } from '../dogfood/role-context.ts';

// 규칙 모드 WebRuntime(FakePmLlm, FakeConnector)으로 결정 대리·사람 몫 작업 대리의 행동이 제품 공개 메서드에서
// 예외 없이 끝나고 원장에 남는지 본다. claude CLI·네트워크·모델은 쓰지 않는다.
process.env.DOGFOOD_FORBID_CLAUDE = '1';

const TIMEOUT = 120_000;
const globalRuntime = globalThis as typeof globalThis & { ensembleRuntime?: unknown };

interface Rig { ctx: RoleContext; host: DogfoodHost; ledger: DogfoodLedger; close(): Promise<void> }

async function rig(): Promise<Rig> {
  const envBefore = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-proxy-rt-'));
  const { config } = parseArgs(['smoke', '--run-dir', join(dir, 'run'), '--human-result-wait-seconds', '10']);
  const layout = runLayout(config.runDir);
  mkdirSync(layout.root, { recursive: true });
  const ledger = new DogfoodLedger(layout.ledger, config.runId);
  const host = await startHost(config, layout, ledger);
  const backlog = parseBacklog(readFileSync(join(appDir(), 'dogfood', 'seed-project', 'BACKLOG.md'), 'utf8'));
  const ctx: RoleContext = { config, layout, host, ledger, backlog, goal: '회의록 검색 도구를 만든다', cycle: 1, signal: new AbortController().signal };
  return {
    ctx, host, ledger,
    async close() {
      await host.close();
      ledger.close();
      assert.equal(globalRuntime.ensembleRuntime, undefined);
      for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
      Object.assign(process.env, envBefore);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

const typed = (events: readonly LedgerEvent[]) => events as readonly AnyEvent[];
const count = (events: readonly LedgerEvent[], type: string) => events.filter((e) => e.type === type).length;

/** 새 자유 프로젝트를 시작하고 owner 대리가 계획을 승인하게 한다. */
async function startAndApprove(r: Rig): Promise<void> {
  await r.host.runtime.startFree('회의록 검색 도구를 만든다', undefined, 'owner', true);
  await settle(r.host, 30_000);
  const before = await r.host.events();
  assert.equal(project(before).pendingPlans.size, 1, '계획 카드가 승인을 기다린다');
  assert.equal(await runDecisionProxy(r.ctx, 'owner'), 1);
  await settle(r.host, 30_000);
}

async function actions(ledger: DogfoodLedger) {
  return (await ledger.read()).filter((e) => e.type === 'dogfood_proxy_action').map((e) => e.payload as { action: { type: string }; ok: boolean; interventionType: string; via: string });
}

test('계획 승인과 사람 결과 제출: HTTP 미인식 -> 대체 제출 -> checked, 이미 checked면 대체하지 않는다', { timeout: TIMEOUT }, async () => {
  const r = await rig();
  try {
    await startAndApprove(r);
    const afterApprove = await r.host.events();
    assert.equal(count(afterApprove, 'plan_committed'), 1);
    assert.equal(project(afterApprove).pendingPlans.size, 0);
    const [first] = await actions(r.ledger);
    assert.deepEqual([first?.action.type, first?.ok, first?.interventionType, first?.via], ['approve_plan', true, 'rubber_stamp', 'rule']);

    // owner 담당 interview 작업이 reserved가 될 때까지 tick과 settle을 반복한다.
    let taskId: string | undefined;
    for (let i = 0; i < 30 && taskId === undefined; i++) {
      await r.host.runtime.tick();
      await settle(r.host, 30_000);
      const state = project(await r.host.events());
      taskId = [...state.tasks.values()].find((t) => t.spec.assignee === 'owner' && t.status === 'reserved')?.spec.id;
    }
    assert.ok(taskId, 'owner 담당 작업이 reserved가 된다');

    assert.equal(await runMemberWorker(r.ctx), 1);
    await settle(r.host, 30_000);
    const harness = await r.ledger.read();
    const submissions = harness.filter((e) => e.type === 'dogfood_human_task_submitted').map((e) => e.payload as { via: string; resultId: string | null; taskId: string; actor: string });
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0]!.via, 'fallback', 'FakePmLlm은 route_message를 chat으로 처리하므로 HTTP 제출은 인식되지 않는다');
    assert.equal(submissions[0]!.taskId, taskId);
    assert.equal(submissions[0]!.actor, 'member-worker');
    assert.ok(submissions[0]!.resultId, '대체 제출이 resultId를 남긴다');

    const events = await r.host.events();
    assert.ok(typed(events).some((e) => e.type === 'result_submitted' && e.payload.taskId === taskId), 'result_submitted');
    assert.ok(typed(events).some((e) => e.type === 'task_checked' && e.payload.taskId === taskId), 'task_checked');
    assert.equal(project(events).tasks.get(taskId)?.status, 'checked');

    // 이미 checked된 작업에는 대체 제출하지 않는다(④ 상태 재확인).
    const resultsBefore = count(events, 'result_submitted');
    const again = await submitHumanResult(r.ctx, {
      memberId: 'owner', actor: 'member-worker', taskId, text: '다시 올립니다', files: [{ name: 'again.md', content: '합성 자료' }], firstSubmission: false,
    });
    await settle(r.host, 30_000);
    assert.equal(again.resultId, null);
    assert.equal(again.recognized, false);
    assert.notEqual(again.via, 'http');
    assert.equal(count(await r.host.events(), 'result_submitted'), resultsBefore, 'result_submitted가 늘지 않는다');
    const notes = (await r.ledger.read()).filter((e) => e.type === 'dogfood_role_note');
    assert.ok(notes.some((e) => /대체 제출을 생략/.test((e.payload as { text: string }).text)));
  } finally {
    await r.close();
  }
});

// ---- 제품 공개 메서드로 상태를 만든 뒤 대리를 부르는 분기들

const PM_ACTOR = { kind: 'pm' as const, id: 'pm' };

/** 제품 원장에 직접 append한다(제품 코드가 만드는 것과 같은 모양의 이벤트). 호출하는 곳마다 직접 append한 사실을 주석으로 남긴다. */
async function append(r: Rig, type: string, payload: unknown, actor: { kind: 'human' | 'pm' | 'system'; id: string } = PM_ACTOR): Promise<void> {
  const { runtime } = r.host;
  await runtime.store.append([{ projectId: runtime.meta.projectId, targetProductId: 'ensemble-demo', type, actor, payload } as never]);
}

async function waitFor(r: Rig, what: string, ok: (events: readonly LedgerEvent[]) => boolean, ms = 20_000): Promise<readonly LedgerEvent[]> {
  const until = Date.now() + ms;
  for (;;) {
    const events = await r.host.events();
    if (ok(events)) return events;
    if (Date.now() > until) assert.fail(`${what}: 기다리는 이벤트가 오지 않았습니다`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const option = (optionId: string, label: string, effects: unknown[], extra: Record<string, unknown> = {}) => ({ optionId, label, effects, tradeoff: '', ...extra });

function resolvedOf(events: readonly LedgerEvent[], requestId: string) {
  const e = typed(events).findLast((x) => x.type === 'decision_resolved' && x.payload.requestId === requestId);
  return e?.type === 'decision_resolved' ? e.payload : undefined;
}

function grantedOf(events: readonly LedgerEvent[], requestId: string): boolean | undefined {
  const e = typed(events).findLast((x) => x.type === 'authority_granted' && x.payload.requestId === requestId);
  return e?.type === 'authority_granted' ? e.payload.granted : undefined;
}

test('missing_info: 추천 옵션에 답 문구가 없으면 대리가 범위 안의 최소 답을 쓴다', { timeout: TIMEOUT }, async () => {
  const r = await rig();
  try {
    await startAndApprove(r);
    const task = [...project(await r.host.events()).tasks.values()].find((t) => t.spec.assignee === 'research-agent');
    assert.ok(task, '조사 Agent 작업이 있다');
    // 직접 append: 이 목표의 계획에는 fake Agent가 질문하는 작업(제목에 '로그인')이 없어서, 제품이 Agent 질문에서 만드는 것과
    // 같은 모양의 missing_info 결정 요청을 원장에 직접 남긴다. 답 문구가 없는 '답하기' 옵션이 추천이다.
    await append(r, 'decision_requested', {
      requestId: 'q-test', kind: 'missing_info', targetMemberId: 'owner', question: '조사 Agent가 범위를 묻습니다.',
      options: [option('answer', '답하기', [{ type: 'answer', taskId: task.spec.id, questionId: 'q1' }]), option('hold', '보류', [{ type: 'none' }])],
      recommendation: { optionId: 'answer', rationale: '답이 있어야 작업이 이어집니다.', evidence: [] },
      impact: { taskIds: [task.spec.id], blockedTaskIds: [task.spec.id] }, sourceMessageIds: [],
    });
    assert.equal(await runDecisionProxy(r.ctx, 'owner'), 1);
    const resolved = resolvedOf(await r.host.events(), 'q-test');
    assert.ok(resolved, 'decision_resolved가 남는다');
    assert.equal(resolved.outcome, 'answered');
    assert.match(resolved.answerText ?? '', /가장 작은 안/);
    const row = (await actions(r.ledger)).at(-1)!;
    assert.deepEqual([row.action.type, row.ok, row.interventionType], ['answer_decision', true, 'answer']);
  } finally {
    await r.close();
  }
});

test('plan_change: 추천이 이번 반복의 B-id 작업을 지우면 reject하고 dissent 노트를 남긴다', { timeout: TIMEOUT }, async () => {
  const r = await rig();
  try {
    await startAndApprove(r);
    const plan = project(await r.host.events()).plan!;
    // 직접 append: FakePmLlm의 계획에는 B-id 작업이 없으므로, B-02 작업이 든 2판 계획과 그 작업을 지우자는 결정 요청을 원장에 남긴다.
    const target = { id: 'b02', title: '[B-02] 액션아이템 파싱', assignee: 'prototype-agent', dependsOn: [], handoffConditions: ['조건 하나'] };
    await append(r, 'plan_committed', { version: plan.version + 1, basedOn: plan.version, tasks: [...plan.tasks, target], reason: '테스트', approvedBy: 'owner', sourceMessageIds: [] });
    await append(r, 'decision_requested', {
      requestId: 'pc-test', kind: 'plan_change', targetMemberId: 'owner', question: '이 작업을 취소할까요?',
      options: [
        option('cancel', '취소', [{ type: 'plan_ops', ops: [{ type: 'cancel_task', taskId: 'b02', reason: '중복', sourceMessageIds: [] }] }]),
        option('hold', '보류', [{ type: 'none' }]),
      ],
      recommendation: { optionId: 'cancel', rationale: '중복입니다.', evidence: [] },
      impact: { taskIds: ['b02'], blockedTaskIds: [] }, sourceMessageIds: [],
    });
    assert.equal(await runDecisionProxy(r.ctx, 'owner'), 1);
    const events = await r.host.events();
    assert.equal(resolvedOf(events, 'pc-test')?.outcome, 'rejected');
    assert.notEqual(project(events).tasks.get('b02')?.status, 'cancelled', '거절했으므로 작업은 취소되지 않는다');
    const row = (await actions(r.ledger)).at(-1)!;
    assert.deepEqual([row.action.type, row.ok, row.interventionType], ['answer_decision', true, 'override']);
    const note = (await r.ledger.read()).find((e) => e.type === 'dogfood_role_note');
    assert.ok(note);
    assert.deepEqual([(note.payload as { kind: string }).kind, (note.payload as { gapHint?: string }).gapHint], ['dissent', 'G5']);
  } finally {
    await r.close();
  }
});

test('멈춘 작업: resolve retry가 task_resumed를 남긴다', { timeout: TIMEOUT }, async () => {
  const r = await rig();
  try {
    await startAndApprove(r);
    const task = [...project(await r.host.events()).tasks.values()].find((t) => t.spec.assignee === 'owner' && t.status === 'reserved');
    assert.ok(task, '멈출 Agent 작업이 있다');
    // 직접 append: 제품이 세션 오류에서 남기는 task_blocked와 같은 이벤트(결과가 없으면 허용 행동은 retry뿐이다).
    await append(r, 'task_blocked', { taskId: task.spec.id, reason: '세션 오류로 멈춤' }, { kind: 'system', id: 'pm' });
    assert.equal(project(await r.host.events()).tasks.get(task.spec.id)?.status, 'blocked');
    assert.equal(await runDecisionProxy(r.ctx, 'owner'), 1);
    await waitFor(r, 'task_resumed', (es) => typed(es).some((e) => e.type === 'task_resumed' && e.payload.taskId === task.spec.id));
    const row = (await actions(r.ledger)).at(-1)!;
    assert.deepEqual([row.action.type, row.ok, row.interventionType], ['resolve_task', true, 'recover']);
    await settle(r.host, 30_000);
  } finally {
    await r.close();
  }
});

test('권한 카드: 가용 시간 변경은 승인하고, 목표 변경은 거절한다', { timeout: TIMEOUT }, async () => {
  const r = await rig();
  try {
    await startAndApprove(r);
    // 직접 append: 제품이 조정 결과에서 남기는 authority_requested. operationKey는 제품과 같은 키 순으로 정렬한 [키, 값] 쌍 목록 JSON이다.
    const key = (o: Record<string, unknown>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    await append(r, 'authority_requested', {
      requestId: 'auth-hours', operationKey: key({ type: 'set_availability', memberId: 'owner', weeklyHours: 12 }), personId: 'owner', changeKinds: ['human_commitment'], text: '가용 시간을 주 12시간으로 바꿉니다.',
    });
    await append(r, 'authority_requested', {
      requestId: 'auth-goal', operationKey: key({ type: 'change_goal', text: '전혀 다른 목표' }), personId: 'owner', changeKinds: ['goal_change'], text: '목표를 바꿉니다.',
    });
    assert.equal(await runDecisionProxy(r.ctx, 'owner'), 2);
    await settle(r.host, 30_000);
    const events = await r.host.events();
    assert.equal(grantedOf(events, 'auth-hours'), true);
    assert.equal(grantedOf(events, 'auth-goal'), false);
    assert.ok(typed(events).some((e) => e.type === 'availability_updated' && e.payload.memberId === 'owner' && e.payload.weeklyHours === 12), '승인한 가용 시간이 반영된다');
    assert.equal(project(events).goal?.text, '회의록 검색 도구를 만든다', '목표는 바뀌지 않는다');
    const rows = (await actions(r.ledger)).filter((a) => a.action.type === 'answer_authority');
    assert.deepEqual(rows.map((a) => [a.ok, a.interventionType]), [[true, 'rubber_stamp'], [true, 'override']]);
  } finally {
    await r.close();
  }
});
