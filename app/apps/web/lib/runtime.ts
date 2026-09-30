import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SqliteLedgerStore, type LedgerStore } from '@ensemble/store';
import { AnthropicProvider, loadEnv, modelFor } from '@ensemble/llm';
import { CodexSessionConnector, codexSettingsFromEnv, type SessionConnector, type SessionEvent } from '@ensemble/agents';
import { ProjectManager, type FreeStartResult } from '@ensemble/orchestrator';
import { project, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import { continuousScenario, advanceScript, createRevisionGenerator, sceneEvents, SCENE_NOW, type ScriptProgress } from '@ensemble/scenarios';
import { buildViewModel } from './build-view-model';

interface Metadata { projectId: string; mode: 'free' | 'scenario'; scene: 1 | 2 | 3; step: number; script?: ScriptProgress }
export interface Upload { name: string; mimeType: string; contentBase64: string }

/** Fake transport intentionally produces no fabricated work or PM answers. */
class FakeConnector implements SessionConnector {
  private listeners = new Set<(e: SessionEvent) => void>();
  async startSession(agentId: string, projectId: string) { return { threadId: `fake-${projectId}-${agentId}`, workspace: '/fake' }; }
  async startTask() { return `fake-${randomUUID()}`; }
  async sendUpdate() { return { sent: true as const }; }
  onEvent(handler: (e: SessionEvent) => void) { this.listeners.add(handler); return () => { this.listeners.delete(handler); }; }
  async stop() { this.listeners.clear(); }
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
  readonly dataDir = process.env.ENSEMBLE_DATA_DIR ?? path.join(appRoot(), 'data');
  readonly listeners = new Set<() => void>();
  readonly store: LedgerStore;
  meta: Metadata;
  pm!: ProjectManager;
  busy = false;
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private readonly metaFile = path.join(this.dataDir, 'runtime.json');

  constructor() {
    loadEnv();
    mkdirSync(path.join(this.dataDir, 'attachments'), { recursive: true });
    const sqlite = new SqliteLedgerStore(path.join(this.dataDir, 'ensemble.db'));
    this.store = {
      read: filter => sqlite.read(filter), close: () => sqlite.close(),
      append: async events => { const result = await sqlite.append(events); this.changed(); return result; },
      transaction: async (projectId, fn) => { const result = await sqlite.transaction(projectId, fn); if (result.appended.length) this.changed(); return result; },
    };
    this.meta = existsSync(this.metaFile) ? JSON.parse(readFileSync(this.metaFile, 'utf8')) as Metadata : { projectId: randomUUID(), mode: 'free', scene: 1, step: 0 };
    this.ready = this.initialize();
  }
  changed() { for (const listener of this.listeners) listener(); }
  private save() { writeFileSync(`${this.metaFile}.tmp`, JSON.stringify(this.meta)); renameSync(`${this.metaFile}.tmp`, this.metaFile); }
  private context() { return { projectId: this.meta.projectId, targetProductId: 'ensemble-demo' }; }
  private async initialize() {
    if (!(await this.store.read({ projectId: this.meta.projectId })).length) await this.seed('owner', false);
    this.createPm(); this.save();
  }
  private createPm() {
    const runtime = process.env.ENSEMBLE_AGENT_RUNTIME ?? 'fake';
    if (!['fake', 'codex'].includes(runtime)) throw new Error('ENSEMBLE_AGENT_RUNTIME must be fake or codex');
    // Agent results arrive as attachments recorded from the agent's workspace; the PM reads them from the ledger.
    this.pm = new ProjectManager({ ...this.context(), store: this.store, llm: new AnthropicProvider(), model: modelFor('pm'),
      ...(runtime === 'codex' ? codexAgents() : { connector: new FakeConnector() }),
      clock: () => this.meta.mode === 'scenario' ? SCENE_NOW : new Date(),
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
    return buildViewModel(events, { me, mode: this.meta.mode, busy: this.busy, now: this.meta.mode === 'scenario' ? SCENE_NOW : new Date(),
      ...(this.meta.mode === 'scenario' ? { scenario: { name: `${continuousScenario.key} · 장면 ${next?.scene ?? 3}`, done: !stopped && !next,
        ...(stopped ? { nextLine: { authorName: '시나리오 중단', text: stopped, hasAttachment: false } } : next ? { nextLine: { authorName: state.members.get(next.as)?.displayName ?? next.as, text: next.text, hasAttachment: !!next.attachments?.length } } : {}) } } : {}),
    });
  }

  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { await this.ready; this.busy = true; this.changed(); try { return await action(); } finally { this.busy = false; this.changed(); } });
    this.queue = next.catch(() => undefined); return next;
  }
  async startFree(goal: string, deadline: string | undefined, me: string) {
    const previous = project(await this.store.read({ projectId: this.meta.projectId }));
    if (previous.members.get(me)?.kind !== 'human') throw new Error('Unknown human member');
    await this.pm.stop(); this.meta = { projectId: randomUUID(), mode: 'free', scene: 1, step: 0 };
    await this.seed(me, false);
    for (const [memberId, weeklyHours] of previous.availability) if ([me, me === 'owner' ? 'designer' : 'owner'].includes(memberId)) await this.store.append([{ ...this.context(), actor: { kind: 'human', id: memberId }, type: 'availability_updated', payload: { memberId, weeklyHours } }]);
    this.createPm(); this.save();
    logDraftFailure(await this.pm.startFreeProject(goal, deadline));
  }
  async startScenario(name: string) {
    if (name !== continuousScenario.key && name !== 'scene-1-3') throw new Error('Unknown scenario');
    await this.pm.stop(); this.meta = { projectId: randomUUID(), mode: 'scenario', scene: 1, step: 0, script: { step: 0, anchors: {} } };
    await this.seed('owner', true); this.createPm(); this.save();
  }
  async scenarioNext() {
    if (this.meta.mode !== 'scenario') throw new Error('Start a scenario first');
    // Old metadata cannot safely resume the former scene-switching script.
    if (!this.meta.script) throw new Error('Restart the scenario to use the continuous script');
    try {
      await advanceScript({ pm: this.pm,
        generateRevision: input => createRevisionGenerator(new AnthropicProvider(), modelFor('pm'))(input),
        read: () => this.store.read({ projectId: this.meta.projectId }),
        recordStop: async reason => { await this.store.append([{ ...this.context(), actor: { kind: 'system', id: 'scenario' }, type: 'scenario_stopped', payload: { scenario: continuousScenario.key, step: this.meta.script!.step, reason } }]); },
      }, continuousScenario.steps, this.meta.script, continuousScenario.completion);
    } finally {
      this.meta.step = this.meta.script.step;
      this.meta.scene = continuousScenario.steps[this.meta.step]?.scene ?? 3;
      this.save(); this.changed(); await this.persistAttachments();
    }
  }
  async message(authorId: string, text: string, attachments: Upload[] = []) {
    await this.pm.postMessage(authorId, text, attachments.map(a => ({ ...a, content: Buffer.from(a.contentBase64, 'base64').toString('utf8') })));
    await this.persistAttachments();
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
}

const globalRuntime = globalThis as typeof globalThis & { ensembleRuntime?: WebRuntime };
export function getRuntime() { return globalRuntime.ensembleRuntime ??= new WebRuntime(); }
