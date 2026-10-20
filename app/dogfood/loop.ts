// 반복 루프. 한 번의 반복(iteration)을 준비하고, 사이클을 돌리고, 정지 사유를 판정하고, 정리한다.
// 사이클 순서: tick(rule) -> settle -> 결정 대리 -> 사람 결과 재확인 -> 사람 몫 작업 -> settle -> 팀원 -> settle -> 다음 단계
// -> settle -> 사용량 수집 -> 마찰 기록 -> 프로브 -> cycle_finished -> 리포트. 재개는 지원하지 않는다.
// 제품 코드는 건드리지 않는다. 제품에는 공개 메서드와 환경 변수로만 닿는다.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { automationGate, isParentTask, project, type LedgerEvent } from '@ensemble/core';
import { backlogIdsIn, boardDone, parseBacklog, parseGoal, verifiedDone, type BacklogItem } from './backlog.ts';
import { childPids, claudeVersion } from './claude.ts';
import { acquireLock, assertFreshRunDir, assertOutsideRepo, repoRoot, runLayout, type DogfoodConfig } from './config.ts';
import { runFrictionRecorder } from './friction.ts';
import { bootstrapTarget, head, productState } from './git.ts';
import { startHost, type DogfoodHost } from './host.ts';
import { reconcilePending } from './human-result.ts';
import { DogfoodLedger, type DogfoodPayloads } from './ledger.ts';
import type { DogfoodMetrics } from './metrics.ts';
import { runStatusProbe } from './probe.ts';
import { classifyIntervention, runDecisionProxy, runMemberWorker, runNextStep } from './proxy.ts';
import { writeReport } from './report.ts';
import { lastSeq, progressSignature, recordProductInfraPauses, settle, type RoleContext } from './role-context.ts';
import { TEAMMATES, linkTeammate, runTeammate, type TeammateRunResult } from './teammates.ts';
import { collectAgentUsage } from './usage.ts';

export type StopReason = DogfoodPayloads['dogfood_run_stopped']['reason'];

export interface IterationResult {
  runId: string;
  reason: StopReason;
  detail?: string;
  cycles: number;
  metrics: DogfoodMetrics | null;
}

export interface IterationOptions {
  /** 리포트에 비교로 싣을 이전 실행의 지표. */
  compare?: DogfoodMetrics | null;
}

interface Stop {
  reason: StopReason;
  detail?: string;
}

const PLAN_ATTEMPTS = 3;
const STALL_CYCLES = 3;
const BOARD_ONLY_CYCLES = 3;
const INFRA_STREAK_LIMIT = 6;
const ROLE_PROMPTS = ['decision-proxy', 'member-worker', 'teammate-a', 'teammate-b', 'friction-recorder', 'status-probe'] as const;

const log = (text: string) => console.log(`[dogfood] ${text}`);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const payloadOf = (e: LedgerEvent): Record<string, unknown> => (e.payload ?? {}) as Record<string, unknown>;
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** 역할 프롬프트의 sha256 앞 12자. run_started에 남겨 실행 사이의 프롬프트 변경을 알아본다. */
function promptHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ROLE_PROMPTS) {
    try {
      const text = readFileSync(join(repoRoot(), 'app', 'dogfood', 'roles', `${name}.md`), 'utf8');
      out[name] = createHash('sha256').update(text).digest('hex').slice(0, 12);
    } catch {
      out[name] = 'missing';
    }
  }
  return out;
}

/** 하네스 원장에서 마지막 infra_pause가 아직 미래이면 그 종료 시각. */
function infraPausedUntil(harness: readonly LedgerEvent[]): string | undefined {
  const last = harness.findLast((e) => e.type === 'dogfood_infra_pause');
  const until = last === undefined ? undefined : payloadOf(last).until;
  return typeof until === 'string' && Date.parse(until) > Date.now() ? until : undefined;
}

/** 마지막 plan-failed 안내(PM이 남긴 pm_spoke)의 문구. */
function lastPlanFailure(events: readonly LedgerEvent[]): string | undefined {
  const spoke = events.findLast((e) => e.type === 'pm_spoke' && String(payloadOf(e).considerationId ?? '').startsWith('plan-failed:'));
  const text = spoke === undefined ? undefined : payloadOf(spoke).text;
  return typeof text === 'string' ? text : undefined;
}

/** 팀원 세션이 실제로 진척을 냈다: 건너뛰지 않았고 오류가 없으며 커밋이나 제출이 있다. 오류로 끝난 세션은 행동으로 세지 않는다. */
function teammateSessionActed(p: Record<string, unknown>): boolean {
  if (p.skipped === true || p.error !== undefined) return false;
  const commits = Array.isArray(p.commits) ? p.commits.length : 0;
  const submitted = Array.isArray(p.submitted) ? p.submitted.length : 0;
  return commits > 0 || submitted > 0;
}

/** 이 사이클에서 하네스가 한 일의 수: ok proxy_action, 진척을 낸 teammate_session(오류·건너뜀 제외), human_task_submitted. */
function harnessActs(harness: readonly LedgerEvent[], afterSeq: number): number {
  let n = 0;
  for (const e of harness) {
    if (e.seq <= afterSeq) continue;
    const p = payloadOf(e);
    if (e.type === 'dogfood_proxy_action' && p.ok === true) n += 1;
    else if (e.type === 'dogfood_teammate_session' && teammateSessionActed(p)) n += 1;
    else if (e.type === 'dogfood_human_task_submitted') n += 1;
  }
  return n;
}

/** 자식 프로세스를 끝낸다. Windows는 트리째(taskkill /T /F), 그 밖은 SIGKILL. */
function killChildren(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 15_000 });
      else process.kill(pid, 'SIGKILL');
    } catch {
      // 이미 끝난 프로세스
    }
  }
}

/** 한 번의 반복. 정지 사유와 마지막 지표를 돌려준다. 준비 중의 예외는 error로 기록한 뒤 다시 던진다. */
export async function runIteration(config: DogfoodConfig, options: IterationOptions = {}): Promise<IterationResult> {
  const layout = runLayout(config.runDir);
  assertOutsideRepo(config.runDir);
  assertFreshRunDir(config.runDir);
  mkdirSync(layout.root, { recursive: true });
  const lock = acquireLock(layout);

  const abort = new AbortController();
  let stopSignal: string | undefined;
  const onSignal = (name: string) => () => {
    if (stopSignal !== undefined) {
      log(`${name}을 다시 받아 바로 끝냅니다. 정리가 덜 됐을 수 있습니다`);
      process.exit(1);
    }
    stopSignal = name;
    log(`${name}을 받았습니다. 진행 중인 작업을 끝내고 정리합니다`);
    abort.abort();
  };
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? (['SIGBREAK'] as NodeJS.Signals[]) : [])];
  const handlers = signals.map((name) => [name, onSignal(name)] as const);
  for (const [name, handler] of handlers) process.on(name, handler);

  let ledger: DogfoodLedger | undefined;
  let host: DogfoodHost | undefined;
  let stop: Stop | undefined;
  let failure: unknown;
  let cycle = 0;
  let metrics: DogfoodMetrics | null = null;
  const startedAt = Date.now();

  try {
    ledger = new DogfoodLedger(layout.ledger, config.runId);
    mkdirSync(layout.logs, { recursive: true });
    await bootstrapTarget(config, layout, ledger);
    const goalDoc = parseGoal(readFileSync(join(layout.targetMain, 'DOGFOOD_GOAL.md'), 'utf8'), config.iteration);
    const backlog: BacklogItem[] = parseBacklog(readFileSync(join(layout.targetMain, 'BACKLOG.md'), 'utf8'));
    const iterItems = backlog.filter((b) => b.iteration === config.iteration);
    host = await startHost(config, layout, ledger);

    const product = await productState(repoRoot());
    const source = config.continueFrom !== undefined ? join(config.continueFrom, 'target', 'main') : (config.target ?? 'seed');
    await ledger.record('dogfood_run_started', {
      runId: config.runId,
      iteration: config.iteration,
      mode: config.mode,
      target: { source, head: await head(layout.targetMain), ...(config.continueFrom === undefined ? {} : { continueFrom: config.continueFrom }) },
      config,
      promptHashes: promptHashes(),
      backlogIds: iterItems.map((b) => b.id),
      plantedSolo: iterItems.filter((b) => b.solo !== undefined).map((b) => b.id),
      ensembleCommit: product.commit,
      productDirty: product.dirty,
      adapters: host.adapters,
      ...(host.claude === undefined ? {} : { claude: { exe: host.claude.exe, source: host.claude.source, version: claudeVersion(host.claude.exe) } }),
      node: process.version,
    });
    log(`반복 ${config.iteration} 시작(${config.mode}): runDir ${layout.root}`);

    const ctx: RoleContext = { config, layout, host, ledger, backlog, goal: goalDoc.goal, cycle: 0, signal: abort.signal };

    // ---- 계획 착수: 초안이 승인 대기 1건으로 생길 때까지 최대 3번.
    // 기한은 대상 레포 DOGFOOD_GOAL.md의 '기한:' 줄에서만 온다. maxHours는 정지 판정에만 쓴다(기준선이 하네스 설정에 흔들리지 않게).
    const deadline = goalDoc.deadline;
    let attempts = 0;
    let planned = false;
    for (let attempt = 0; attempt < PLAN_ATTEMPTS && !planned && !abort.signal.aborted; attempt++) {
      attempts = attempt + 1;
      if (attempt >= 1) {
        const action = { type: 'plan_retry' } as const;
        const { interventionType, counted } = classifyIntervention(action);
        await ledger.record('dogfood_proxy_action', {
          role: 'harness', memberId: 'owner', cycle: 0, action, interventionType, counted, ok: true, via: 'rule', harnessNoise: false,
        });
      }
      let reason: string | undefined;
      try {
        await host.runtime.startFree(goalDoc.goal, deadline, 'owner', true);
      } catch (error) {
        reason = errorText(error);
      }
      const events = await host.events();
      if (project(events).pendingPlans.size === 1) {
        planned = true;
        break;
      }
      reason ??= lastPlanFailure(events) ?? '승인 대기 초안이 생기지 않았습니다';
      await ledger.record('dogfood_role_note', { role: 'harness', cycle: 0, kind: 'info', text: `plan_draft_failed: ${reason}`.slice(0, 600) });
      log(`계획 초안 실패(${attempts}/${PLAN_ATTEMPTS}): ${reason.slice(0, 120)}`);
    }

    if (!planned) {
      stop = abort.signal.aborted ? { reason: 'interrupted' } : { reason: 'error', detail: 'plan_draft_failed' };
    } else {
      await ledger.record('dogfood_iteration_project', { iteration: config.iteration, projectId: host.projectId(), goal: goalDoc.goal, ...(deadline === undefined ? {} : { deadline }), planAttempts: attempts });
      for (const spec of TEAMMATES.slice(0, config.teammates)) await linkTeammate(ctx, spec);

      // ---- 사이클
      let prevSignature = progressSignature(await host.events(), await ledger.read());
      let stallStreak = 0;
      let boardOnlyStreak = 0;
      let infraStreak = 0;
      let blockScanSeq = 0;
      const rule = config.mode === 'rule';

      for (cycle = 1; stop === undefined; cycle++) {
        if (stopSignal !== undefined) break;
        ctx.cycle = cycle;
        ctx.infraPausedUntil = infraPausedUntil(await ledger.read());
        const pausedAtStart = ctx.infraPausedUntil !== undefined;
        let paused = pausedAtStart;
        const started = await ledger.record('dogfood_cycle_started', { cycle }, { key: `cycle-started:${cycle}` });
        if (paused) log(`사이클 ${cycle}: 인프라 대기 중(${ctx.infraPausedUntil}까지). 역할 단계는 건너뜁니다`);
        const quiet = () => settle(host!, config.settleSeconds * 1000);
        const acts: Record<string, unknown> = {};

        if (rule) await host.runtime.tick();
        await quiet();
        // 제품 실행 Agent의 인프라 막힘도 대기 구간으로 남긴다. 대기가 끝나면 대리가 retry한다.
        const settledEvents = await host.events();
        if ((await recordProductInfraPauses(ctx, settledEvents, blockScanSeq)) > 0) {
          ctx.infraPausedUntil = infraPausedUntil(await ledger.read());
          paused = ctx.infraPausedUntil !== undefined;
          if (paused) log(`사이클 ${cycle}: 실행 Agent가 인프라 사유로 막혀 ${ctx.infraPausedUntil}까지 대기합니다`);
        }
        blockScanSeq = lastSeq(settledEvents);
        acts.paused = paused;
        if (!paused && !abort.signal.aborted) {
          acts.owner = await runDecisionProxy(ctx, 'owner');
          acts.designer = await runDecisionProxy(ctx, 'designer');
          await reconcilePending(ctx);
          acts.worker = await runMemberWorker(ctx);
          await quiet();
          const sessions: Record<string, TeammateRunResult> = {};
          for (const spec of TEAMMATES.slice(0, config.teammates)) {
            if (abort.signal.aborted) break;
            sessions[spec.id] = await runTeammate(ctx, spec);
          }
          acts.teammates = Object.fromEntries(Object.entries(sessions).map(([id, r]) => [id, { skipped: r.skipped, jobs: r.jobs, merged: r.merged, progress: r.progress, submitted: r.submitted }]));
          await quiet();
          const next = abort.signal.aborted ? 'none' : await runNextStep(ctx);
          acts.nextStep = next;
          if (next === 'limit_stall') stop = { reason: 'stalled', detail: 'automation_limit' };
          await quiet();
        }

        if (config.mode === 'live' && !abort.signal.aborted) {
          try {
            await collectAgentUsage({ ledger, agentsRoot: layout.agents, cycle, since: new Date(startedAt).toISOString() });
          } catch (error) {
            await ledger.record('dogfood_role_note', { role: 'harness', cycle, kind: 'info', text: `Agent 사용량을 수집하지 못했습니다: ${errorText(error)}`.slice(0, 400) });
          }
        }
        if (!abort.signal.aborted) {
          try {
            const argvOverflow = host.argvOverflow();
            await runFrictionRecorder(ctx, { ...(argvOverflow === undefined ? {} : { argvOverflow }) });
          } catch (error) {
            await ledger.record('dogfood_role_note', { role: 'harness', cycle, kind: 'info', text: `마찰 기록자가 실패했습니다: ${errorText(error)}`.slice(0, 400) });
          }
          if (!paused && stop === undefined && cycle % config.probeEvery === 0) {
            try {
              await runStatusProbe(ctx);
            } catch (error) {
              await ledger.record('dogfood_role_note', { role: 'harness', cycle, kind: 'info', text: `현황 프로브가 실패했습니다: ${errorText(error)}`.slice(0, 400) });
            }
          }
        }

        const events = await host.events();
        const harness = await ledger.read();
        const signature = progressSignature(events, harness);
        await ledger.record('dogfood_cycle_finished', { cycle, productSeq: lastSeq(events), progressSignature: signature, actions: acts }, { key: `cycle-finished:${cycle}` });
        const written = await writeReport(layout, { product: events, harness }, options.compare === undefined ? {} : { compare: options.compare });
        metrics = written.metrics;

        // ---- 정지 판정
        const state = project(events);
        const verified = verifiedDone(harness);
        const boardIds = boardDone(events);
        const acted = harnessActs(harness, started.seq);
        const newPause = harness.some((e) => e.seq > started.seq && e.type === 'dogfood_infra_pause');
        if (!pausedAtStart) {
          infraStreak = newPause ? infraStreak + 1 : 0;
          stallStreak = signature === prevSignature && acted === 0 ? stallStreak + 1 : 0;
          const unverified = iterItems.filter((b) => !verified.has(b.id));
          boardOnlyStreak = unverified.length > 0 && unverified.every((b) => boardIds.has(b.id)) ? boardOnlyStreak + 1 : 0;
        }
        prevSignature = signature;
        log(`사이클 ${cycle} 완료: 검증 ${iterItems.filter((b) => verified.has(b.id)).length}/${iterItems.length}, 하네스 행동 ${acted}`);

        if (stopSignal !== undefined) break;
        if (stop !== undefined) break;
        const allVerified = iterItems.length > 0 && iterItems.every((b) => verified.has(b.id));
        const working = [...state.tasks.values()].some((t) => t.status !== 'checked' && t.status !== 'cancelled' && !isParentTask(state, t));
        const openAsk = [...state.decisionRequests.values()].some((d) => d.status === 'open') || state.pendingPlans.size > 0 || state.pendingAuthority.size > 0;
        const overflow = host.argvOverflow();
        if (allVerified && !working && !openAsk) stop = { reason: 'done' };
        else if (overflow !== undefined) stop = { reason: 'argv_limit', detail: `${overflow.chars}자${overflow.tool ? `(${overflow.tool})` : ''}` };
        else if (infraStreak >= INFRA_STREAK_LIMIT) stop = { reason: 'infra', detail: `연속 ${infraStreak}회` };
        else if (config.budgetTokens > 0 && (written.metrics?.cost.totalWeighted ?? 0) >= config.budgetTokens) stop = { reason: 'budget' };
        else if (config.maxHours > 0 && Date.now() - startedAt >= config.maxHours * 3_600_000) stop = { reason: 'max_hours' };
        else if (stallStreak >= STALL_CYCLES) stop = { reason: 'stalled', ...(automationGate(state).allowed ? {} : { detail: 'automation_limit' }) };
        else if (boardOnlyStreak >= BOARD_ONLY_CYCLES) stop = { reason: 'stalled', detail: 'board_only' };
        else if (cycle >= config.maxCycles) stop = { reason: 'max_cycles' };
        if (stop !== undefined) break;

        if (config.mode === 'live' && config.cycleMinutes > 0) {
          for (let s = 0; s < config.cycleMinutes * 60 && !abort.signal.aborted; s++) await sleep(1000, abort.signal);
        }
      }
      cycle = Math.min(cycle, ctx.cycle);
    }
  } catch (error) {
    failure = error;
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler);
    if (stopSignal !== undefined) stop = { reason: 'interrupted', detail: stopSignal };
    else if (failure !== undefined) stop = { reason: 'error', detail: errorText(failure).slice(0, 400) };
    else stop ??= { reason: 'error', detail: 'unknown' };
    if (ledger !== undefined) {
      try {
        await ledger.record('dogfood_run_stopped', { reason: stop.reason, cycle, ...(stop.detail === undefined ? {} : { detail: stop.detail }) });
      } catch (error) {
        log(`run_stopped를 기록하지 못했습니다: ${errorText(error)}`);
      }
      if (host !== undefined) {
        try {
          const written = await writeReport(layout, { product: await host.events(), harness: await ledger.read() }, options.compare === undefined ? {} : { compare: options.compare });
          metrics = written.metrics;
        } catch (error) {
          log(`리포트를 쓰지 못했습니다: ${errorText(error)}`);
        }
      }
    }
    if (host !== undefined) await host.close().catch((error: unknown) => log(`호스트를 닫지 못했습니다: ${errorText(error)}`));
    const leftover = [...childPids];
    killChildren(leftover);
    childPids.clear();
    try {
      writeFileSync(join(layout.logs, 'pids.json'), `${JSON.stringify({ at: new Date().toISOString(), killed: leftover }, null, 2)}\n`);
    } catch {
      // logs가 없으면 기록할 것도 없다.
    }
    try {
      ledger?.close();
    } catch {
      // 이미 닫힘
    }
    lock.release();
    log(`반복 종료: ${stop.reason}${stop.detail === undefined ? '' : `(${stop.detail})`}, 사이클 ${cycle}`);
  }
  if (failure !== undefined) throw failure;
  return { runId: config.runId, reason: stop.reason, ...(stop.detail === undefined ? {} : { detail: stop.detail }), cycles: cycle, metrics };
}
