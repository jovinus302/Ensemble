// 역할들이 함께 쓰는 맥락과 도구: RoleContext, 역할 프롬프트 로드, 가라앉기 대기, 하네스 사용량 기록, 진척 서명.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { project, type LedgerEvent } from '@ensemble/core';
import type { BacklogItem } from './backlog.ts';
import { verifiedDone } from './backlog.ts';
import { classifyCliFailure, type ClaudeRunResult } from './claude.ts';
import { appDir, type DogfoodConfig, type RunLayout } from './config.ts';
import type { DogfoodHost } from './host.ts';
import type { DogfoodLedger } from './ledger.ts';

export interface RoleContext {
  config: DogfoodConfig;
  layout: RunLayout;
  host: DogfoodHost;
  ledger: DogfoodLedger;
  backlog: BacklogItem[];
  goal: string;
  cycle: number;
  signal: AbortSignal;
  /** 이 시각(ISO)까지는 인프라 대기 구간이다. 대리·팀원·프로브는 건너뛴다. */
  infraPausedUntil?: string;
}

/** app/dogfood/roles/<name>.md. 역할 프롬프트 파일이 없으면 한국어 오류를 던진다. */
export function loadRolePrompt(name: string): string {
  const file = join(appDir(), 'dogfood', 'roles', `${name}.md`);
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new Error(`역할 프롬프트를 읽지 못했습니다: ${file}`);
  }
}

export interface SettleResult {
  settled: boolean;
  waitedMs: number;
  lastSeq: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 제품이 가라앉을 때까지 기다린다. 가라앉음 = 대시보드 activity가 idle이고(PM 처리·Agent 턴 없음)
 * 원장 마지막 seq가 연속 두 번 같다. maxMs를 넘기면 settled:false로 돌아온다. 간격은 100ms에서 시작해 2초까지 늘린다.
 */
export async function settle(host: DogfoodHost, maxMs: number): Promise<SettleResult> {
  const started = Date.now();
  let delay = 100;
  let previous = -1;
  for (;;) {
    const events = await host.events();
    const seq = events.at(-1)?.seq ?? 0;
    const state = await host.runtime.state('owner');
    const idle = state.activity.kind === 'idle';
    if (idle && seq === previous) return { settled: true, waitedMs: Date.now() - started, lastSeq: seq };
    previous = idle ? seq : -1;
    if (Date.now() - started >= maxMs) return { settled: false, waitedMs: Date.now() - started, lastSeq: seq };
    await sleep(Math.min(delay, Math.max(0, maxMs - (Date.now() - started))));
    delay = Math.min(delay * 2, 2000);
  }
}

export function lastSeq(events: readonly LedgerEvent[]): number {
  return events.at(-1)?.seq ?? 0;
}

const KST_OFFSET_MS = 9 * 60 * 60_000;
const DEFAULT_PAUSE_MS = 60 * 60_000;

/**
 * 오류 메시지의 'resets 5pm'·'resets at 5:30 pm' 같은 문구를 KST 시각으로 해석한다.
 * 이미 지난 시각이면 다음 날로 본다. 해석하지 못하면 now + 60분이다.
 */
export function pauseUntil(text: string, now: Date): Date {
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (m) {
    let hour = Number(m[1]);
    const minute = m[2] === undefined ? 0 : Number(m[2]);
    const meridiem = m[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) {
      const kst = new Date(now.getTime() + KST_OFFSET_MS);
      let at = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), hour, minute) - KST_OFFSET_MS;
      if (at <= now.getTime()) at += 24 * 60 * 60_000;
      return new Date(at);
    }
  }
  return new Date(now.getTime() + DEFAULT_PAUSE_MS);
}

/**
 * 제품 실행 Agent가 인프라 사유(사용량 한도·로그인·과부하)로 막힌 task_blocked를 dogfood_infra_pause로 남긴다.
 * recordHarnessUsage는 하네스 자신의 claude 호출만 기록하므로, 이게 없으면 Agent의 인프라 막힘은 대기 구간이 되지 않아
 * 대기가 끝난 뒤의 retry(infraRetryReady, 정책 4)도 일어나지 않는다. 키는 infra-block:<이벤트 id>라 다시 불러도 중복 기록되지 않는다.
 * 새로 남긴 수를 돌려준다.
 */
export async function recordProductInfraPauses(ctx: RoleContext, product: readonly LedgerEvent[], afterSeq: number): Promise<number> {
  const known = new Set((await ctx.ledger.read()).flatMap((e) => (e.idempotencyKey === undefined ? [] : [e.idempotencyKey])));
  let recorded = 0;
  for (const e of product) {
    if (e.type !== 'task_blocked' || e.seq <= afterSeq) continue;
    const reason = String((e.payload as { reason?: unknown }).reason ?? '');
    if (classifyCliFailure(reason) !== 'infra') continue;
    const key = `infra-block:${e.id}`;
    if (known.has(key)) continue;
    const at = new Date(e.at);
    await ctx.ledger.record(
      'dogfood_infra_pause',
      { from: at.toISOString(), until: pauseUntil(reason, at).toISOString(), reason: reason.slice(0, 500), source: 'ensemble-agent' },
      { key },
    );
    recorded += 1;
  }
  return recorded;
}

/**
 * claude -p 결과의 사용량을 기록한다. 인프라 실패(사용량 한도·로그인·과부하)이면 dogfood_infra_pause도 남기고
 * ctx.infraPausedUntil을 고친다. 돌려주는 값은 대기 종료 시각(ISO) 또는 undefined다.
 */
export async function recordHarnessUsage(ctx: RoleContext, role: string, r: ClaudeRunResult): Promise<string | undefined> {
  await ctx.ledger.record('dogfood_usage_recorded', {
    source: 'harness',
    role,
    cycle: ctx.cycle,
    ok: r.ok,
    model: r.model,
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    cacheReadTokens: r.usage.cacheReadTokens,
    cacheCreationTokens: r.usage.cacheCreationTokens,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    sessionId: r.sessionId,
    failureKind: r.failureKind,
  });
  if (r.failureKind !== 'infra') return undefined;
  const now = new Date();
  const reason = `${r.error ?? ''} ${r.stderrTail}`.trim() || 'claude 인프라 실패';
  const until = pauseUntil(reason, now).toISOString();
  await ctx.ledger.record('dogfood_infra_pause', { from: now.toISOString(), until, reason: reason.slice(0, 500), source: role });
  ctx.infraPausedUntil = until;
  return until;
}

/**
 * 진척 서명. plan 버전, 상태별 작업 수, checked 수, 열린 결정 수, 대기 계획 수, Space 게시 수, verifiedDone 크기를 잇는다.
 * 5분 tick이 만드는 재전달·리마인드·요약 이벤트는 이 값을 바꾸지 않는다.
 */
export function progressSignature(events: readonly LedgerEvent[], harness: readonly LedgerEvent[]): string {
  const state = project(events);
  const byStatus = new Map<string, number>();
  for (const task of state.tasks.values()) byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1);
  const statuses = [...byStatus.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
  const checked = byStatus.get('checked') ?? 0;
  const openDecisions = [...state.decisionRequests.values()].filter((entry) => entry.status === 'open').length;
  const posts = events.filter((e) => e.type === 'space_post_recorded').length;
  return [
    `plan=${state.plan?.version ?? 0}`,
    `tasks=${statuses}`,
    `checked=${checked}`,
    `decisions=${openDecisions}`,
    `pending=${state.pendingPlans.size}`,
    `posts=${posts}`,
    `verified=${verifiedDone(harness).size}`,
  ].join('|');
}
