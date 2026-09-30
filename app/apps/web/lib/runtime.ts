import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { SqliteLedgerStore, type LedgerStore } from '@ensemble/store';
import { AnthropicProvider, loadEnv, modelFor, type LlmProvider } from '@ensemble/llm';
import { CodexSessionConnector, codexSettingsFromEnv, type SessionConnector } from '@ensemble/agents';
import { ProjectManager, type FreeStartResult } from '@ensemble/orchestrator';
import { project, type AnyEvent, type LedgerEvent } from '@ensemble/core';
import { continuousScenario, advanceScript, createRevisionGenerator, sceneEvents, SCENE_NOW, type ScriptProgress, type Condition, type RevisionGenerator } from '@ensemble/scenarios';
import { FakeConnector } from './fake-connector';
import { buildViewModel, projectTitle } from './build-view-model';
import { taskResolutions, type ResolutionAction } from './task-resolution';
import type { VmActivity } from './view-model';

/** Cuts at a word boundary so the title (with "…") stays within `max` characters; a single long word is cut at `max`. */
export function shortTitle(text: string, max = 40) {
  const title = text.trim().replace(/\s+/g, ' ');
  if (title.length <= max) return title;
  const space = title.lastIndexOf(' ', max - 1);
  return (space > 0 ? title.slice(0, space) : title.slice(0, max - 1)) + '…';
}

interface Metadata { projectId: string; mode: 'free' | 'scenario'; scene: 1 | 2 | 3; step: number; script?: ScriptProgress; archivedProjectIds?: string[]; archives?: { id: string; archivedAt: string; mode: 'free' | 'scenario' }[] }
export interface Upload { name: string; mimeType: string; contentBase64: string }
export class RuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}
export interface Activity {
  kind: 'pm_thinking' | 'scenario_waiting' | 'agent_working' | 'idle'; label: string; since: string;
  stalled?: VmActivity['stalled'];
}

/** One Codex thread per agent, each in its own folder outside the repository, with a turn time limit. */
function codexAgents() {
  const { workspaceRoot, turnTimeoutMs } = codexSettingsFromEnv();
  const inRepo = path.relative(path.dirname(appRoot()), workspaceRoot);
  if (!inRepo.startsWith('..') && !path.isAbsolute(inRepo)) throw new Error('ENSEMBLE_AGENT_WORKSPACE_ROOT must be outside the repository');
  return { connector: new CodexSessionConnector({ workspaceRoot }), turnTimeoutMs };
}

/** The PM already told the channel; the server log keeps the cause for diagnosis. */
function logDraftFailure(result: FreeStartResult) {
  if (result.failure) console.error(`[ensemble] plan drafting failed: ${result.failure.detail}`);
}

function appRoot() {
  let dir = process.cwd();
  while (!existsSync(path.join(dir, 'packages', 'orchestrator'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Cannot locate Ensemble app directory');
    dir = parent;
  }
  return dir;
}

/** SOUND: ledger-backed UI and real PM decisions; scenario changes only the human input.
 * All three scenes retain the drafted plan and resolve human submissions by assignee.
 * Verification: fake-provider continuous-script integration and condition/target tests.
 */
export class WebRuntime {
  readonly dataDir: string;
  readonly listeners = new Set<() => void>();
  readonly store: LedgerStore;
  meta: Metadata;
  pm!: ProjectManager;
  busy = false;
  private queue: Promise<unknown> = Promise.resolve();
  private intake: Promise<unknown> = Promise.resolve();
  private pendingMessages = 0;
  private pendingResolutions = new Set<string>();
  private resolutionErrors = new Map<string, string>();
  private replacing = false;
  private recovering = false;
  private scenarioFlight?: Promise<void>;
  private scenarioAbort?: AbortController;
  private waiting?: { condition: Condition; since: number; seq: number; quietSince: number; stalled: boolean };
  private activitySince = new Date().toISOString();
  private activityKind: Activity['kind'] = 'idle';
  private ready: Promise<void>;
  private readonly metaFile: string;

  constructor(private readonly options: { dataDir?: string; store?: LedgerStore; llm?: LlmProvider; connector?: SessionConnector; generateRevision?: RevisionGenerator } = {}) {
    loadEnv();
    this.dataDir = options.dataDir ?? process.env.ENSEMBLE_DATA_DIR ?? path.join(appRoot(), 'data');
    this.metaFile = path.join(this.dataDir, 'runtime.json');
    mkdirSync(path.join(this.dataDir, 'attachments'), { recursive: true });
    const sqlite = options.store ?? new SqliteLedgerStore(path.join(this.dataDir, 'ensemble.db'));
    this.store = {
      read: filter => sqlite.read(filter), close: () => sqlite.close(),
      append: async events => { const result = await sqlite.append(events); this.changed(); return result; },
      transaction: async (projectId, fn) => { const result = await sqlite.transaction(projectId, fn); if (result.appended.length) this.changed(); return result; },
    };
    this.meta = existsSync(this.metaFile) ? JSON.parse(readFileSync(this.metaFile, 'utf8')) as Metadata : { projectId: randomUUID(), mode: 'free', scene: 1, step: 0 };
    this.ready = this.initialize();
  }
  changed() { for (const listener of this.listeners) listener(); }
  private async save() {
    const temporary = `${this.metaFile}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.meta));
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, this.metaFile); return; }
      catch (error) {
        // Windows scanners can briefly hold an existing destination open; keep the atomic replacement.
        if (process.platform !== 'win32' || attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt));
      }
    }
  }
  private context() { return { projectId: this.meta.projectId, targetProductId: 'ensemble-demo' }; }
  private async initialize() {
    if (!(await this.store.read({ projectId: this.meta.projectId })).length) await this.seed('owner', false);
    this.createPm();
    try { await this.pm.deliverPendingChanges(); }
    catch { console.info('[ensemble] 재시작 후 대기 중인 변경 전달을 마치지 못했습니다. 작업 상태를 확인하세요.'); }
    await this.save();
  }
  private createPm() {
    const runtime = process.env.ENSEMBLE_AGENT_RUNTIME ?? 'fake';
    if (!['fake', 'codex'].includes(runtime)) throw new Error('ENSEMBLE_AGENT_RUNTIME must be fake or codex');
    // Agent results arrive as attachments recorded from the agent's workspace; the PM reads them from the ledger.
    this.pm = new ProjectManager({ ...this.context(), store: this.store, llm: this.options.llm ?? new AnthropicProvider(), model: modelFor('pm'),
      // The demo's third scene observes a change during construction; its simulated build ends after that change.
      ...(this.options.connector ? { connector: this.options.connector } : runtime === 'codex' ? codexAgents() : { connector: new FakeConnector(path.join(this.dataDir, 'fake-agents'), this.options.generateRevision ?? createRevisionGenerator(this.options.llm ?? new AnthropicProvider(), modelFor('pm')), (agentId, version) => this.meta.mode !== 'scenario' || agentId !== 'prototype-agent' || version > 1, 2000,
        async taskId => project(await this.store.read({ projectId: this.meta.projectId })).tasks.get(taskId)?.spec) }),
      // Live scenario inputs and PM/agent replies share the store's wall clock.
      clock: () => new Date(),
    });
  }
  private async seed(decider: string, scenario: boolean) {
    const ctx = this.context();
    if (scenario) {
      const events = sceneEvents(1, ctx).filter(e => !['plan_committed', 'estimate_updated', 'availability_updated'].includes(e.type) && !(e.type === 'member_joined' && (e.payload as { memberId: string }).memberId === 'reviewer'));
      for (const e of events) if (e.type === 'member_joined') {
        const p = e.payload as { kind: string; memberId: string; role?: string };
        if (p.kind === 'agent') p.role = p.memberId === 'research-agent' ? '고객 조사와 반응 분석' : '웹 프로토타입 구현';
      }
      // Availability comes from the scripted human inputs before drafting.
      await this.store.append(events); return;
    }
    const base = { ...ctx, actor: { kind: 'human' as const, id: decider } };
    const other = decider === 'owner' ? 'designer' : 'owner';
    await this.store.append([
      ...[{ memberId: decider, kind: 'human', displayName: decider === 'owner' ? '사용자' : decider }, { memberId: other, kind: 'human', displayName: other === 'owner' ? '사용자' : '디자이너' }, { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent', role: '고객 조사와 반응 분석' }, { memberId: 'prototype-agent', kind: 'agent', displayName: '프로토타입 Agent', role: '웹 프로토타입 구현' }].map(payload => ({ ...base, type: 'member_joined', payload })),
      { ...base, type: 'goal_set', payload: { text: '새 프로젝트', decider, delegation: { pmMayApply: ['reorder', 'reassign_agent'] } } },
    ]);
  }
  async state(me = 'owner') {
    await this.ready;
    const events = await this.store.read({ projectId: this.meta.projectId });
    const state = project(events);
    if (state.members.get(me)?.kind !== 'human') me = state.goal?.decider ?? 'owner';
    const next = continuousScenario.steps[this.meta.script?.step ?? this.meta.step];
    const stopped = this.meta.script?.stopped;
    const view = buildViewModel(events, { me, mode: this.meta.mode, busy: this.busy || !!this.scenarioFlight || this.pendingMessages > 0, now: this.meta.mode === 'scenario' ? SCENE_NOW : new Date(),
      ...(this.meta.mode === 'scenario' ? { scenario: { name: `${continuousScenario.key} · 장면 ${next?.scene ?? 3}`, done: !stopped && !next,
        ...(stopped ? { nextLine: { authorName: '시나리오 중단', text: '대본 진행이 멈췄습니다. 상태를 확인하고 재시도하거나 이 단계를 건너뛰세요.', hasAttachment: false } } : next ? { nextLine: { authorName: state.members.get(next.as)?.displayName ?? next.as, text: next.text, hasAttachment: !!next.attachments?.length } } : {}) } } : {}),
    });
    const goal = state.goal?.text?.replace(/^시연용 가상 자료입니다\.?\s*/, '') ?? '새 프로젝트';
    const resolutions = taskResolutions(events, me).map(r => ({ ...r, actions: this.pendingResolutions.has(r.taskId) ? [] : r.actions }));
    for (const task of view.roadmap.tasks) if (task.resolution && this.pendingResolutions.has(task.id)) task.resolution.actions = [];
    const activity = this.activity(events);
    if (resolutions.length && !activity.stalled) activity.stalled = { reason: resolutions[0]!.reason, canRetry: false, canSkip: false };
    const resolutionError = [...this.resolutionErrors.values()].at(-1);
    if (resolutionError) activity.stalled = { reason: resolutionError, canRetry: false, canSkip: false };
    return { ...view, project: { ...view.project, id: this.meta.projectId, title: shortTitle(goal.split(/[.!?。]/)[0]!), synthetic: this.meta.mode === 'scenario' }, activity: { ...activity, ...(activity.stalled ? { stalled: { ...activity.stalled, tasks: resolutions } } : {}) } };
  }

  async archives() {
    await this.ready;
    return Promise.all([...(this.meta.archivedProjectIds ?? [])].reverse().map(async id => {
      const events = await this.store.read({ projectId: id });
      const saved = this.meta.archives?.find(a => a.id === id);
      return { id, title: projectTitle(project(events).goal?.text).title ?? '새 프로젝트', archivedAt: saved?.archivedAt ?? null };
    }));
  }
  async archivedState(id: string, me = 'owner') {
    await this.ready;
    if (!this.meta.archivedProjectIds?.includes(id)) throw new RuntimeError('archive_not_found', '보관된 프로젝트를 찾지 못했습니다.', 404);
    const events = await this.store.read({ projectId: id });
    const saved = this.meta.archives?.find(a => a.id === id);
    const state = project(events);
    const mode = saved?.mode ?? (state.goal?.text.startsWith('시연용') ? 'scenario' : 'free');
    const view = buildViewModel(events, { me, mode, busy: false, now: mode === 'scenario' ? SCENE_NOW : new Date(saved?.archivedAt ?? events.at(-1)?.at ?? Date.now()) });
    return { ...view, project: { ...view.project, id, title: projectTitle(state.goal?.text).title ?? '새 프로젝트' }, readOnly: true, cards: [], members: view.members.map(m => ({ ...m, busy: false })) };
  }

  private activity(events: readonly LedgerEvent[]): Activity {
    const state = project(events), now = Date.now();
    const working = this.busy || this.pendingMessages > 0 || (this.pm as ProjectManager & { isProcessing?: boolean }).isProcessing || (!!this.scenarioFlight && !this.waiting);
    if (this.waiting) {
      if (working) {
        this.waiting.seq = state.lastSeq; this.waiting.quietSince = now; this.waiting.stalled = false;
      } else this.waiting.stalled = !state.activeTurn.size && now - this.waiting.quietSince >= 60_000;
    }
    const kind: Activity['kind'] = working ? 'pm_thinking' : this.waiting || this.meta.script?.stopped ? 'scenario_waiting' : state.activeTurn.size ? 'agent_working' : 'idle';
    if (this.activityKind !== kind) { this.activityKind = kind; this.activitySince = new Date(now).toISOString(); }
    const typed = events as readonly AnyEvent[];
    const starts = [...state.activeTurn.values()].flatMap(taskId => {
      const start = typed.findLast(e => e.type === 'task_started' && e.payload.taskId === taskId);
      if (!start) return [];
      const progress = typed.findLast(e => e.seq >= start.seq && ['task_started', 'turn_observed', 'reply_recorded', 'result_submitted', 'update_acknowledged', 'agent_report_recorded'].includes(e.type) && e.actor.kind === 'agent' && 'taskId' in e.payload && e.payload.taskId === taskId);
      return [{ taskId, start: Date.parse(start.at), progress: Date.parse(progress?.at ?? start.at) }];
    });
    const limit = process.env.ENSEMBLE_AGENT_RUNTIME === 'codex' ? codexSettingsFromEnv().turnTimeoutMs : 120_000;
    const agentStalled = starts.find(t => now - t.progress >= limit);
    const blocked = [...state.tasks.values()].find(t => t.status === 'blocked' && t.blocked);
    const since = this.waiting ? new Date(this.waiting.since).toISOString() : starts.length ? new Date(Math.min(...starts.map(t => t.start))).toISOString() : this.activitySince;
    const condition = this.waiting?.condition;
    const who = condition?.kind === 'taskOf' ? state.members.get(condition.assignee)?.displayName ?? '담당자' : undefined;
    const target = who ? `${who} 작업 상태를` : '다음 단계 조건을';
    const label = kind === 'pm_thinking' ? 'PM이 판단 중' : kind === 'agent_working' ? 'Agent가 작업 중' : kind === 'scenario_waiting' ? `대본: ${target} 기다리는 중` : '입력을 기다리는 중';
    let reason = `대본이 ${target} 기다리지만 60초 동안 진행 중인 판단이나 작업이 없어 멈췄습니다.`;
    if (condition?.kind === 'taskOf') {
      const task = [...state.tasks.values()].find(t => t.spec.assignee === condition.assignee);
      const dependency = task?.spec.dependsOn.map(id => state.tasks.get(id)).find(t => t?.status === 'revising' || t?.blocked);
      if (dependency) reason = `대본이 ${who} 작업 시작을 기다리지만 선행 작업 ‘${dependency.spec.title}’${dependency.status === 'revising' ? '의 보완이 필요합니다.' : '이 막혀 있습니다.'}`;
      else if (task?.status === 'ready') reason = `대본이 ${who} 작업 상태를 기다리는데 작업은 이미 시작 가능한 상태입니다.`;
      else if (task?.status === 'checked') reason = `대본이 ${who} 작업 상태를 기다리는데 작업은 이미 완료되었습니다.`;
      else if (!task) reason = `대본에 필요한 ${who} 담당 작업이 현재 계획에 없습니다.`;
    }
    return { kind, label, since: since ?? new Date(now).toISOString(), ...(agentStalled || blocked || this.waiting?.stalled || this.meta.script?.stopped ? { stalled: {
      reason: `${agentStalled ? `${state.tasks.get(agentStalled.taskId)?.spec.title ?? agentStalled.taskId}: ${Math.round(limit / 60000)}분 동안 진행 보고 없음` : blocked ? `${blocked.spec.title}: ${blocked.blocked!.reason.replace(/\s+/g, ' ')}` : this.meta.script?.stopped ? this.meta.script.stopped.replace(/^Step \d+:\s*/, '').split('\n')[0] : reason} · 작업과 첨부를 직접 확인하세요.`, canRetry: this.meta.mode === 'scenario', canSkip: this.meta.mode === 'scenario',
    } } : {}) };
  }

  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { await this.ready; this.busy = true; this.changed(); try { return await action(); } finally { this.busy = false; this.changed(); } });
    this.queue = next.catch(() => undefined); return next;
  }
  private async replace(confirmReplace: boolean) {
    const events = await this.store.read({ projectId: this.meta.projectId });
    const state = project(events);
    const exists = this.meta.mode === 'scenario' || !!state.plan || state.pendingPlans.size > 0 || (state.goal?.text !== '새 프로젝트' && !!state.goal) || events.some(e => e.type === 'message_recorded');
    if (exists && !confirmReplace) throw new RuntimeError('project_exists', '진행 중인 프로젝트가 있습니다. 기존 기록을 보관하고 새 프로젝트를 시작할까요?');
    if (this.scenarioFlight) {
      this.scenarioAbort?.abort(); await this.scenarioFlight.catch(() => undefined);
    }
    await this.intake;
    await this.pm.stop();
    this.resolutionErrors.clear(); this.pendingResolutions.clear();
    (this.meta.archives ??= []).push({ id: this.meta.projectId, archivedAt: new Date().toISOString(), mode: this.meta.mode });
    return [...(this.meta.archivedProjectIds ?? []), ...(events.length ? [this.meta.projectId] : [])];
  }
  async startFree(goal: string, deadline: string | undefined, me: string, confirmReplace = false) {
    this.replacing = true;
    try {
      const previous = project(await this.store.read({ projectId: this.meta.projectId }));
      if (previous.members.get(me)?.kind !== 'human') throw new Error('Unknown human member');
      const archivedProjectIds = await this.replace(confirmReplace);
      this.meta = { projectId: randomUUID(), mode: 'free', scene: 1, step: 0, archivedProjectIds, archives: this.meta.archives };
      await this.seed(me, false);
      for (const [memberId, weeklyHours] of previous.availability) if ([me, me === 'owner' ? 'designer' : 'owner'].includes(memberId)) await this.store.append([{ ...this.context(), actor: { kind: 'human', id: memberId }, type: 'availability_updated', payload: { memberId, weeklyHours } }]);
      this.createPm(); await this.save();
      this.replacing = false;
      logDraftFailure(await this.pm.startFreeProject(goal, deadline));
    } finally { this.replacing = false; }
  }
  async startScenario(name: string, confirmReplace = false) {
    if (name !== continuousScenario.key && name !== 'scene-1-3') throw new Error('Unknown scenario');
    this.replacing = true;
    try {
      const archivedProjectIds = await this.replace(confirmReplace);
      this.meta = { projectId: randomUUID(), mode: 'scenario', scene: 1, step: 0, script: { step: 0, anchors: {} }, archivedProjectIds, archives: this.meta.archives };
      await this.seed('owner', true); this.createPm(); await this.save();
    } finally { this.replacing = false; }
  }
  async launchScenario() {
    await this.ready;
    if (this.replacing) throw new RuntimeError('project_switching', '프로젝트를 전환 중입니다. 잠시 후 다시 시도해 주세요.');
    if (this.meta.mode !== 'scenario' || !this.meta.script) throw new RuntimeError('scenario_missing', '먼저 시나리오를 시작해 주세요.');
    if (this.meta.script.stopped) throw new RuntimeError('scenario_stopped', '대본이 멈췄습니다. 재시도하거나 이 단계를 건너뛰세요.');
    void this.scenarioNext().catch(() => console.info('[ensemble] 대본 진행 중단: 상태에서 이유를 확인하세요.'));
    return { accepted: true as const };
  }
  async scenarioNext() {
    if (this.scenarioFlight) return this.scenarioFlight;
    const flight = this.advanceScenario();
    this.scenarioFlight = flight;
    try { await flight; } finally { this.scenarioFlight = undefined; this.waiting = undefined; this.changed(); }
  }
  private async advanceScenario() {
    if (this.meta.mode !== 'scenario') throw new Error('Start a scenario first');
    // Old metadata cannot safely resume the former scene-switching script.
    if (!this.meta.script) throw new Error('Restart the scenario to use the continuous script');
    this.scenarioAbort = new AbortController();
    try {
      await advanceScript({ pm: this.pm,
        waitOptions: { signal: this.scenarioAbort.signal, onReady: () => { this.waiting = undefined; this.changed(); }, onWaiting: (condition, events) => {
          this.waiting ??= { condition, since: Date.now(), quietSince: Date.now(), seq: project(events).lastSeq, stalled: false };
          const wasStalled = this.waiting.stalled;
          this.activity(events);
          if (wasStalled !== this.waiting.stalled) this.changed();
        } },
        recordHuman: async (authorId, text, step) => {
          this.waiting = undefined;
          const messageId = `script:${this.meta.projectId}:${step}:human`;
          await this.store.append([{ ...this.context(), actor: { kind: 'human', id: authorId }, type: 'message_recorded', idempotencyKey: messageId, payload: { messageId, authorId, text, attachmentIds: [] } }]);
        },
        generateRevision: input => (this.options?.generateRevision ?? createRevisionGenerator(this.options?.llm ?? new AnthropicProvider(), modelFor('pm')))(input),
        read: () => this.store.read({ projectId: this.meta.projectId }),
        recordStop: async reason => { await this.store.append([{ ...this.context(), actor: { kind: 'system', id: 'scenario' }, type: 'scenario_stopped', payload: { scenario: continuousScenario.key, step: this.meta.script!.step, reason } }]); },
      }, continuousScenario.steps, this.meta.script, continuousScenario.completion);
    } finally {
      this.meta.step = this.meta.script.step;
      this.meta.scene = continuousScenario.steps[this.meta.step]?.scene ?? 3;
      await this.save(); this.changed(); await this.persistAttachments();
    }
  }
  async scenarioRecover(skip: boolean) {
    if (this.recovering) throw new RuntimeError('scenario_recovering', '대본을 복구 중입니다. 잠시 기다려 주세요.');
    this.recovering = true;
    try {
      if (this.replacing) throw new RuntimeError('project_switching', '프로젝트를 전환 중입니다. 잠시 후 다시 시도해 주세요.');
      if (this.meta.mode !== 'scenario' || !this.meta.script) throw new RuntimeError('scenario_missing', '먼저 시나리오를 시작해 주세요.');
      const status = this.activity(await this.store.read({ projectId: this.meta.projectId }));
      if (!status.stalled) throw new RuntimeError('scenario_not_stalled', '멈춘 대본 단계가 없습니다.');
      this.scenarioAbort?.abort();
      await this.scenarioFlight?.catch(() => undefined);
      if (skip) this.meta.script.step++;
      delete this.meta.script.stopped;
      this.meta.step = this.meta.script.step;
      this.meta.scene = continuousScenario.steps[this.meta.step]?.scene ?? 3;
      this.waiting = undefined; await this.save(); this.changed();
      if (!skip) void this.scenarioNext().catch(() => console.info('[ensemble] 대본 재시도 중단: 상태에서 이유를 확인하세요.'));
    } finally { this.recovering = false; }
  }
  async message(authorId: string, text: string, attachments: Upload[] = []) {
    if (this.replacing) throw new RuntimeError('project_switching', '프로젝트를 전환 중입니다. 입력을 유지하고 잠시 후 다시 보내 주세요.');
    // Serialize only durable acceptance; slow PM work must not delay a later receipt.
    const accept = this.intake.then(async () => {
      await this.ready;
      if (this.replacing) throw new RuntimeError('project_switching', '프로젝트를 전환 중입니다. 입력을 유지하고 잠시 후 다시 보내 주세요.');
      if (project(await this.store.read({ projectId: this.meta.projectId })).members.get(authorId)?.kind !== 'human') throw new RuntimeError('unknown_author', '메시지를 보낼 사람을 선택해 주세요.', 400);
      const pm = this.pm;
      const result = await pm.recordMessage(authorId, text, attachments.map(a => ({ ...a, content: Buffer.from(a.contentBase64, 'base64').toString('utf8') })));
      this.pendingMessages++;
      void pm.processRecordedMessage(result.messageId).catch(error => console.error('[ensemble] message processing failed', error)).finally(() => { this.pendingMessages--; this.changed(); });
      return { accepted: true as const, messageId: result.messageId };
    });
    this.intake = accept.catch(() => undefined);
    return accept;
  }
  async resolveTask(taskId: string, action: ResolutionAction, by: string, note?: string) {
    await this.ready;
    if (this.replacing) throw new RuntimeError('project_switching', '프로젝트를 전환 중입니다. 잠시 후 다시 시도해 주세요.');
    if (this.pendingResolutions.has(taskId)) throw new RuntimeError('resolution_pending', '이 작업의 해결 요청을 처리 중입니다. 잠시 기다려 주세요.');
    const events = await this.store.read({ projectId: this.meta.projectId });
    const state = project(events);
    if (!state.tasks.has(taskId)) throw new RuntimeError('task_not_found', '작업을 찾지 못했습니다.', 404);
    const resolution = taskResolutions(events, by).find(t => t.taskId === taskId);
    if (!resolution?.actions.includes(action)) throw new RuntimeError('resolution_unavailable', '현재 작업 상태나 권한으로는 이 방법을 사용할 수 없습니다.', 409);
    if (this.replacing || this.pendingResolutions.has(taskId)) throw new RuntimeError('resolution_pending', '작업 상태가 바뀌고 있습니다. 잠시 후 다시 시도해 주세요.');
    const pm = this.pm;
    // Acceptance is prompt; the PM serializes and revalidates the actual operation.
    this.pendingMessages++;
    this.pendingResolutions.add(taskId); this.resolutionErrors.delete(taskId);
    void pm.resolveTask(taskId, { action, by, ...(note?.trim() ? { note: note.trim() } : {}) })
      .catch((error: unknown) => { console.error('[ensemble] 작업 해결 처리 실패', error); this.resolutionErrors.set(taskId, '작업 해결 요청을 처리하지 못했습니다. 현재 작업 상태를 확인한 뒤 다시 시도해 주세요.'); })
      .finally(() => { this.pendingResolutions.delete(taskId); this.pendingMessages--; this.changed(); });
    this.changed();
    return { accepted: true as const };
  }
  async persistAttachments() {
    for (const e of await this.store.read({ projectId: this.meta.projectId }) as AnyEvent[]) {
      if (e.type !== 'attachment_recorded' || !/^[\w-]+$/.test(e.payload.attachmentId)) continue;
      const match = /^data:[^,]*;base64,(.*)$/s.exec(e.payload.uri);
      if (match) writeFileSync(path.join(this.dataDir, 'attachments', e.payload.attachmentId), Buffer.from(match[1]!, 'base64'));
    }
  }
  async attachment(id: string) {
    await this.ready;
    if (!/^[\w-]+$/.test(id)) return null;
    const event = (await this.store.read() as AnyEvent[]).find(e => e.type === 'attachment_recorded' && e.payload.attachmentId === id);
    if (!event || event.type !== 'attachment_recorded') return null;
    const file = path.join(this.dataDir, 'attachments', id);
    const match = /^data:[^,]*;base64,(.*)$/s.exec(event.payload.uri);
    if (!existsSync(file) && match) writeFileSync(file, Buffer.from(match[1]!, 'base64'));
    if (!existsSync(file)) return null;
    return { data: await readFile(file), name: event.payload.name, mimeType: event.payload.mimeType };
  }
  async stop() {
    this.scenarioAbort?.abort();
    await this.scenarioFlight?.catch(() => undefined);
    await this.intake;
    await this.pm.stop(); this.store.close(); this.listeners.clear();
  }
}

const globalRuntime = globalThis as typeof globalThis & { ensembleRuntime?: WebRuntime };
export function getRuntime() { return globalRuntime.ensembleRuntime ??= new WebRuntime(); }
