import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AnyEvent, LedgerEvent } from '@ensemble/core';
import { parseArgs, repoRoot, runLayout } from '../dogfood/config.ts';
import { gitAvailable, productState } from '../dogfood/git.ts';
import { runIteration } from '../dogfood/loop.ts';
import type { DogfoodMetrics } from '../dogfood/metrics.ts';
import { loadRunLedgers } from '../dogfood/report.ts';

// 규칙 모드 스모크: claude CLI·네트워크·모델 없이 01 착수 -> 07 다음 단계 -> 02 계획 변경 고리를 한 바퀴 돈다.
// 기대 흐름: v1 승인 -> research fake·checked -> interview(owner) HTTP 미인식 -> 대체 제출 -> checked
// -> flow(designer)는 팀원 A가 커밋하고 하네스가 머지·대체 제출 -> checked -> prototype -> checked.
// 팀원 B는 1사이클에 B-03 solo를 머지하고 Space에 게시한다(verified).
// 유휴 상태가 되면 다음 단계 '[B-01] ...' -> v2(prototype-agent) -> checked -> board_only(R9) -> 팀원 A integrate -> verified.
// B-02, B-03(결정 대리가 Space를 보지 않고 요청하므로 보드 작업이 생긴다: 계획 표본 realized), B-04 순서로 반복한다.
// 모두 verified가 되면 done이다.
process.env.DOGFOOD_FORBID_CLAUDE = '1';

const hasGit = await gitAvailable();

const typed = (events: readonly LedgerEvent[]) => events as readonly AnyEvent[];

test('규칙 모드 스모크: 01 -> 07 -> 02 한 바퀴, B-01~B-04가 main에 반영되고 done으로 끝난다', { skip: !hasGit, timeout: 240_000 }, async (t) => {
  const envBefore = { ...process.env };
  const base = mkdtempSync(join(tmpdir(), 'dogfood-harness-'));
  // 아직 만들지 않은 하위 경로: assertFreshRunDir를 통과해야 한다.
  const runDir = join(base, 'run');
  const layout = runLayout(runDir);
  try {
    const { command, config } = parseArgs(['smoke', '--run-dir', runDir]);
    assert.equal(command, 'smoke');
    assert.deepEqual([config.mode, config.target, config.cycleMinutes, config.probeEvery], ['rule', 'seed', 0, 2]);

    const result = await runIteration(config);
    const reportText = existsSync(layout.report) ? readFileSync(layout.report, 'utf8') : '(report.md 없음)';
    const why = `정지 ${result.reason}${result.detail === undefined ? '' : `(${result.detail})`}, 사이클 ${result.cycles}\n--- report.md 앞 4000자 ---\n${reportText.slice(0, 4000)}`;

    assert.ok(existsSync(layout.report), `report.md가 있어야 합니다\n${why}`);
    const m = JSON.parse(readFileSync(layout.metrics, 'utf8')) as DogfoodMetrics | null;
    assert.ok(m, `metrics.json에 지표가 있어야 합니다\n${why}`);

    // ---- 지표
    assert.equal(m.workflow.planCommitted, true, `planCommitted\n${why}`);
    assert.ok(m.workflow.planVersion >= 2, `planVersion >= 2: ${m.workflow.planVersion}\n${why}`);
    assert.ok(m.coordination.beyondPlan >= 1, `beyondPlan >= 1: ${m.coordination.beyondPlan}\n${why}`);
    assert.ok(m.coordination.byInitiator.proxy >= 1, `byInitiator.proxy >= 1\n${why}`);
    assert.equal(m.coordination.beyondPlanByPm, 0, `beyondPlanByPm\n${why}`);
    assert.ok(m.coordination.inPlan >= 1, `inPlan >= 1: ${m.coordination.inPlan}\n${why}`);
    assert.ok((m.interventions.byType.initiate ?? 0) >= 1, `byType.initiate >= 1\n${why}`);
    assert.ok((m.interventions.byType.human_result_fallback ?? 0) >= 1, `byType.human_result_fallback >= 1\n${why}`);
    assert.ok(m.runs.turns >= 1, `runs.turns >= 1\n${why}`);
    assert.ok(m.statusLookup.probes >= 1, `statusLookup.probes >= 1\n${why}`);
    assert.equal(m.duplicates.planted.items, 1, `planted.items\n${why}`);
    assert.equal(m.duplicates.planted.realized, 1, `planted.realized: 결정 대리가 Space를 보지 않고 B-03을 요청해야 합니다\n${why}`);
    assert.ok(m.integration.tests >= 1, `integration.tests >= 1\n${why}`);
    assert.equal(m.integration.passRate, 1, `integration.passRate\n${why}`);
    assert.equal(m.integration.verifiedDone, 4, `integration.verifiedDone\n${why}`);
    const product = await productState(repoRoot());
    if (product.dirty) t.diagnostic('제품 코드(app/packages, app/apps)에 변경이 있어 productDirty 단언을 건너뜁니다');
    else assert.equal(m.productDirty, false, `productDirty\n${why}`);

    // ---- 원장
    const { product: events, harness } = await loadRunLedgers(runDir);
    assert.ok(
      typed(events).some((e) => e.type === 'space_post_recorded' && e.payload.participantId === 'teammate-b' && e.payload.text.includes('B-03')),
      `teammate-b가 B-03을 Space에 게시해야 합니다\n${why}`,
    );
    assert.ok(typed(events).some((e) => e.type === 'result_submitted' && e.actor.id === 'designer'), `designer 명의 result_submitted\n${why}`);
    const rules = new Set(harness.filter((e) => e.type === 'dogfood_friction_recorded').map((e) => (e.payload as { rule?: string }).rule));
    for (const rule of ['R1', 'R3', 'R9']) assert.ok(rules.has(rule), `마찰 ${rule}가 기록돼야 합니다(기록된 규칙: ${[...rules].join(',')})\n${why}`);
    const stopped = harness.findLast((e) => e.type === 'dogfood_run_stopped');
    assert.equal((stopped?.payload as { reason?: string } | undefined)?.reason, 'done', `run_stopped.reason\n${why}`);
    assert.equal(result.reason, 'done', why);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
    Object.assign(process.env, envBefore);
    rmSync(base, { recursive: true, force: true, maxRetries: 5 });
  }
});
