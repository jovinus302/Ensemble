import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { SqliteLedgerStore, type LedgerStore } from '@ensemble/store';
import { AnthropicProvider, loadEnv, modelFor } from '@ensemble/llm';
import { CodexSessionConnector, type SessionConnector, type SessionEvent } from '@ensemble/agents';
import { ProjectManager, type FreeStartResult } from '@ensemble/orchestrator';
import { project, type AnyEvent, type NewLedgerEvent } from '@ensemble/core';
import { scene1, scene2, scene3, sceneEvents, SCENE_NOW } from '@ensemble/scenarios';
import { buildViewModel } from './build-view-model';

interface Metadata { projectId: string; mode: 'free' | 'scenario'; scene: 1 | 2 | 3; step: number }
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
 * Scene 1 drafts a plan; scene 2 uses the published handoff fixture, then continues into scene 3.
 * Verification: API integration, existing domain tests, real-proxy observations and browser captures.
 */
export class WebRuntime {
  readonly dataDir = path.join(appRoot(), 'data');
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
    this.pm = new ProjectManager({ ...this.context(), store: this.store, llm: new AnthropicProvider(), model: modelFor('pm'),
      connector: runtime === 'codex' ? new CodexSessionConnector() : new FakeConnector(),
      clock: () => this.meta.mode === 'scenario' ? SCENE_NOW : new Date(),
      readResult: async result => {
        const state = project(await this.store.read({ projectId: this.meta.projectId }));
        const assignee = state.tasks.get(result.taskId)?.spec.assignee;
        const workspace = assignee ? state.sessions.get(assignee)?.workspace : undefined;
        const out: Record<string, string | null> = {};
        if (runtime !== 'codex' || !workspace) return out;
        const root = await realpath(workspace);
        for (const id of result.artifactIds) {
          try {
            const file = await realpath(path.resolve(root, id));
            const relative = path.relative(root, file);
            if (relative.startsWith('..') || path.isAbsolute(relative)) { out[id] = null; continue; }
            out[id] = await readFile(file, 'utf8');
          } catch { out[id] = null; }
        }
        return out;
      },
    });
  }
  private async seed(decider: string, scenario: boolean) {
    const ctx = this.context();
    if (scenario) {
      const events = sceneEvents(1, ctx).filter(e => !['plan_committed', 'estimate_updated'].includes(e.type));
      for (const e of events) if (e.type === 'member_joined') {
        const p = e.payload as { kind: string; memberId: string; role?: string };
        if (p.kind === 'agent') p.role = p.memberId === 'research-agent' ? '고객 조사와 반응 분석' : '웹 프로토타입 구현';
      }
      events.push({ ...ctx, actor: { kind: 'human', id: decider }, type: 'availability_updated', payload: { memberId: 'owner', weeklyHours: 7 } });
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
    const steps = this.meta.scene === 1 ? scene1 : this.meta.scene === 2 ? scene2 : scene3;
    const next = steps[this.meta.step];
    return buildViewModel(events, { me, mode: this.meta.mode, busy: this.busy, now: this.meta.mode === 'scenario' ? SCENE_NOW : new Date(),
      ...(this.meta.mode === 'scenario' ? { scenario: { name: `scene-1-3 · 장면 ${this.meta.scene}`, done: this.meta.scene === 3 && !next,
        ...(next ? { nextLine: { authorName: state.members.get(next.as)?.displayName ?? next.as, text: next.text, hasAttachment: !!next.attachments?.length } } : this.meta.scene < 3 ? { nextLine: { authorName: '시나리오', text: `장면 ${this.meta.scene + 1}로 이동`, hasAttachment: false } } : {}) } } : {}),
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
    if (name !== 'scene-1-3') throw new Error('Unknown scenario');
    await this.pm.stop(); this.meta = { projectId: randomUUID(), mode: 'scenario', scene: 1, step: 0 };
    await this.seed('owner', true); this.createPm(); this.save();
  }
  async scenarioNext() {
    if (this.meta.mode !== 'scenario') throw new Error('Start a scenario first');
    const steps = this.meta.scene === 1 ? scene1 : this.meta.scene === 2 ? scene2 : scene3;
    const step = steps[this.meta.step];
    if (!step) {
      if (this.meta.scene === 3) return;
      const state = project(await this.store.read({ projectId: this.meta.projectId }));
      if (state.pendingPlans.size) throw new Error('Approve or reject the pending plan before continuing');
      if (this.meta.scene === 1) {
        // Published handoff fixture is independent of the model-generated scene 1 plan.
        await this.pm.stop(); this.meta.projectId = randomUUID();
        await this.store.append(sceneEvents(2, this.context())); this.createPm();
      }
      this.meta.scene = this.meta.scene === 1 ? 2 : 3; this.meta.step = 0; this.save(); return;
    }
    if (this.meta.scene === 1) {
      logDraftFailure(await this.pm.startFreeProject(step.text, '2026-10-12T00:00:00Z'));
    } else {
      await this.pm.postMessage(step.as, step.text, step.attachments?.map(a => ({ ...a, taskId: 'design' })));
    }
    this.meta.step++; this.save(); await this.persistAttachments();
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
