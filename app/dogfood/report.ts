// report.md와 metrics.json. 두 원장(제품, 하네스)만 읽는다. 공식의 정본은 metrics.ts다.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LedgerEvent } from '@ensemble/core';
import { SqliteLedgerStore } from '@ensemble/store';
import { runLayout, type RunLayout } from './config.ts';
import { SEEDBED } from './friction.ts';
import { computeMetrics, type DogfoodMetrics } from './metrics.ts';

export interface RunLedgers {
  runId: string;
  runDir: string;
  product: LedgerEvent[];
  harness: LedgerEvent[];
}

/**
 * runDir의 두 원장을 읽는다. 제품 원장은 하네스 원장의 dogfood_iteration_project.projectId로 고르고,
 * 없으면 data/runtime.json의 projectId를 쓴다. 파일이 없으면 빈 원장이다.
 */
export async function loadRunLedgers(runDir: string): Promise<RunLedgers> {
  const layout = runLayout(runDir);
  let harness: LedgerEvent[] = [];
  let runId = '';
  if (existsSync(layout.ledger)) {
    const probe = new SqliteLedgerStore(layout.ledger);
    try {
      const all = await probe.read();
      const projectId = all.at(-1)?.projectId;
      harness = projectId === undefined ? [] : all.filter((e) => e.projectId === projectId);
      runId = projectId ?? '';
    } finally {
      probe.close();
    }
  }
  let projectId: string | undefined;
  for (const e of harness) if (e.type === 'dogfood_iteration_project') projectId = String((e.payload as { projectId?: unknown }).projectId ?? '');
  const dbFile = join(layout.data, 'ensemble.db');
  if (projectId === undefined) {
    try {
      const meta = JSON.parse(readFileSync(join(layout.data, 'runtime.json'), 'utf8')) as { projectId?: unknown };
      if (typeof meta.projectId === 'string') projectId = meta.projectId;
    } catch {
      projectId = undefined;
    }
  }
  let product: LedgerEvent[] = [];
  if (projectId !== undefined && existsSync(dbFile)) {
    const store = new SqliteLedgerStore(dbFile);
    try {
      product = await store.read({ projectId });
    } finally {
      store.close();
    }
  }
  return { runId, runDir, product, harness };
}

// ---------------------------------------------------------------------------------------------
// 표시 도우미

const pct = (v: number | null): string => (v === null ? '-' : `${(v * 100).toFixed(0)}%`);
const dec = (v: number | null, digits = 2): string => (v === null ? '-' : String(Number(v.toFixed(digits))));
const count = (v: number | null): string => (v === null ? '-' : String(v));
const tokens = (v: number): string => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
const dur = (v: number | null): string => {
  if (v === null) return '-';
  if (v < 1000) return `${Math.round(v)}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}초`;
  const m = s / 60;
  return m < 60 ? `${m.toFixed(1)}분` : `${(m / 60).toFixed(1)}시간`;
};
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = (head: string[], rows: string[][]): string => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

interface Row { label: string; value(m: DogfoodMetrics): string }

const ROWS: Row[] = [
  { label: '중복·재구현 합계', value: (m) => String(m.duplicates.total) },
  { label: '계획 표본 realized', value: (m) => `${m.duplicates.planted.realized}/${m.duplicates.planted.items}` },
  { label: '자연 발생 확인', value: (m) => `${m.duplicates.natural.confirmed}/${m.duplicates.natural.candidates}` },
  { label: '본인 재구현 확인', value: (m) => `${m.duplicates.selfRework.confirmed}/${m.duplicates.selfRework.candidates}` },
  { label: '현황 파악 시간(중앙값)', value: (m) => dur(m.statusLookup.medianMs) },
  { label: '현황 파악 성공 시간(중앙값)', value: (m) => dur(m.statusLookup.successMedianMs) },
  { label: '현황 평균 정답률', value: (m) => pct(m.statusLookup.accuracy) },
  { label: '개입 counted', value: (m) => String(m.interventions.counted) },
  { label: '개입 planned', value: (m) => String(m.interventions.planned) },
  { label: '작업당 개입', value: (m) => dec(m.interventions.perTask) },
  { label: '실행 성공률', value: (m) => pct(m.runs.successRate) },
  { label: '재실행 비율', value: (m) => pct(m.runs.rerunRatio) },
  { label: '첫 통과율', value: (m) => pct(m.runs.firstPassRate) },
  { label: 'PM 분해 수정 비율', value: (m) => pct(m.pmDecomposition.rate) },
  { label: '대리 동의율', value: (m) => pct(m.pmDecomposition.proxyAgreement) },
  { label: '가중 토큰 합계', value: (m) => tokens(m.cost.totalWeighted) },
  { label: '제품 가중 토큰', value: (m) => tokens(m.cost.productWeighted) },
  { label: '턴 시간(중앙값)', value: (m) => dur(m.cost.medianTurnMs) },
  { label: '리드타임(중앙값)', value: (m) => dur(m.cost.leadTimeMs?.median ?? null) },
  { label: '고리 inPlan', value: (m) => String(m.coordination.inPlan) },
  { label: '고리 beyond_plan', value: (m) => String(m.coordination.beyondPlan) },
  { label: 'pmLoopRatio', value: (m) => pct(m.coordination.pmLoopRatio) },
  { label: '통합 테스트 통과율', value: (m) => pct(m.integration.passRate) },
  { label: 'verifiedDone', value: (m) => String(m.integration.verifiedDone) },
  { label: 'boardOnly', value: (m) => String(m.integration.boardOnly) },
  { label: '마찰 수(잡음 제외 전)', value: (m) => String(m.frictions.total) },
];

function gapTitle(m: DogfoodMetrics, id: string): string {
  return SEEDBED.find((g) => g.id === id)?.title ?? m.frictions.proposedGaps.find((g) => g.gapId === id)?.title ?? (id === 'UNMAPPED' ? '모판에 없음' : id);
}

const ORIGINAL_P0 = ['G1', 'G4', 'G7', 'G10'];
const DRAFT_P0 = ['G1', 'G7', 'G10'];

// ---------------------------------------------------------------------------------------------
// report.md

/** report.md 본문. compare가 있으면 §2 표에 비교 열이 붙는다. */
export function renderReport(m: DogfoodMetrics | null, compare: DogfoodMetrics | null = null): string {
  if (m === null) return '# 도그푸딩 리포트\n\n원장에 기록이 없습니다. 실행이 시작되기 전이거나 runDir이 비어 있습니다.\n';
  const out: string[] = [];
  const h = (n: number, title: string) => out.push('', `## ${n}. ${title}`, '');
  out.push(`# 도그푸딩 리포트${m.runId ? `: ${m.runId}` : ''}`);

  // §1 개요
  h(1, '개요');
  out.push(table(['항목', '값'], [
    ['반복', m.iteration === null ? '-' : `Iter ${m.iteration}`],
    ['모드', m.mode ?? '-'],
    ['Ensemble 커밋', m.ensembleCommit ?? '-'],
    ['정지 이유', m.workflow.stopReason ? `${m.workflow.stopReason}${m.workflow.stopDetail ? ` (${m.workflow.stopDetail})` : ''}` : '실행 중이거나 정지 기록 없음'],
    ['사이클', String(m.workflow.cycles)],
    ['계획', `${m.workflow.planCommitted ? `확정 v${m.workflow.planVersion}` : m.workflow.planProposed ? '초안만 있음' : '없음'}${m.workflow.planAttempts === null ? '' : `, 초안 시도 ${m.workflow.planAttempts}회`}`],
    ['작업', `${m.workflow.tasks}개(checked ${m.workflow.checked}, 취소 ${m.workflow.cancelled})`],
    ['인프라 대기', m.infra.pauses === 0 ? '없음' : `${m.infra.pauses}회, ${dur(m.infra.pausedMs)}`],
  ]));
  const warnings: string[] = [];
  if (m.productDirty === true) warnings.push('경고: 제품 코드가 수정된 채로 실행됐습니다(productDirty). 기준선으로 쓸 수 없습니다.');
  if (m.productDirty === null) warnings.push('주의: run_started 기록이 없어 productDirty를 확인할 수 없습니다.');
  if (m.adapters?.pmSchemaRef) warnings.push('기준선 차이: PM 스키마 $ref 압축');
  if (m.adapters?.pathPrepend) warnings.push('기준선 차이: claude.exe 폴더를 PATH 앞에 붙임');
  if (m.integration.boardOnly > 0) warnings.push(`경고: 보드에서만 끝난 항목 ${m.integration.boardOnly}개(${m.integration.boardOnlyIds.join(', ')})가 main에 검증되지 않았습니다.`);
  if (m.infra.pausedMs > 0) warnings.push(`인프라 대기 ${dur(m.infra.pausedMs)}는 성공률 분모와 시간 비교에서 따로 봅니다.`);
  if (warnings.length > 0) out.push('', ...warnings.map((w) => `- ${w}`));

  // §2 지표 표
  h(2, '지표 표');
  const head = compare ? ['지표', '이번 실행', `비교${compare.runId ? `(${compare.runId})` : ''}`] : ['지표', '이번 실행'];
  out.push(table(head, ROWS.map((r) => (compare ? [r.label, r.value(m), r.value(compare)] : [r.label, r.value(m)]))));
  out.push('', '공식의 정본은 app/dogfood/metrics.ts다.');

  // §3 고리
  h(3, '07→02 고리 닫힘(G7 효과)');
  const c = m.coordination;
  out.push(table(['항목', '값'], [
    ['inPlan(07→04, 계획된 후속 시작)', String(c.inPlan)],
    ['sequenced(의존 없는 예약, 자원 대기 해소)', String(c.sequenced)],
    ['beyond_plan(계획 밖 새 작업)', String(c.beyondPlan)],
    ['주체 proxy / pm / teammate / unknown', `${c.byInitiator.proxy} / ${c.byInitiator.pm} / ${c.byInitiator.teammate} / ${c.byInitiator.unknown}`],
    ['pmLoopRatio', pct(c.pmLoopRatio)],
    ['고리 지연(중앙값)', dur(c.medianLoopLatencyMs)],
    ['상한 도달 시 대기 중 ready 작업', count(c.withheldReadyAtLimit)],
  ]));
  if (c.loops.length > 0) out.push('', table(['작업', '제목', '계획 버전', '주체', '결정 요청'], c.loops.map((l) => [l.taskId, l.title, `v${l.planVersion}`, l.initiator, l.decisionRequestId ?? '-'])));
  if (c.beyondPlan > 0 && c.byInitiator.pm === 0) out.push('', 'beyond_plan의 PM 주체가 0이다. 후속 작업이 모두 사람(대리) 요청에서 나왔다는 뜻이고, Iter 1의 기대 기준선이다.');

  // §4 중복
  h(4, '중복·재구현');
  const d = m.duplicates;
  out.push(table(['항목', '값'], [
    ['합계(planted.realized + natural.confirmed)', String(d.total)],
    ['계획 표본', `${d.planted.items}개 중 realized ${d.planted.realized}, avoided ${d.planted.avoided}${d.planted.realizedIds.length ? ` (${d.planted.realizedIds.join(', ')})` : ''}`],
    ['자연 발생', `후보 ${d.natural.candidates}, 확인 ${d.natural.confirmed}`],
    ['본인 재구현(따로 보고)', `후보 ${d.selfRework.candidates}, 확인 ${d.selfRework.confirmed}`],
  ]));

  // §5 개입과 PM 분해
  h(5, '개입과 PM 분해');
  const i = m.interventions;
  out.push(table(['항목', '값'], [
    ['counted / planned', `${i.counted} / ${i.planned}`],
    ['작업당 개입', `${dec(i.perTask)} (작업 ${i.tasks}개)`],
    ['rubber_stamp', String(i.rubberStamp)],
    ['유형별', Object.entries(i.byType).map(([k, v]) => `${k} ${v}`).join(', ') || '-'],
    ['제품 원장 사람 행위(교차 확인)', String(i.ledgerHumanActs)],
    ['하네스 원장 사람 행위', String(i.harnessHumanActs)],
  ]));
  if (i.ledgerHumanActs !== i.harnessHumanActs) out.push('', `차이: 제품 원장 ${i.ledgerHumanActs}건, 하네스 원장 ${i.harnessHumanActs}건. 대리 행위가 하네스 원장에 빠졌거나 제품에 사람 입력이 따로 있다. 하네스 원장이 정본이다.`);
  const p = m.pmDecomposition;
  out.push('', table(['PM 분해', '값'], [
    ['분모(PM이 만든 작업)', String(p.drafted)],
    ['분자(고쳐지거나 거절·취소된 작업)', `${p.corrected} (${pct(p.rate)})`],
    ['사유별', Object.entries(p.byReason).map(([k, v]) => `${k} ${v}`).join(', ') || '-'],
    ['v1 템플릿 작업', String(p.v1TemplateTasks)],
    ['proxyAgreement', pct(p.proxyAgreement)],
  ]));

  // §6 실행·통합
  h(6, '실행 품질과 통합 건강도');
  const r = m.runs;
  const g = m.integration;
  out.push(table(['항목', '값'], [
    ['턴', `${r.turns}개(성공 ${r.succeeded}, 실패 ${r.failed}, 인프라 실패 ${r.infraFailed}, 미종료 ${r.unfinished})`],
    ['성공률 / 재실행 비율 / 첫 통과율', `${pct(r.successRate)} / ${pct(r.rerunRatio)} / ${pct(r.firstPassRate)}`],
    ['팀원 세션', `${r.teammateSessions.total}개 중 커밋 ${r.teammateSessions.withCommit} (${pct(r.teammateSessions.successRate)})`],
    ['머지 / 충돌', `${g.merges} / ${g.conflicts}`],
    ['통합 테스트', `${g.tests}회, 통과율 ${pct(g.passRate)}`],
    ['checkedButRed', String(g.checkedButRed)],
    ['verifiedDone / boardDone / boardOnly', `${g.verifiedDone} / ${g.boardDone} / ${g.boardOnly}`],
  ]));

  // §7 비용과 현황
  h(7, '토큰·시간과 현황 파악');
  const k = m.cost;
  out.push(table(['출처', 'raw', 'weighted', '캐시 읽기', '캐시 생성'], (['pm', 'ensemble-agent', 'harness'] as const).map((s) => [s, tokens(k.bySource[s].raw), tokens(k.bySource[s].weighted), tokens(k.bySource[s].cacheRead), tokens(k.bySource[s].cacheCreation)])));
  out.push('', table(['항목', '값'], [
    ['제품(pm + agent) 대 하네스 가중 토큰', `${tokens(k.productWeighted)} 대 ${tokens(k.harnessWeighted)}`],
    ['합계 raw / weighted', `${tokens(k.totalRaw)} / ${tokens(k.totalWeighted)}`],
    ['claude -p 비용 합', `$${k.costUsd.toFixed(2)}`],
    ['역할별 weighted', Object.entries(k.byRole).map(([role, v]) => `${role} ${tokens(v.weighted)}`).join(', ') || '-'],
    ['턴 시간', `${k.turnRuns}개, 중앙값 ${dur(k.medianTurnMs)}, 합계 ${dur(k.totalTurnMs)}`],
    ['턴 토큰', k.agentTokensMeasured ? (k.turnTokens ? `중앙값 ${tokens(k.turnTokens.median)}, 합계 ${tokens(k.turnTokens.total)}` : '턴 구간에 든 usage 없음') : '측정 불가'],
    ['리드타임', k.leadTimeMs ? `중앙값 ${dur(k.leadTimeMs.median)}, p90 ${dur(k.leadTimeMs.p90)} (${k.leadTimeMs.count}건)` : '-'],
    ['현황 프로브', `${m.statusLookup.probes}회, 중앙값 ${dur(m.statusLookup.medianMs)}, 성공 시간 ${dur(m.statusLookup.successMedianMs)}, 정답률 ${pct(m.statusLookup.accuracy)}, 프로브 토큰 ${tokens(m.statusLookup.tokens.weighted)}`],
  ]));
  if (!k.agentTokensMeasured) out.push('', 'ensemble-agent usage가 0건이라 실행 Agent 토큰은 측정 불가다(제품이 usage를 남기지 않는다, G15).');

  // §8 P0 제안
  h(8, 'P0 확정 제안(마찰 점수)');
  const scored = Object.entries(m.frictions.byGap).sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count || a[0].localeCompare(b[0]));
  if (scored.length === 0) out.push('점수가 매겨진 마찰이 없다.');
  else {
    out.push(table(['순위', '갭', '제목', '건수', '점수', '원 P0', '초안 P0'], scored.map(([id, v], idx) => [String(idx + 1), id, gapTitle(m, id), String(v.count), String(v.score), ORIGINAL_P0.includes(id) ? 'O' : '', DRAFT_P0.includes(id) ? 'O' : ''])));
    const top = scored.slice(0, 4).map(([id]) => id);
    const missing = ORIGINAL_P0.filter((id) => !top.includes(id));
    const extra = top.filter((id) => !ORIGINAL_P0.includes(id));
    out.push('', `점수 상위 4개: ${top.join(', ')}. 원 P0(${ORIGINAL_P0.join('·')}) 중 상위 4개에 못 든 것: ${missing.join(', ') || '없음'}. 원 P0에 없던 상위 갭: ${extra.join(', ') || '없음'}.`);
    out.push('심각도는 high 3점, medium 2점, low 1점이다. 하네스 잡음과 병합된 규칙 마찰은 뺐다. 확정은 사용자가 한다.');
  }

  // §9 마찰 목록
  h(9, '마찰 기록');
  const f = m.frictions;
  out.push(`${f.total}건(하네스 잡음 ${f.noise}건). 범주별: ${Object.entries(f.byCategory).map(([key, v]) => `${key} ${v}`).join(', ') || '-'}.`);
  const shown = f.items.filter((x) => !x.merged).slice(0, 40);
  if (shown.length > 0) out.push('', table(['key', '기록', '갭', '심각도', '잡음', '요약'], shown.map((x) => [x.key, x.recordedBy === 'rule' ? `규칙 ${x.rule ?? ''}` : '에이전트', x.gap, x.severity, x.harnessNoise ? 'O' : '', x.summary])));
  if (f.items.filter((x) => !x.merged).length > shown.length) out.push('', `나머지 ${f.items.filter((x) => !x.merged).length - shown.length}건은 metrics.json에 있다.`);
  if (f.proposedGaps.length > 0) out.push('', `새로 제안된 갭: ${f.proposedGaps.map((x) => `${x.gapId} ${x.title}`).join(', ')}.`);

  // §10 측정 한계
  h(10, '측정 한계');
  out.push(
    '- 정지 판정의 done은 verifiedDone(main에 머지되고 테스트가 통과한 항목)만 쓴다. 보드의 checked는 테스트 통과를 뜻하지 않는다(G14).',
    '- 결정 대리가 사람 역할을 하므로 제품 원장에는 대리 행위가 human으로 남는다. 개입 귀속의 정본은 하네스 원장이다. 제품 원장 값은 교차 확인용이다.',
    '- 같은 설정으로도 모델 비결정성 때문에 결과가 달라진다. 비교는 2회 이상 돌린 값으로 한다.',
    '- 실행 Agent 토큰은 Claude Code 트랜스크립트에서 모은다. 트랜스크립트가 없거나 경로가 달라지면 0건이고 측정 불가로 표시한다.',
    '- 자동 행동 상한(12)은 결정권자의 대화 결정으로만 풀린다. 하네스는 이 경로를 대신 열어 주지 않는다.',
    '- 재개를 지원하지 않는다. 실행이 중단되면 report로 부분 결과를 보고 새 runDir로 다시 돈다.',
    '- Windows에서는 PM 스키마 $ref 압축 어댑터(argv)를 쓴다. 의미는 같지만 기준선과 다른 점이다. 압축 뒤에도 한도를 넘으면 argv_limit로 멈춘다.',
    '- 사람 결과 제출은 HTTP 경로가 첨부의 taskId를 버리므로 대체 제출(R3)과 오라우팅(R15)이 생긴다. 둘 다 개입으로 센다.',
    '- 인프라 실패(사용량 한도·로그인·과부하)로 대기한 구간과 그 구간에 시작한 실패 턴은 성공률 분모에서 뺐다. 대기 시간은 시간 지표에 섞지 않는다.',
    '- 계획 표본(solo) 중복은 하네스가 따로 세므로 마찰 기록자의 duplicate 확인에는 들어가지 않는다.',
  );
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// 쓰기

export interface WriteReportOptions {
  /** 비교할 이전 실행의 지표(report --compare). */
  compare?: DogfoodMetrics | null;
}

/** metrics.json과 report.md를 덮어쓴다. 계산한 지표와 본문을 돌려준다. */
export async function writeReport(
  layout: Pick<RunLayout, 'report' | 'metrics'>,
  ledgers: { product: readonly LedgerEvent[]; harness: readonly LedgerEvent[] },
  o: WriteReportOptions = {},
): Promise<{ metrics: DogfoodMetrics | null; report: string }> {
  const metrics = computeMetrics(ledgers.product, ledgers.harness);
  const report = renderReport(metrics, o.compare ?? null);
  await mkdir(dirname(layout.report), { recursive: true });
  await writeFile(layout.report, report, 'utf8');
  await writeFile(layout.metrics, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  return { metrics, report };
}

/** runDir의 두 원장으로 지표를 계산한다(report --compare의 비교 대상 등). */
export async function loadMetrics(runDir: string): Promise<DogfoodMetrics | null> {
  const { product, harness } = await loadRunLedgers(runDir);
  return computeMetrics(product, harness);
}
