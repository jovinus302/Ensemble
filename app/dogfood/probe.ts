// 현황 파악 프로브: 원장에서 질문과 기대값을 만들고, 프로브(live: curl 쓰는 claude, rule: 결정적 리더)의 답을 채점한다.
// 정답은 프로브가 볼 수 있는 정보와 같은 규칙으로 만든다: 작업은 project()·workStatus()·displayName, 팀원은 Space 글 순서.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { participation, project, workStatus, type LedgerEvent } from '@ensemble/core';
import { backlogIdsIn } from './backlog.ts';
import { BASH, runClaude } from './claude.ts';
import { httpJson } from './host.ts';
import { loadRolePrompt, recordHarnessUsage, type RoleContext } from './role-context.ts';

export type SpaceStatus = 'done' | 'blocked' | 'in_progress' | 'unknown';

/** 팀원 상태 규칙. 프롬프트에 그대로 준다. */
export const SPACE_STATUS_RULE =
  '팀원 상태 규칙: 글이 없으면 unknown. 마지막 글이 blocked이면 blocked. 마지막 result 글 뒤에 blocked 글이 없으면 done. 그 밖에는 in_progress.';

/** Space 글(게시 순서)의 kind만으로 팀원 상태를 정한다. */
export function spaceStatus(posts: readonly { kind: string }[]): SpaceStatus {
  if (posts.length === 0) return 'unknown';
  if (posts.at(-1)!.kind === 'blocked') return 'blocked';
  const lastResult = posts.map((p) => p.kind).lastIndexOf('result');
  if (lastResult >= 0 && !posts.slice(lastResult + 1).some((p) => p.kind === 'blocked')) return 'done';
  return 'in_progress';
}

export interface TaskExpected { who: string; status: string }
export interface MateExpected { who: string; items: string[]; status: SpaceStatus }

export type ProbeQuestion =
  | { id: string; kind: 'task'; text: string; title: string; expected: TaskExpected }
  | { id: string; kind: 'mate'; text: string; participantId: string; expected: MateExpected };

export interface ProbeAnswer {
  id: string;
  who?: string;
  status?: string;
  what?: string;
}

/**
 * 질문 최대 max개. 작업 질문 3개(사이클마다 회전)와 Space 참여자별 팀원 질문이다.
 * 글이 없는 참여자는 기대값이 unknown이라 묻지 않는다. harness는 이후 확장용이며 지금은 쓰지 않는다.
 */
export function buildProbeQuestions(
  product: readonly LedgerEvent[],
  _harness: readonly LedgerEvent[],
  cycle: number,
  max = 5,
): ProbeQuestion[] {
  const state = project(product);
  const seen = new Set<string>();
  const candidates = [...state.tasks.values()].filter((t) => {
    if (t.status === 'cancelled' || (t.children ?? []).length > 0) return false;
    if (!state.members.has(t.spec.assignee) || seen.has(t.spec.title)) return false;
    seen.add(t.spec.title);
    return true;
  });
  const questions: ProbeQuestion[] = [];
  const take = Math.min(3, candidates.length, max);
  for (let i = 0; i < take; i += 1) {
    const task = candidates[(Math.max(0, cycle) * 3 + i) % candidates.length]!;
    questions.push({
      id: `task-${questions.length + 1}`,
      kind: 'task',
      title: task.spec.title,
      text: `작업 "${task.spec.title}"의 담당자는 누구이고 지금 상태는 무엇인가?`,
      expected: { who: state.members.get(task.spec.assignee)!.displayName, status: workStatus(task, state) },
    });
  }
  const space = participation(product);
  for (const [participantId, participant] of space.participants) {
    if (questions.length >= max) break;
    const posts = [...space.posts.values()].filter((p) => p.participantId === participantId);
    if (posts.length === 0) continue;
    const name = participant.link.displayName;
    questions.push({
      id: `mate-${questions.length + 1}`,
      kind: 'mate',
      participantId,
      text: `팀원 ${name}은(는) 무슨 작업을 하고 있고 어디까지 했는가? Space 글 기준으로 답하라.`,
      expected: { who: name, items: [...new Set(posts.flatMap((p) => backlogIdsIn(p.text)))], status: spaceStatus(posts) },
    });
  }
  return questions;
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** 질문 하나의 채점. unknown은 오답이다. */
export function scoreOne(q: ProbeQuestion, a: ProbeAnswer | undefined): boolean {
  if (!a || a.status === undefined || a.status === 'unknown') return false;
  const who = squash(a.who ?? '');
  const want = squash(q.expected.who);
  if (!who || !want || !(who.includes(want) || want.includes(who))) return false;
  if (a.status !== q.expected.status) return false;
  if (q.kind === 'mate' && q.expected.items.length > 0) return q.expected.items.some((item) => (a.what ?? '').includes(item));
  return true;
}

export function scoreProbe(
  questions: readonly ProbeQuestion[],
  answers: readonly ProbeAnswer[],
): { correct: number; total: number; perQuestion: { id: string; correct: boolean }[] } {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const perQuestion = questions.map((q) => ({ id: q.id, correct: scoreOne(q, byId.get(q.id)) }));
  return { correct: perQuestion.filter((p) => p.correct).length, total: questions.length, perQuestion };
}

interface StateJson {
  work?: { items?: { ownerId: string; status: string; title: string }[] };
  members?: { id: string; displayName: string }[];
}
interface SpaceJson {
  participants?: { id: string; displayName: string }[];
  posts?: { participantId: string; kind: string; text: string }[];
}

/** 규칙 모드 리더. 상태 JSON(/api/state?me=owner, /api/space)에서 프로브와 같은 규칙으로 답한다. */
export async function ruleReader(baseUrl: string, questions: readonly ProbeQuestion[]): Promise<ProbeAnswer[]> {
  const state = ((await httpJson(`${baseUrl}/api/state?me=owner`)).json ?? {}) as StateJson;
  const space = ((await httpJson(`${baseUrl}/api/space`)).json ?? {}) as SpaceJson;
  const names = new Map((state.members ?? []).map((m) => [m.id, m.displayName]));
  const answers: ProbeAnswer[] = [];
  for (const q of questions) {
    if (q.kind === 'task') {
      const item = (state.work?.items ?? []).find((i) => i.title === q.title);
      answers.push(item ? { id: q.id, who: names.get(item.ownerId) ?? item.ownerId, status: item.status } : { id: q.id, status: 'unknown' });
      continue;
    }
    const posts = (space.posts ?? []).filter((p) => p.participantId === q.participantId);
    const person = (space.participants ?? []).find((p) => p.id === q.participantId);
    answers.push({ id: q.id, who: person?.displayName ?? '', status: spaceStatus(posts), what: posts.map((p) => p.text).join('\n') });
  }
  return answers;
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, who: { type: 'string' }, status: { type: 'string' }, what: { type: 'string' } },
        required: ['id', 'status'],
      },
    },
  },
  required: ['answers'],
};

function readAnswers(structured: unknown): ProbeAnswer[] {
  const list = (structured as { answers?: unknown } | undefined)?.answers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((a): ProbeAnswer[] => {
    const o = a as Record<string, unknown> | null;
    if (!o || typeof o.id !== 'string') return [];
    return [{
      id: o.id,
      ...(typeof o.who === 'string' ? { who: o.who } : {}),
      ...(typeof o.status === 'string' ? { status: o.status } : {}),
      ...(typeof o.what === 'string' ? { what: o.what } : {}),
    }];
  });
}

export interface ProbeOutcome {
  correct: number;
  total: number;
  durationMs: number;
}

/** probeEvery 사이클마다 한 번. 결과는 dogfood_status_probe(key probe:<cycle>)로 남긴다. 질문이 없거나 인프라 대기 중이면 undefined. */
export async function runStatusProbe(ctx: RoleContext): Promise<ProbeOutcome | undefined> {
  if (ctx.infraPausedUntil && Date.parse(ctx.infraPausedUntil) > Date.now()) return undefined;
  const questions = buildProbeQuestions(await ctx.host.events(), await ctx.ledger.read(), ctx.cycle);
  if (questions.length === 0) return undefined;
  const started = Date.now();
  let answers: ProbeAnswer[] = [];
  let error: string | undefined;
  let failed = false;
  if (ctx.config.mode === 'rule') {
    answers = await ruleReader(ctx.host.baseUrl, questions);
  } else {
    rmSync(ctx.layout.probeCwd, { recursive: true, force: true });
    mkdirSync(ctx.layout.probeCwd, { recursive: true });
    const prompt = [
      `baseUrl: ${ctx.host.baseUrl}`,
      '엔드포인트: GET /api/state?me=owner, GET /api/space, GET /api/tasks/:id',
      SPACE_STATUS_RULE,
      '질문(JSON):',
      JSON.stringify(questions.map((q) => ({ id: q.id, kind: q.kind, text: q.text }))),
      '질문마다 {id, who, status, what} 하나로 답하고 {"answers":[...]} JSON만 출력하라.',
    ].join('\n');
    const r = await runClaude({
      role: 'status-probe',
      prompt,
      cwd: ctx.layout.probeCwd,
      tools: { allowed: [BASH('curl')] },
      systemPrompt: loadRolePrompt('status-probe'),
      jsonSchema: ANSWER_SCHEMA,
      ...(ctx.config.harnessModel ? { model: ctx.config.harnessModel } : {}),
      budgetUsd: ctx.config.proxyBudgetUsd,
      timeoutMs: ctx.config.sessionTimeoutMinutes * 60_000,
      logFile: join(ctx.layout.logs, `c${ctx.cycle}-status-probe.json`),
      signal: ctx.signal,
    });
    const pausedUntil = await recordHarnessUsage(ctx, 'status-probe', r);
    // 인프라 실패는 지표에서 뺀다. 프로브를 기록하지 않고 다음 사이클에 다시 시도한다.
    if (pausedUntil !== undefined) return undefined;
    answers = r.ok ? readAnswers(r.structured) : [];
    if (!r.ok) {
      error = r.error ?? '프로브 실패';
      failed = true;
    }
  }
  const durationMs = Date.now() - started;
  const score = scoreProbe(questions, answers);
  await ctx.ledger.record(
    'dogfood_status_probe',
    {
      cycle: ctx.cycle,
      via: ctx.config.mode,
      durationMs,
      numTurns: null,
      correct: score.correct,
      total: score.total,
      perQuestion: score.perQuestion,
      questions: questions.map((q) => ({ id: q.id, kind: q.kind, expected: q.expected })),
      answers,
      ...(failed ? { failed: true } : {}),
      ...(error ? { error } : {}),
    },
    { key: `probe:${ctx.cycle}` },
  );
  return { correct: score.correct, total: score.total, durationMs };
}
