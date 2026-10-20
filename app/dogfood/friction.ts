// 마찰 기록자. 결정적 규칙 R1~R17(항상 실행), 겹침·재구현 후보, live에서 사이클 끝에 도는 claude -p 기록자.
// 규칙표의 정본은 docs/dogfooding/feature-seedbed.md §6이다. 기록은 하네스 원장에만 한다.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isParentTask, project, type LedgerEvent } from '@ensemble/core';
import { JUDGE_FAILURE_REASON } from '../packages/orchestrator/src/pm.ts';
import { backlogIdsIn, boardDone, verifiedDone, type BacklogItem } from './backlog.ts';
import { classifyCliFailure, runClaude, type ClaudeRunInput, type ClaudeRunResult } from './claude.ts';
import type { DogfoodLedger, FrictionCategory } from './ledger.ts';
import { loadRolePrompt, recordHarnessUsage, type RoleContext } from './role-context.ts';

/** 기능 모판 G1~G16(feature-seedbed.md §1의 항목 제목). 새 갭은 G17부터 쓴다. */
export const SEEDBED: readonly { id: string; title: string }[] = [
  { id: 'G1', title: '외부 세션 작업 보고' },
  { id: 'G2', title: '구현 이력 검색' },
  { id: 'G3', title: '대화 이력·PM 판단 근거 저장' },
  { id: 'G4', title: '사람 담당자 배정과 결과 제출 연결' },
  { id: 'G5', title: '목표에서 에픽 전체 분해' },
  { id: 'G6', title: 'Agent 역할 확장' },
  { id: 'G7', title: '실행 완료 후 PM 후속 판단(07→02)' },
  { id: 'G8', title: '머지 상태 추적' },
  { id: 'G9', title: '기한·마일스톤' },
  { id: 'G10', title: '중복 감지' },
  { id: 'G11', title: '진행 중 작업 사이의 파일 충돌 경고' },
  { id: 'G12', title: 'Slack 연계' },
  { id: 'G13', title: '팀 구성 변경과 재배정' },
  { id: 'G14', title: '실행 기반(Windows CLI·argv 한도)' },
  { id: 'G15', title: '실행 사용량(토큰) 기록' },
  { id: 'G16', title: '자동 행동 상한 뒤 재개 경로' },
];

export const FRICTION_CATEGORIES: readonly FrictionCategory[] = ['duplicate', 'status_lookup', 'intervention', 'blocked', 'handoff', 'integration', 'tooling', 'other'];

export type Severity = 'high' | 'medium' | 'low';

/** 점수 가중치. 잡음은 점수에서 뺀다. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

/** 팀원 별칭. 디자이너 멤버 명의로 일하는 사람은 팀원 A다. */
export const ACTOR_ALIAS: Record<string, string> = { designer: 'teammate-a' };

export const aliasActor = (id: string): string => ACTOR_ALIAS[id] ?? id;

// 판단 실패 사유. JUDGE_FAILURE_REASON은 pm.ts:57에서 가져온다.
// 'judgement_failed'는 coordination.ts:608이 pm_considered.reason에 쓰는 문자열이다(export가 없어 복사했다).
export const JUDGEMENT_FAILED_REASON = 'judgement_failed';
const JUDGE_FAILURE_REASONS: readonly string[] = [JUDGE_FAILURE_REASON, JUDGEMENT_FAILED_REASON];

type Loose = Record<string, unknown>;
const payloadOf = (e: LedgerEvent): Loose => (e.payload ?? {}) as Loose;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// ---------------------------------------------------------------------------------------------
// 겹침·재구현 후보

export interface WorkUnit {
  backlogId: string;
  /** 별칭을 적용한 행위자. */
  actor: string;
  /** 보드 작업이면 taskId, 팀원 세션이면 사이클 번호. */
  ref: string;
  kind: 'board_task' | 'teammate_session';
  checked?: boolean;
  hasCommit?: boolean;
}

export interface CandidateRecord {
  key: string;
  backlogId: string;
  kind: 'overlap' | 'self_rework';
  actors: string[];
  units: WorkUnit[];
}

function sessionTeammate(e: LedgerEvent): string {
  const p = payloadOf(e);
  return aliasActor(str(p.teammate) || str(p.teammateId) || str(p.memberId) || e.actor.id);
}

function sessionRef(e: LedgerEvent): string {
  const cycle = payloadOf(e).cycle;
  return typeof cycle === 'number' ? String(cycle) : `seq${e.seq}`;
}

function hasCommit(p: Loose): boolean {
  if (Array.isArray(p.commits)) return p.commits.length > 0;
  return typeof p.commits === 'number' && p.commits > 0;
}

interface BoardTask { taskId: string; ids: string[]; assignee: string; checked: boolean }

function boardTasks(product: readonly LedgerEvent[]): BoardTask[] {
  const state = project(product);
  const out: BoardTask[] = [];
  for (const task of state.tasks.values()) {
    if (task.status === 'cancelled' || isParentTask(state, task)) continue;
    const ids = backlogIdsIn([task.spec.title, ...task.spec.handoffConditions].join('\n'));
    if (ids.length === 0) continue;
    out.push({ taskId: task.spec.id, ids, assignee: task.spec.assignee, checked: task.status === 'checked' });
  }
  return out;
}

/**
 * 세션이 보드 작업의 일감(assigned·owner_code·integrate)으로 한 B-id. 이런 세션은 그 작업을 대신 해 준 것이라
 * 따로 센 보드 작업 단위와 같은 구현이다. 일감 ref의 B-id와, ref·taskIds가 가리키는 보드 작업의 B-id를 모은다.
 */
function coveredIds(p: Loose, tasks: readonly BoardTask[]): Set<string> {
  const covered = new Set<string>();
  const refs = new Set<string>(strings(p.taskIds));
  const jobs = Array.isArray(p.jobs) ? (p.jobs as Loose[]) : [];
  for (const job of jobs) {
    if (job.kind === 'solo') continue;
    const ref = str(job.ref);
    if (!ref) continue;
    refs.add(ref);
    for (const id of backlogIdsIn(ref)) covered.add(id);
  }
  for (const t of tasks) if (refs.has(t.taskId)) for (const id of t.ids) covered.add(id);
  return covered;
}

function collectUnits(product: readonly LedgerEvent[], harness: readonly LedgerEvent[]): WorkUnit[] {
  const tasks = boardTasks(product);
  const units: WorkUnit[] = [];
  for (const t of tasks) {
    for (const id of t.ids) units.push({ backlogId: id, actor: aliasActor(t.assignee), ref: t.taskId, kind: 'board_task', checked: t.checked });
  }
  const boardIds = new Set(tasks.flatMap((t) => t.ids));
  for (const e of harness) {
    if (e.type !== 'dogfood_teammate_session') continue;
    const p = payloadOf(e);
    if (p.skipped === true) continue;
    const covered = coveredIds(p, tasks);
    for (const id of new Set(strings(p.backlogItems))) {
      if (covered.has(id) && boardIds.has(id)) continue;
      units.push({ backlogId: id, actor: sessionTeammate(e), ref: sessionRef(e), kind: 'teammate_session', hasCommit: hasCommit(p) });
    }
  }
  return units;
}

function plantedSolo(harness: readonly LedgerEvent[]): Set<string> {
  const started = harness.find((e) => e.type === 'dogfood_run_started');
  return new Set(started ? strings(payloadOf(started).plantedSolo) : []);
}

/**
 * 겹침 후보: 같은 B-id에 서로 다른 행위자(designer와 teammate-a는 한 사람) 둘 이상의 작업 단위가 있는 것.
 * run_started.plantedSolo의 항목은 계획 표본이라 후보에서 뺀다(하네스가 따로 센다).
 */
export function overlapCandidates(product: readonly LedgerEvent[], harness: readonly LedgerEvent[]): CandidateRecord[] {
  const planted = plantedSolo(harness);
  const byId = new Map<string, WorkUnit[]>();
  for (const u of collectUnits(product, harness)) {
    if (planted.has(u.backlogId)) continue;
    byId.set(u.backlogId, [...(byId.get(u.backlogId) ?? []), u]);
  }
  const out: CandidateRecord[] = [];
  for (const [id, units] of [...byId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const actors = [...new Set(units.map((u) => u.actor))].sort();
    if (actors.length < 2) continue;
    out.push({ key: `overlap:${id}:${actors.join('+')}`, backlogId: id, kind: 'overlap', actors, units });
  }
  return out;
}

/**
 * 본인 재구현 후보. 구현 단위는 취소되지 않은 checked 보드 작업(행위자=담당자, ref=taskId)과
 * 커밋이 있는 팀원 세션(행위자=팀원, ref=사이클)이다. 같은 B-id·같은 행위자의 서로 다른 ref가 둘 이상이면 후보다.
 * teammate-a의 integrate 일감은 Agent 결과를 옮긴 것이라 행위자가 다르고, 보드 작업의 일감이면 위에서 같은 구현으로 합쳐진다.
 */
export function selfReworkCandidates(product: readonly LedgerEvent[], harness: readonly LedgerEvent[]): CandidateRecord[] {
  const groups = new Map<string, WorkUnit[]>();
  for (const u of collectUnits(product, harness)) {
    const implemented = u.kind === 'board_task' ? u.checked === true : u.hasCommit === true;
    if (!implemented) continue;
    const k = `${u.backlogId}\u0000${u.actor}`;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  const out: CandidateRecord[] = [];
  for (const [k, units] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (new Set(units.map((u) => u.ref)).size < 2) continue;
    const [id, actor] = k.split('\u0000') as [string, string];
    out.push({ key: `rework:${id}:${actor}`, backlogId: id, kind: 'self_rework', actors: [actor], units });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 규칙 마찰 R1~R17

export interface RuleFriction {
  /** 멱등 키. 같은 사건은 한 번만 기록된다. */
  key: string;
  rule: string;
  category: FrictionCategory;
  /** G1~G16, UNMAPPED. */
  gap: string;
  severity: Severity;
  harnessNoise: boolean;
  summary: string;
  /** 근거 이벤트 id(제품·하네스 원장). */
  evidence: string[];
}

export interface FrictionWindow {
  cycle: number;
  /** 제품 원장 전체. 창은 productFrom 뒤(seq 초과)다. */
  product: readonly LedgerEvent[];
  harness: readonly LedgerEvent[];
  productFrom: number;
  harnessFrom: number;
  backlog: readonly BacklogItem[];
  /** host.argvOverflow()를 loop가 넘긴다. */
  argvOverflow?: { chars: number; tool?: string } | undefined;
  /** 대상이 소프트웨어 프로젝트인지(R11). */
  software?: boolean;
}

const R5_G14 = /제한 시간|세션 오류|시작하지 못|ENOENT|결과를 받지 못|작업이 중단/;
const R5_G5 = /보완/;
const R17_G14 = /CLI|ENOENT|ENAMETOOLONG|시간/i;
const TEMPLATE_ROLES = ['research', 'interview', 'flow', 'prototype'];
const DEFAULT_AGENT_IDS = ['research-agent', 'prototype-agent'];

/** 결정적 규칙으로 창 안의 마찰을 모은다. 정본: feature-seedbed.md §6. */
export function ruleFrictions(w: FrictionWindow): RuleFriction[] {
  const out: RuleFriction[] = [];
  const push = (r: Omit<RuleFriction, 'harnessNoise'> & { harnessNoise?: boolean }) => out.push({ harnessNoise: false, ...r });
  const prod = w.product.filter((e) => e.seq > w.productFrom);
  const harn = w.harness.filter((e) => e.seq > w.harnessFrom);
  const action = (e: LedgerEvent): Loose => (payloadOf(e).action ?? {}) as Loose;

  for (const e of harn) {
    const p = payloadOf(e);
    switch (e.type) {
      case 'dogfood_proxy_action': {
        const type = str(action(e).type);
        if (type === 'next_step_request' && p.ok === true) push({ key: `R1:${e.id}`, rule: 'R1', category: 'intervention', gap: 'G7', severity: 'medium', summary: '결정권자 대리가 다음 단계를 직접 요청했습니다', evidence: [e.id] });
        if (type === 'owner_code_redirect') push({ key: `R14:${e.id}`, rule: 'R14', category: 'handoff', gap: 'G13', severity: 'medium', summary: 'owner에게 배정된 B-id 작업을 팀원 A가 대신 맡았습니다', evidence: [e.id] });
        if (p.ok === false || p.via === 'rule-fallback') push({ key: `R7:${e.id}`, rule: 'R7', category: 'tooling', gap: 'UNMAPPED', severity: 'low', harnessNoise: true, summary: `대리 행동이 실패했거나 규칙으로 대신했습니다${str(p.error) ? `: ${str(p.error).slice(0, 120)}` : ''}`, evidence: [e.id] });
        break;
      }
      case 'dogfood_human_task_submitted':
        if (p.via === 'fallback') push({ key: `R3:${e.id}`, rule: 'R3', category: 'tooling', gap: 'G4', severity: 'high', summary: '사람 결과를 HTTP가 아니라 대체 경로로 제출했습니다', evidence: [e.id] });
        if (p.via === 'misrouted') push({ key: `R15:${e.id}`, rule: 'R15', category: 'tooling', gap: 'G4', severity: 'high', summary: '사람 결과가 다른 작업으로 잘못 연결됐습니다', evidence: [e.id] });
        break;
      case 'dogfood_manual_integration':
        push({ key: `R4:${e.id}`, rule: 'R4', category: 'integration', gap: 'G8', severity: 'low', summary: `하네스가 팀원 브랜치 ${str(p.branch)}를 main에 머지했습니다`, evidence: [e.id] });
        break;
      case 'dogfood_integration_test':
        if (p.ok === false || p.passed === false || p.status === 'failed') push({ key: `R10:${e.id}`, rule: 'R10', category: 'integration', gap: 'G14', severity: 'high', summary: '통합 테스트가 실패했습니다', evidence: [e.id] });
        break;
      case 'dogfood_infra_pause':
        push({ key: `R16:${e.id}`, rule: 'R16', category: 'tooling', gap: 'UNMAPPED', severity: 'low', harnessNoise: true, summary: `인프라 실패로 대기했습니다: ${str(p.reason).slice(0, 120)}`, evidence: [e.id] });
        break;
      case 'dogfood_role_note':
        if (str(p.text).startsWith('plan_draft_failed')) {
          push({ key: `R17:${e.id}`, rule: 'R17', category: 'tooling', gap: R17_G14.test(str(p.text)) ? 'G14' : 'G5', severity: 'high', summary: '계획 초안 작성이 실패했습니다', evidence: [e.id] });
        }
        break;
      case 'dogfood_status_probe': {
        if (p.failed === true) break; // 프로브 실행 실패는 R12 대상이 아니다.
        const questions = Array.isArray(p.questions) ? (p.questions as Loose[]) : [];
        // 정오는 perQuestion[{id, correct}]에 있고 종류는 questions[{id, kind}]에 있다. id로 조인한다(구 형식 questions[].correct도 허용).
        const kindById = new Map(questions.map((q) => [str(q.id), q.kind === 'mate' ? 'mate' : 'task']));
        const perQuestion = Array.isArray(p.perQuestion) ? (p.perQuestion as Loose[]) : [];
        const wrong = [
          ...perQuestion.filter((q) => q.correct === false).map((q) => kindById.get(str(q.id)) ?? 'task'),
          ...questions.filter((q) => q.correct === false).map((q) => (q.kind === 'mate' ? 'mate' : 'task')),
        ];
        const kinds = wrong.length > 0 ? [...new Set(wrong)] : typeof p.correct === 'number' && typeof p.total === 'number' && p.correct < p.total ? ['task'] : [];
        for (const kind of kinds) push({ key: `R12:${e.id}:${kind}`, rule: 'R12', category: 'status_lookup', gap: kind === 'mate' ? 'G1' : 'G2', severity: 'medium', summary: `현황 프로브가 ${kind === 'mate' ? '팀원' : '작업'} 질문에 오답을 했습니다`, evidence: [e.id] });
        break;
      }
      case 'dogfood_teammate_session':
        if (p.postedToSpace === true) {
          const who = sessionTeammate(e);
          const posted = prod.some((x) => x.type === 'space_post_recorded' && aliasActor(str(payloadOf(x).participantId)) === who);
          if (!posted) push({ key: `R8:${e.id}`, rule: 'R8', category: 'tooling', gap: 'G1', severity: 'medium', summary: `${who}가 Space에 게시했다고 보고했지만 기록이 없습니다`, evidence: [e.id] });
        }
        break;
      default:
        break;
    }
  }

  // R13은 같은 triggerId(사람 메시지)당 한 건만 센다. pm_considered와 judgement_failed가 함께 남을 수 있다.
  const r13Triggers = new Set<string>();
  const firstR13 = (triggerId: string): boolean => {
    if (triggerId === '') return true;
    if (r13Triggers.has(triggerId)) return false;
    r13Triggers.add(triggerId);
    return true;
  };
  for (const e of prod) {
    const p = payloadOf(e);
    if (e.type === 'task_blocked') {
      const reason = str(p.reason);
      if (classifyCliFailure(reason) === 'infra') {
        push({ key: `R16:${e.id}`, rule: 'R16', category: 'tooling', gap: 'UNMAPPED', severity: 'low', harnessNoise: true, summary: `인프라 사유로 작업이 막혔습니다: ${reason.slice(0, 120)}`, evidence: [e.id] });
      } else {
        const gap = R5_G14.test(reason) ? 'G14' : R5_G5.test(reason) ? 'G5' : 'UNMAPPED';
        push({ key: `R5:${e.id}`, rule: 'R5', category: 'blocked', gap, severity: 'medium', summary: `작업이 막혔습니다: ${reason.slice(0, 120)}`, evidence: [e.id] });
      }
    } else if (e.type === 'action_limit_reached') {
      push({ key: `R6:${e.id}`, rule: 'R6', category: 'intervention', gap: 'G16', severity: 'high', summary: `자동 행동 상한(${String(p.limit)})에 닿았습니다`, evidence: [e.id] });
    } else if (e.type === 'judgement_failed') {
      if (firstR13(str(p.triggerId))) push({ key: `R13:${e.id}`, rule: 'R13', category: 'tooling', gap: 'G14', severity: 'high', summary: 'PM이 판단 과정에서 실패했습니다(judgement_failed)', evidence: [e.id] });
    } else if (e.type === 'pm_considered' && JUDGE_FAILURE_REASONS.includes(str(p.reason))) {
      if (firstR13(str(p.triggerId))) push({ key: `R13:${e.id}`, rule: 'R13', category: 'tooling', gap: 'G14', severity: 'high', summary: 'PM이 판단 과정에서 실패했습니다', evidence: [e.id] });
    } else if (e.type === 'space_post_recorded' && p.participantId === 'teammate-b' && p.kind === 'result') {
      const known = new Set(boardTasks(w.product).flatMap((t) => t.ids));
      const missing = backlogIdsIn(str(p.text)).filter((id) => !known.has(id));
      if (missing.length > 0) push({ key: `R2:${e.id}`, rule: 'R2', category: 'status_lookup', gap: 'G1', severity: 'high', summary: `teammate-b가 보드에 없는 항목(${missing.join(', ')})의 결과를 Space에만 올렸습니다`, evidence: [e.id] });
    }
  }

  if (w.argvOverflow) {
    push({ key: 'R13:argv', rule: 'R13', category: 'tooling', gap: 'G14', severity: 'high', summary: `PM 요청의 명령줄이 한도를 넘었습니다(${w.argvOverflow.chars}자${w.argvOverflow.tool ? `, ${w.argvOverflow.tool}` : ''})`, evidence: [] });
  }

  // R9: 사이클 끝 시점에 보드에서만 끝난 Agent 담당 항목.
  const verified = verifiedDone(w.harness);
  const boardOnly = [...boardDone(w.product)].filter((id) => !verified.has(id));
  if (boardOnly.length > 0) {
    const state = project(w.product);
    const agentIds = new Set(DEFAULT_AGENT_IDS);
    for (const e of w.product) if (e.type === 'member_joined' && payloadOf(e).kind === 'agent') agentIds.add(str(payloadOf(e).memberId));
    for (const task of state.tasks.values()) {
      if (task.status !== 'checked' || !agentIds.has(task.spec.assignee)) continue;
      for (const id of backlogIdsIn([task.spec.title, ...task.spec.handoffConditions].join('\n'))) {
        if (!boardOnly.includes(id) || out.some((f) => f.key === `R9:${id}`)) continue;
        push({ key: `R9:${id}`, rule: 'R9', category: 'integration', gap: 'G8', severity: 'medium', summary: `${id}는 보드에서만 끝났고 main에 검증되지 않았습니다(board_only)`, evidence: [task.spec.id] });
      }
    }
  }

  // R11: 소프트웨어 대상인데 첫 계획이 4역할 템플릿(1회).
  if (w.software === true) {
    const v1 = w.product.find((e) => e.type === 'plan_committed' && payloadOf(e).version === 1);
    if (v1) {
      const tops = ((payloadOf(v1).tasks as { id?: string; parentId?: string }[] | undefined) ?? []).filter((t) => t.parentId === undefined).map((t) => str(t.id));
      if (tops.length === TEMPLATE_ROLES.length && TEMPLATE_ROLES.every((id) => tops.includes(id))) {
        push({ key: 'R11', rule: 'R11', category: 'handoff', gap: 'G5', severity: 'medium', summary: '소프트웨어 대상인데 첫 계획이 4역할 템플릿뿐입니다', evidence: [v1.id] });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 기록

export interface FrictionPayload {
  key: string;
  recordedBy: 'rule' | 'agent';
  rule?: string;
  category: FrictionCategory;
  gap: string;
  severity: Severity;
  harnessNoise: boolean;
  summary: string;
  evidence: string[];
  cycle: number;
  /** duplicate 확인이 가리키는 후보 key(overlap: 또는 rework:). */
  confirmsCandidate?: string;
  /** 이 기록이 대신하는 규칙 마찰 key(점수 중복 방지). */
  mergesKeys?: string[];
}

/** claude -p 기록자의 출력 스키마. --json-schema 인자 한도(6000자) 안에 둔다. */
export const FRICTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frictions'],
  properties: {
    frictions: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'summary', 'evidence', 'gap', 'severity'],
        properties: {
          category: { enum: [...FRICTION_CATEGORIES] },
          summary: { type: 'string', minLength: 1, maxLength: 300 },
          evidence: { type: 'array', items: { type: 'string' } },
          gap: { type: 'string', description: 'G1~G16, 이미 제안한 G17 이후, UNMAPPED, NEW 중 하나' },
          newGapTitle: { type: 'string', description: 'gap이 NEW일 때 새 갭의 제목' },
          severity: { enum: ['high', 'medium', 'low'] },
          harnessNoise: { type: 'boolean' },
          confirmsCandidate: { type: 'string', description: 'category가 duplicate일 때 확인한 후보 key' },
          mergesKeys: { type: 'array', items: { type: 'string' }, description: '이 항목이 대신하는 규칙 마찰 key' },
        },
      },
    },
  },
} as const;

async function idempotencyKeys(ledger: DogfoodLedger): Promise<Set<string>> {
  return new Set((await ledger.read()).map((e) => e.idempotencyKey).filter((k): k is string => k !== undefined));
}

/** 규칙 마찰을 기록한다. 같은 key는 한 번만 남는다. 새로 기록한 것만 돌려준다. */
export async function recordRuleFrictions(ledger: DogfoodLedger, cycle: number, frictions: readonly RuleFriction[]): Promise<RuleFriction[]> {
  const existing = await idempotencyKeys(ledger);
  const fresh: RuleFriction[] = [];
  for (const f of frictions) {
    const key = `friction:${f.key}`;
    if (existing.has(key)) continue;
    const payload: FrictionPayload = { key: f.key, recordedBy: 'rule', rule: f.rule, category: f.category, gap: f.gap, severity: f.severity, harnessNoise: f.harnessNoise, summary: f.summary, evidence: f.evidence, cycle };
    await ledger.record('dogfood_friction_recorded', payload as unknown as Record<string, unknown>, { key });
    existing.add(key);
    fresh.push(f);
  }
  return fresh;
}

/** 겹침·재구현 후보를 기록한다. 같은 key는 한 번만 남는다. */
export async function recordCandidates(ledger: DogfoodLedger, cycle: number, candidates: readonly CandidateRecord[]): Promise<CandidateRecord[]> {
  const existing = await idempotencyKeys(ledger);
  const fresh: CandidateRecord[] = [];
  for (const c of candidates) {
    const key = `candidate:${c.key}`;
    if (existing.has(key)) continue;
    await ledger.record('dogfood_overlap_candidate', { key: c.key, backlogId: c.backlogId, kind: c.kind, units: c.units, cycle }, { key });
    existing.add(key);
    fresh.push(c);
  }
  return fresh;
}

/** 이번 사이클 창: 직전 사이클이 끝난 제품 seq부터, 이번 cycle_started부터. */
export function cycleWindow(harness: readonly LedgerEvent[], cycle: number): { productFrom: number; harnessFrom: number } {
  let productFrom = 0;
  let harnessFrom = 0;
  for (const e of harness) {
    const p = payloadOf(e);
    if (e.type === 'dogfood_cycle_finished' && typeof p.cycle === 'number' && p.cycle < cycle && typeof p.productSeq === 'number') productFrom = Math.max(productFrom, p.productSeq);
    if (e.type === 'dogfood_cycle_started' && p.cycle === cycle) harnessFrom = Math.max(harnessFrom, e.seq - 1);
  }
  return { productFrom, harnessFrom };
}

export interface FrictionRunOptions {
  /** 테스트용 주입. 기본은 runClaude. */
  run?: (input: ClaudeRunInput) => Promise<ClaudeRunResult>;
  argvOverflow?: { chars: number; tool?: string };
  software?: boolean;
}

export interface FrictionRunResult {
  rule: number;
  candidates: number;
  agent: number;
  gaps: number;
  /** live 기록자를 돌렸는지(규칙 모드·인프라 대기·실패면 false). */
  ranAgent: boolean;
  error?: string;
}

const sha = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 10);

function countByType(events: readonly LedgerEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return counts;
}

/**
 * 사이클 끝의 마찰 기록. 규칙 마찰과 후보는 항상 기록한다(live·rule 모두).
 * live이면 claude -p 기록자가 창 요약을 보고 확정·병합·갭 매핑을 한다. 근거는 창 안의 이벤트 id와 하네스 key만 인정한다.
 */
export async function runFrictionRecorder(ctx: RoleContext, o: FrictionRunOptions = {}): Promise<FrictionRunResult> {
  const product = await ctx.host.events();
  const harness = await ctx.ledger.read();
  const { productFrom, harnessFrom } = cycleWindow(harness, ctx.cycle);
  const argvOverflow = o.argvOverflow ?? ctx.host.argvOverflow();
  const window: FrictionWindow = { cycle: ctx.cycle, product, harness, productFrom, harnessFrom, backlog: ctx.backlog, software: o.software ?? true, ...(argvOverflow ? { argvOverflow } : {}) };
  const rules = ruleFrictions(window);
  const freshRules = await recordRuleFrictions(ctx.ledger, ctx.cycle, rules);
  const candidates = [...overlapCandidates(product, harness), ...selfReworkCandidates(product, harness)];
  const freshCandidates = await recordCandidates(ctx.ledger, ctx.cycle, candidates);
  const result: FrictionRunResult = { rule: freshRules.length, candidates: freshCandidates.length, agent: 0, gaps: 0, ranAgent: false };
  if (ctx.config.mode !== 'live') return result;
  if (ctx.infraPausedUntil !== undefined && Date.parse(ctx.infraPausedUntil) > Date.now()) return result;

  const prodWindow = product.filter((e) => e.seq > productFrom);
  const harnWindow = harness.filter((e) => e.seq > harnessFrom);
  const evidenceIds = new Set<string>([...prodWindow, ...harnWindow].map((e) => e.id));
  const ruleKeys = new Set(rules.map((r) => r.key));
  const candidateKeys = new Set(candidates.map((c) => c.key));
  const brief = {
    cycle: ctx.cycle,
    seedbed: SEEDBED,
    ruleFrictions: rules.map((r) => ({ key: r.key, rule: r.rule, category: r.category, gap: r.gap, harnessNoise: r.harnessNoise, summary: r.summary, evidence: r.evidence })),
    candidates: candidates.map((c) => ({ key: c.key, kind: c.kind, backlogId: c.backlogId, actors: c.actors, units: c.units })),
    proxyErrors: harnWindow.filter((e) => e.type === 'dogfood_proxy_action' && payloadOf(e).ok === false).map((e) => ({ id: e.id, error: str(payloadOf(e).error).slice(0, 200) })),
    teammateSessions: harnWindow.filter((e) => e.type === 'dogfood_teammate_session').map((e) => {
      const p = payloadOf(e);
      return { id: e.id, teammate: sessionTeammate(e), claimedPosted: p.postedToSpace === true, backlogItems: strings(p.backlogItems), commits: Array.isArray(p.commits) ? p.commits.length : p.commits ?? null };
    }),
    productEventCounts: countByType(prodWindow),
    harnessEventCounts: countByType(harnWindow),
  };
  const run = o.run ?? runClaude;
  let r: ClaudeRunResult;
  try {
    r = await run({
      role: 'friction-recorder',
      prompt: `다음은 사이클 ${ctx.cycle}의 창 요약이다. 지시대로 JSON으로만 답한다.\n${JSON.stringify(brief)}`,
      cwd: ctx.layout.probeCwd,
      tools: 'none',
      systemPrompt: loadRolePrompt('friction-recorder'),
      jsonSchema: FRICTION_SCHEMA,
      budgetUsd: ctx.config.proxyBudgetUsd,
      timeoutMs: 5 * 60_000,
      logFile: join(ctx.layout.logs, `c${ctx.cycle}-friction-recorder.json`),
      signal: ctx.signal,
      ...(ctx.config.harnessModel === undefined ? {} : { model: ctx.config.harnessModel }),
    });
  } catch (e) {
    return { ...result, error: (e as Error).message };
  }
  await recordHarnessUsage(ctx, 'friction-recorder', r);
  result.ranAgent = true;
  const structured = r.structured as { frictions?: unknown } | undefined;
  if (!r.ok || !structured || !Array.isArray(structured.frictions)) return { ...result, error: r.error ?? '기록자 출력이 올바르지 않습니다' };

  const existing = await idempotencyKeys(ctx.ledger);
  const proposed = new Map<string, string>();
  let gapCount = 0;
  for (const e of harness) {
    if (e.type !== 'dogfood_gap_proposed') continue;
    const p = payloadOf(e);
    proposed.set(str(p.title).trim().toLowerCase(), str(p.gapId));
    gapCount += 1;
  }
  const knownGaps = new Set<string>([...SEEDBED.map((g) => g.id), ...proposed.values(), 'UNMAPPED']);
  for (const raw of structured.frictions as Loose[]) {
    const category = str(raw.category) as FrictionCategory;
    const summary = str(raw.summary).trim();
    if (!FRICTION_CATEGORIES.includes(category) || !summary) continue;
    const severity = (['high', 'medium', 'low'] as const).find((s) => s === raw.severity);
    if (!severity) continue;
    const evidence = strings(raw.evidence).filter((id) => evidenceIds.has(id) || candidateKeys.has(id) || ruleKeys.has(id));
    if (evidence.length === 0) continue;
    let confirmsCandidate: string | undefined;
    if (category === 'duplicate') {
      confirmsCandidate = str(raw.confirmsCandidate);
      if (!candidateKeys.has(confirmsCandidate)) continue;
    }
    let gap = str(raw.gap);
    if (gap === 'NEW') {
      const title = str(raw.newGapTitle).trim();
      if (title) {
        const norm = title.toLowerCase();
        let id = proposed.get(norm);
        if (id === undefined) {
          id = `G${17 + gapCount}`;
          gapCount += 1;
          proposed.set(norm, id);
          knownGaps.add(id);
          await ctx.ledger.record('dogfood_gap_proposed', { gapId: id, title, summary, evidence, cycle: ctx.cycle }, { key: `gap:${sha(norm)}` });
          result.gaps += 1;
        }
        gap = id;
      } else gap = 'UNMAPPED';
    } else if (!knownGaps.has(gap)) gap = 'UNMAPPED';
    const key = confirmsCandidate !== undefined ? `agent:dup:${confirmsCandidate}` : `agent:${ctx.cycle}:${sha(`${category}|${summary}`)}`;
    if (existing.has(`friction:${key}`)) continue;
    const mergesKeys = strings(raw.mergesKeys).filter((k) => ruleKeys.has(k));
    const payload: FrictionPayload = {
      key, recordedBy: 'agent', category, gap, severity, harnessNoise: raw.harnessNoise === true, summary, evidence, cycle: ctx.cycle,
      ...(confirmsCandidate === undefined ? {} : { confirmsCandidate }),
      ...(mergesKeys.length === 0 ? {} : { mergesKeys }),
    };
    await ctx.ledger.record('dogfood_friction_recorded', payload as unknown as Record<string, unknown>, { key: `friction:${key}` });
    existing.add(`friction:${key}`);
    result.agent += 1;
  }
  return result;
}
