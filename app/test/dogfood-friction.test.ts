import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { LedgerEvent } from '@ensemble/core';
import { parseArgs, runLayout } from '../dogfood/config.ts';
import type { ClaudeRunInput, ClaudeRunResult } from '../dogfood/claude.ts';
import {
  FRICTION_SCHEMA,
  overlapCandidates,
  ruleFrictions,
  runFrictionRecorder,
  selfReworkCandidates,
  type FrictionWindow,
} from '../dogfood/friction.ts';
import { DogfoodLedger } from '../dogfood/ledger.ts';
import type { RoleContext } from '../dogfood/role-context.ts';
import { collectAgentUsage, dedupeUsage, findTranscriptDir, findTranscriptDirs, parseTranscript, sanitize } from '../dogfood/usage.ts';

let seq = 0;
function ev(type: string, payload: Record<string, unknown>, actorId = 'dogfood-harness'): LedgerEvent {
  seq += 1;
  return { id: `e${seq}`, seq, type, projectId: 'p', targetProductId: 't', actor: { kind: 'system', id: actorId }, at: '2026-10-19T00:00:00.000Z', payload };
}

const spec = (id: string, title: string, assignee: string) => ({ id, title, assignee, dependsOn: [] as string[], handoffConditions: ['조건 하나'] });

function plan(version: number, tasks: ReturnType<typeof spec>[]): LedgerEvent {
  return ev('plan_committed', { version, basedOn: version === 1 ? null : version - 1, tasks, reason: '테스트', approvedBy: 'owner', sourceMessageIds: [] }, 'pm');
}

/** reserved -> started -> submitted -> checked 까지 밀어 task를 checked로 만든다. */
function check(taskId: string, version: number): LedgerEvent[] {
  return [
    ev('task_start_reserved', { taskId, specVersion: version, trigger: `t-${taskId}` }, 'pm'),
    ev('task_started', { taskId, turnId: `turn-${taskId}` }, 'pm'),
    ev('result_submitted', { taskId, resultId: `r-${taskId}`, planVersion: version, summary: '결과', artifactIds: [] }),
    ev('task_checked', { taskId, resultId: `r-${taskId}`, reason: '충족' }, 'pm'),
  ];
}

const session = (teammate: string, cycle: number, extra: Record<string, unknown> = {}) =>
  ev('dogfood_teammate_session', { teammate, cycle, jobs: [], readyToMerge: true, backlogItems: [], commits: [], ...extra });

function window(product: LedgerEvent[], harness: LedgerEvent[], extra: Partial<FrictionWindow> = {}): FrictionWindow {
  return { cycle: 1, product, harness, productFrom: 0, harnessFrom: 0, backlog: [], ...extra };
}

test('sanitize: 영숫자 아닌 문자는 모두 하이픈', () => {
  assert.equal(sanitize('C:\\Users\\a.b\\run 1/agents'), 'C--Users-a-b-run-1-agents');
  assert.equal(sanitize('/home/a_b'), '-home-a-b');
});

test('transcript: 같은 응답의 중복 줄은 마지막 값 한 건, synthetic 제외, 파일 간 중복 제거', () => {
  const row = (id: string, out: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: 'assistant', requestId: `req-${id}`, sessionId: 's1', timestamp: '2026-10-19T01:00:00.000Z',
      message: { id: `msg-${id}`, model: 'claude-x', usage: { input_tokens: 10, output_tokens: out, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } },
      ...extra,
    });
  const text = [
    row('a', 1),
    row('a', 7),
    '깨진 줄',
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { id: 'syn', model: '<synthetic>', usage: { input_tokens: 1, output_tokens: 1 } } }),
    row('b', 3),
  ].join('\n');
  const list = parseTranscript(text);
  assert.equal(list.length, 2);
  const a = list.find((u) => u.key === 'msg-a:req-a')!;
  assert.deepEqual(
    { i: a.inputTokens, o: a.outputTokens, r: a.cacheReadTokens, c: a.cacheCreationTokens },
    { i: 115, o: 7, r: 100, c: 5 },
  );
  const merged = dedupeUsage([list, parseTranscript(row('a', 7)), parseTranscript(row('c', 2))]);
  assert.deepEqual(merged.map((u) => u.key).sort(), ['msg-a:req-a', 'msg-b:req-b', 'msg-c:req-c']);
});

test('findTranscriptDir: 정확히 같은 이름, 대소문자 차이, 하위 작업 폴더', () => {
  const root = mkdtempSync(join(tmpdir(), 'dogfood-usage-'));
  const workspace = 'C:\\runs\\iter1\\agents';
  const exact = sanitize(workspace);
  for (const name of [exact, `${exact}-proj-research-agent`, `${exact}-proj-prototype-agent`, `${exact}2`, 'D--other']) mkdirSync(join(root, name));
  assert.equal(findTranscriptDir(root, workspace), join(root, exact));
  assert.equal(findTranscriptDir(root, 'c:\\runs\\iter1\\agents'), join(root, exact));
  assert.equal(findTranscriptDir(root, 'C:\\none'), undefined);
  assert.equal(findTranscriptDir(join(root, 'no-such-dir'), workspace), undefined);
  const dirs = findTranscriptDirs(root, workspace).map((d) => d.slice(root.length + 1));
  assert.deepEqual(dirs, [exact, `${exact}-proj-research-agent`, `${exact}-proj-prototype-agent`].sort((a, b) => a.length - b.length || a.localeCompare(b)));
});

test('collectAgentUsage: 원장에 한 번만 기록하고 agentId를 붙인다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-collect-'));
  const projects = join(dir, 'projects');
  const agentsRoot = join(dir, 'agents');
  const tdir = join(projects, `${sanitize(agentsRoot)}-proj-research-agent`);
  mkdirSync(tdir, { recursive: true });
  const line = JSON.stringify({ type: 'assistant', requestId: 'r1', sessionId: 's', timestamp: '2026-10-19T02:00:00.000Z', message: { id: 'm1', model: 'claude-x', usage: { input_tokens: 4, output_tokens: 6, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } } });
  writeFileSync(join(tdir, 's.jsonl'), `${line}\n${line}\n`);
  const ledger = new DogfoodLedger(join(dir, 'dogfood.db'), 'run');
  try {
    const first = await collectAgentUsage({ ledger, agentsRoot, cycle: 1, projectsRoot: projects });
    const second = await collectAgentUsage({ ledger, agentsRoot, cycle: 2, projectsRoot: projects });
    assert.equal(first.recorded, 1);
    assert.equal(second.recorded, 0);
    const events = (await ledger.read()).filter((e) => e.type === 'dogfood_usage_recorded');
    assert.equal(events.length, 1);
    const p = events[0]!.payload as Record<string, unknown>;
    assert.equal(p.source, 'ensemble-agent');
    assert.equal(p.agentId, 'research-agent');
    assert.equal(p.inputTokens, 14);
    assert.equal(events[0]!.at, '2026-10-19T02:00:00.000Z');
  } finally {
    ledger.close();
  }
});

test('overlapCandidates: designer와 teammate-a는 한 사람, plantedSolo 제외, 계획 밖 항목은 1', () => {
  const product = [
    plan(1, [
      spec('t-b02', '[B-02] 화면 설계', 'designer'),
      spec('t-b03', '[B-03] 계획된 solo 항목', 'prototype-agent'),
      spec('t-b04', '[B-04] 계획 밖 항목', 'prototype-agent'),
    ]),
  ];
  const harness = [
    ev('dogfood_run_started', { plantedSolo: ['B-03'] }),
    session('teammate-a', 1, { backlogItems: ['B-02'] }),
    session('teammate-b', 1, { backlogItems: ['B-03', 'B-04'] }),
  ];
  const found = overlapCandidates(product, harness);
  assert.deepEqual(found.map((c) => c.key), ['overlap:B-04:prototype-agent+teammate-b']);
  assert.equal(found[0]!.kind, 'overlap');
  // 일감(assigned)으로 보드 작업을 대신 한 세션은 같은 구현이라 단위로 세지 않는다.
  const viaJob = overlapCandidates(product, [
    ev('dogfood_run_started', { plantedSolo: [] }),
    session('teammate-b', 1, { backlogItems: ['B-04'], jobs: [{ kind: 'integrate', ref: 't-b04' }] }),
  ]);
  assert.equal(viaJob.length, 0);
});

test('selfReworkCandidates: 같은 행위자·같은 B-id의 서로 다른 구현 ref 2개 이상', () => {
  const product = [
    plan(1, [spec('t1', '[B-05] 첫 구현', 'designer'), spec('t2', '[B-05] 다시 구현', 'designer'), spec('t3', '[B-06] 한 번', 'designer')]),
    ...check('t1', 1),
    ...check('t2', 1),
    ...check('t3', 1),
  ];
  const harness = [
    session('teammate-b', 1, { backlogItems: ['B-07'], commits: ['c1'] }),
    session('teammate-b', 2, { backlogItems: ['B-07'], commits: ['c2'] }),
    session('teammate-b', 3, { backlogItems: ['B-08'], commits: [] }),
    session('teammate-b', 4, { backlogItems: ['B-08'], commits: ['c3'] }),
    // 보드 작업 t3의 일감으로 한 세션은 같은 구현이다.
    session('teammate-a', 2, { backlogItems: ['B-06'], commits: ['c4'], jobs: [{ kind: 'assigned', ref: 't3' }] }),
  ];
  const keys = selfReworkCandidates(product, harness).map((c) => c.key);
  assert.deepEqual(keys, ['rework:B-05:teammate-a', 'rework:B-07:teammate-b']);
});

const keysOf = (w: FrictionWindow, rule: string) => ruleFrictions(w).filter((f) => f.rule === rule);

test('ruleFrictions R1·R14·R15·R3·R16·R17: 하네스 원장 규칙', () => {
  const harness = [
    ev('dogfood_proxy_action', { action: { type: 'next_step_request' }, ok: true, via: 'live' }),
    ev('dogfood_proxy_action', { action: { type: 'next_step_request' }, ok: false, via: 'live', error: '실패' }),
    ev('dogfood_proxy_action', { action: { type: 'owner_code_redirect' }, ok: true, via: 'rule' }),
    ev('dogfood_human_task_submitted', { via: 'fallback' }),
    ev('dogfood_human_task_submitted', { via: 'misrouted' }),
    ev('dogfood_human_task_submitted', { via: 'http' }),
    ev('dogfood_infra_pause', { from: 'a', until: 'b', reason: 'usage limit', source: 'friction-recorder' }),
    ev('dogfood_role_note', { role: 'harness', cycle: 1, kind: 'info', text: 'plan_draft_failed: ENAMETOOLONG' }),
    ev('dogfood_role_note', { role: 'harness', cycle: 1, kind: 'info', text: 'plan_draft_failed: 형식 오류' }),
    ev('dogfood_role_note', { role: 'harness', cycle: 1, kind: 'info', text: '그냥 메모' }),
  ];
  const w = window([], harness);
  const r1 = keysOf(w, 'R1');
  assert.equal(r1.length, 1);
  assert.deepEqual([r1[0]!.gap, r1[0]!.category, r1[0]!.severity], ['G7', 'intervention', 'medium']);
  assert.deepEqual(keysOf(w, 'R14').map((f) => f.gap), ['G13']);
  assert.deepEqual(keysOf(w, 'R15').map((f) => [f.gap, f.severity]), [['G4', 'high']]);
  assert.deepEqual(keysOf(w, 'R3').map((f) => f.gap), ['G4']);
  const r16 = keysOf(w, 'R16');
  assert.equal(r16.length, 1);
  assert.equal(r16[0]!.harnessNoise, true);
  assert.deepEqual(keysOf(w, 'R17').map((f) => f.gap), ['G14', 'G5']);
  // 실패한 대리 행동은 잡음 R7이다.
  assert.deepEqual(keysOf(w, 'R7').map((f) => f.harnessNoise), [true]);
  // 창 밖(harnessFrom 이전) 이벤트는 세지 않는다.
  assert.equal(ruleFrictions(window([], harness, { harnessFrom: harness.at(-1)!.seq })).length, 0);
});

test('ruleFrictions R5: 새 사유 2종은 G14, 보완은 G5, 그 밖은 UNMAPPED, infra는 R16', () => {
  const product = [
    plan(1, [spec('t1', '작업 1', 'research-agent')]),
    ev('task_blocked', { taskId: 't1', reason: '결과를 받지 못했습니다' }),
    ev('task_blocked', { taskId: 't1', reason: '작업이 중단되었습니다' }),
    ev('task_blocked', { taskId: 't1', reason: '세션 오류가 났습니다' }),
    ev('task_blocked', { taskId: 't1', reason: '보완이 필요합니다' }),
    ev('task_blocked', { taskId: 't1', reason: '알 수 없는 이유' }),
    ev('task_blocked', { taskId: 't1', reason: 'usage limit reached, resets 5pm' }),
  ];
  const w = window(product, []);
  assert.deepEqual(keysOf(w, 'R5').map((f) => f.gap), ['G14', 'G14', 'G14', 'G5', 'UNMAPPED']);
  const r16 = keysOf(w, 'R16');
  assert.equal(r16.length, 1);
  assert.equal(r16[0]!.harnessNoise, true);
});

test('ruleFrictions R13: argv 초과와 PM 판단 실패 사유', () => {
  const failed = ev('pm_considered', { considerationId: 'c1', triggerId: 'x', whoseAction: null, alreadyKnows: 'no', evidence: [], decision: 'speak', reason: 'judgement_failed', openTopics: [] }, 'pm');
  const failed2 = ev('pm_considered', { considerationId: 'c2', triggerId: 'y', whoseAction: null, alreadyKnows: 'no', evidence: [], decision: 'speak', reason: '결과 내용이 아니라 판단 과정의 문제라 사람이 결과를 확인해야 한다', openTopics: [] }, 'pm');
  const fine = ev('pm_considered', { considerationId: 'c3', triggerId: 'x', whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: '이미 안다', openTopics: [] }, 'pm');
  const w = window([failed, failed2, fine], [], { argvOverflow: { chars: 33000, tool: 'interpret' } });
  const r13 = keysOf(w, 'R13');
  assert.equal(r13.length, 3);
  assert.ok(r13.every((f) => f.gap === 'G14' && f.severity === 'high'));
  assert.equal(keysOf(window([fine], []), 'R13').length, 0);
});

test('ruleFrictions R12: 프로브의 perQuestion을 questions와 id로 조인해 mate 오답은 G1, task 오답은 G2', () => {
  const probe = (perQuestion: { id: string; correct: boolean }[], extra: Record<string, unknown> = {}) =>
    ev('dogfood_status_probe', {
      cycle: 1,
      correct: perQuestion.filter((p) => p.correct).length,
      total: perQuestion.length,
      perQuestion,
      questions: [{ id: 'q1', kind: 'mate', expected: {} }, { id: 'q2', kind: 'task', expected: {} }],
      ...extra,
    });
  assert.deepEqual(keysOf(window([], [probe([{ id: 'q1', correct: false }, { id: 'q2', correct: true }])]), 'R12').map((f) => f.gap), ['G1']);
  assert.deepEqual(keysOf(window([], [probe([{ id: 'q1', correct: true }, { id: 'q2', correct: false }])]), 'R12').map((f) => f.gap), ['G2']);
  assert.deepEqual(keysOf(window([], [probe([{ id: 'q1', correct: false }, { id: 'q2', correct: false }])]), 'R12').map((f) => f.gap).sort(), ['G1', 'G2']);
  assert.equal(keysOf(window([], [probe([{ id: 'q1', correct: true }, { id: 'q2', correct: true }])]), 'R12').length, 0);
  // 프로브 실행 자체가 실패한 기록은 R12 대상이 아니다.
  assert.equal(keysOf(window([], [probe([{ id: 'q1', correct: false }, { id: 'q2', correct: false }], { failed: true })]), 'R12').length, 0);
});

test('ruleFrictions R13: judgement_failed 이벤트도 세고 같은 triggerId는 한 건', () => {
  const considered = (triggerId: string) => ev('pm_considered', { considerationId: `c-${triggerId}`, triggerId, whoseAction: null, alreadyKnows: 'no', evidence: [], decision: 'speak', reason: 'judgement_failed', openTopics: [] }, 'pm');
  const failed = (triggerId: string) => ev('judgement_failed', { triggerId, stage: 'judgement', reason: '재생성 후에도 모델 응답 검증 실패' }, 'pm');
  // directQuestion 등으로 pm_considered 사유가 달라도 judgement_failed 이벤트는 잡힌다.
  assert.equal(keysOf(window([failed('m1')], []), 'R13').length, 1);
  // 같은 trigger의 두 이벤트는 중복으로 세지 않는다.
  assert.equal(keysOf(window([failed('m2'), considered('m2')], []), 'R13').length, 1);
  assert.equal(keysOf(window([failed('m3'), considered('m4')], []), 'R13').length, 2);
});

test('ruleFrictions R9: 보드에서만 끝난 Agent 담당 항목, 사이클 끝에 1회', () => {
  const product = [
    plan(1, [spec('t1', '[B-01] 에이전트 작업', 'research-agent'), spec('t2', '[B-02] 사람 작업', 'designer')]),
    ...check('t1', 1),
    ...check('t2', 1),
  ];
  const verifiedB01 = ev('dogfood_backlog_progress', { itemId: 'B-01', status: 'done', by: 'harness', evidence: 'merge' });
  const r9 = keysOf(window(product, []), 'R9');
  assert.deepEqual(r9.map((f) => f.key), ['R9:B-01']);
  assert.deepEqual([r9[0]!.gap, r9[0]!.category], ['G8', 'integration']);
  assert.equal(keysOf(window(product, [verifiedB01]), 'R9').length, 0);
});

test('ruleFrictions 나머지: R2·R4·R6·R8·R10·R11·R12', () => {
  const product = [
    plan(1, ['research', 'interview', 'flow', 'prototype'].map((id) => spec(id, id, 'research-agent'))),
    ev('space_post_recorded', { postId: 'p1', participantId: 'teammate-b', kind: 'result', text: 'B-09 끝', clientPostId: 'c' }),
    ev('action_limit_reached', { count: 12, limit: 12 }),
  ];
  const harness = [
    ev('dogfood_manual_integration', { by: 'harness', branch: 'dogfood/teammate-b', into: 'main', commit: 'abc', files: [], cycle: 1, backlogItems: [], taskIds: [] }),
    ev('dogfood_integration_test', { ok: false }),
    ev('dogfood_status_probe', { correct: 1, total: 2, questions: [{ kind: 'mate', correct: false }, { kind: 'task', correct: true }] }),
    session('teammate-a', 1, { postedToSpace: true }),
  ];
  const w = window(product, harness, { software: true });
  assert.deepEqual(keysOf(w, 'R2').map((f) => f.gap), ['G1']);
  assert.deepEqual(keysOf(w, 'R4').map((f) => f.severity), ['low']);
  assert.deepEqual(keysOf(w, 'R6').map((f) => f.gap), ['G16']);
  assert.deepEqual(keysOf(w, 'R8').map((f) => f.gap), ['G1']);
  assert.deepEqual(keysOf(w, 'R10').map((f) => f.gap), ['G14']);
  assert.deepEqual(keysOf(w, 'R11').map((f) => f.gap), ['G5']);
  assert.deepEqual(keysOf(w, 'R12').map((f) => f.gap), ['G1']);
  assert.equal(keysOf(window(product, harness, { software: false }), 'R11').length, 0);
});

function fakeResult(structured: unknown, ok = true): ClaudeRunResult {
  return {
    ok, text: '', structured, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 }, model: 'm', costUsd: 0.01,
    sessionId: 's', durationMs: 5, exitCode: 0, timedOut: false, aborted: false, failureKind: ok ? null : 'other', stderrTail: '',
    ...(ok ? {} : { error: '실패' }),
  };
}

test('friction-recorder.md는 6000자 이하이고 R13~R17·solo 문구를 담고, 스키마도 6000자 이하', () => {
  const md = readFileSync(join(import.meta.dirname, '..', 'dogfood', 'roles', 'friction-recorder.md'), 'utf8');
  assert.ok(md.length <= 6000, `md ${md.length}자`);
  assert.match(md, /계획 표본\(solo\) 중복은 하네스가 따로 세므로 기록하지 않는다/);
  for (const r of ['R13', 'R14', 'R15', 'R16', 'R17']) assert.ok(md.includes(r), r);
  assert.ok(JSON.stringify(FRICTION_SCHEMA).length <= 6000);
});

test('runFrictionRecorder: 멱등 기록, live 기록자는 근거·후보를 검증하고 새 갭을 G17부터 제안', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-friction-'));
  const { config } = parseArgs(['run', '--target', 'seed', '--run-dir', join(dir, 'run'), '--mode', 'live']);
  const layout = runLayout(config.runDir);
  mkdirSync(layout.logs, { recursive: true });
  mkdirSync(layout.probeCwd, { recursive: true });
  const ledger = new DogfoodLedger(layout.ledger, config.runId);
  try {
    const product = [
      plan(1, [spec('t-b04', '[B-04] 계획 밖 항목', 'prototype-agent')]),
      ev('action_limit_reached', { count: 12, limit: 12 }),
    ];
    await ledger.record('dogfood_run_started', { plantedSolo: [] } as never);
    await ledger.record('dogfood_cycle_started', { cycle: 1 });
    await ledger.record('dogfood_teammate_session', { teammate: 'teammate-b', cycle: 1, backlogItems: ['B-04'], commits: ['c'], jobs: [], readyToMerge: true } as never);
    const before = (await ledger.read()).length;
    const harnessIds = (await ledger.read()).map((e) => e.id);
    const limitId = product[1]!.id;
    const calls: ClaudeRunInput[] = [];
    const answer = {
      frictions: [
        { category: 'duplicate', summary: 'B-04를 Agent와 teammate-b가 각각 구현했다', evidence: ['overlap:B-04:prototype-agent+teammate-b', harnessIds[2]], gap: 'G10', severity: 'high', confirmsCandidate: 'overlap:B-04:prototype-agent+teammate-b' },
        { category: 'duplicate', summary: '후보에 없는 중복', evidence: [limitId], gap: 'G10', severity: 'high', confirmsCandidate: 'overlap:B-99:x+y' },
        { category: 'other', summary: '근거 없는 항목', evidence: ['없는-id'], gap: 'G1', severity: 'low' },
        { category: 'handoff', summary: '새 종류의 마찰', evidence: [limitId], gap: 'NEW', newGapTitle: '새 갭', severity: 'medium', mergesKeys: [`R6:${limitId}`, 'R6:없음'] },
      ],
    };
    const ctx = {
      config, layout, ledger, backlog: [], goal: '목표', cycle: 1, signal: new AbortController().signal,
      host: { events: async () => product, argvOverflow: () => undefined },
    } as unknown as RoleContext;
    const run = async (input: ClaudeRunInput) => { calls.push(input); return fakeResult(answer); };

    const first = await runFrictionRecorder(ctx, { run });
    assert.equal(first.rule, 1);
    assert.equal(first.candidates, 1);
    assert.equal(first.agent, 2);
    assert.equal(first.gaps, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.tools, 'none');
    assert.ok((calls[0]!.systemPrompt ?? '').length <= 6000);

    const frictions = (await ledger.read()).filter((e) => e.type === 'dogfood_friction_recorded').map((e) => e.payload as Record<string, unknown>);
    assert.equal(frictions.length, 3);
    const dup = frictions.find((f) => f.category === 'duplicate')!;
    assert.equal(dup.recordedBy, 'agent');
    assert.equal(dup.confirmsCandidate, 'overlap:B-04:prototype-agent+teammate-b');
    const fresh = frictions.find((f) => f.summary === '새 종류의 마찰')!;
    assert.equal(fresh.gap, 'G17');
    assert.deepEqual(fresh.mergesKeys, [`R6:${limitId}`]);
    const gaps = (await ledger.read()).filter((e) => e.type === 'dogfood_gap_proposed');
    assert.equal(gaps.length, 1);
    assert.equal((gaps[0]!.payload as { gapId: string }).gapId, 'G17');

    // 같은 입력으로 다시 돌려도 새 기록이 없다(멱등).
    const second = await runFrictionRecorder(ctx, { run });
    assert.deepEqual([second.rule, second.candidates, second.agent, second.gaps], [0, 0, 0, 0]);
    const after = (await ledger.read()).filter((e) => !['dogfood_usage_recorded'].includes(e.type));
    assert.equal(after.length, before + 1 + 1 + 2 + 1);

    // 규칙 모드에서는 claude를 부르지 않는다.
    const ruleCtx = { ...ctx, config: { ...config, mode: 'rule' as const } } as unknown as RoleContext;
    let called = false;
    const ruleRun = await runFrictionRecorder(ruleCtx, { run: async () => { called = true; return fakeResult({}); } });
    assert.equal(called, false);
    assert.equal(ruleRun.ranAgent, false);

    // 기록자 실패는 던지지 않고 오류로 돌려준다.
    const failing = await runFrictionRecorder(ctx, { run: async () => fakeResult(undefined, false) });
    assert.equal(failing.ranAgent, true);
    assert.ok(failing.error);
  } finally {
    ledger.close();
  }
});
