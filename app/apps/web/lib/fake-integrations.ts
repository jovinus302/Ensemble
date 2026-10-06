// Simulated member pool and production tools (Pages v2.5, docs/pages-v25-runtime-demo.md §4). No external service:
// invited pool candidates join after a short delay, and handed-off tools report progress until the dev tool merges a
// build. Everything is a ledger event (actor system:pool / system:tools); the PM is woken for joins and builds.
import { project, type AnyEvent, type EventContext, type LedgerEvent, type NewLedgerEvent, type WorkContextTrigger } from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';

export interface SimulatedIntegrationsOptions {
  store: LedgerStore;
  context: () => EventContext;
  /** One step of a simulated tool or a pool join. */
  delayMs: number;
  /** Wakes the PM (queued behind its other work). */
  consider: (trigger: WorkContextTrigger) => Promise<unknown>;
}

export class SimulatedIntegrations {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private rounds = new Set<string>();
  private stopped = false;
  /** Settles when every scheduled step has run (tests wait on it). */
  private work: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: SimulatedIntegrationsOptions) {}

  /** Reacts to the events one PM turn appended. */
  observe(events: readonly LedgerEvent[]) {
    for (const event of events as readonly AnyEvent[]) {
      if (event.type === 'pool_member_invited') this.later(() => this.join(event.projectId, event.payload.candidateId, event.payload.memberId));
      if (event.type === 'tool_handoff_sent') {
        const key = `${event.projectId}:${event.payload.round}`;
        if (!this.rounds.has(key)) { this.rounds.add(key); this.round(event.projectId, event.payload.round); }
      }
    }
  }
  idle(): Promise<unknown> { return this.work; }
  stop() { this.stopped = true; for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  private later(step: () => Promise<void>, steps = 1): Promise<void> {
    const run = new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.timers.delete(timer); if (this.stopped) return resolve(); step().catch(error => console.error('[ensemble] 시뮬레이션 단계 실패', error)).finally(resolve); }, this.options.delayMs * steps);
      this.timers.add(timer);
    });
    this.work = Promise.all([this.work, run]);
    return run;
  }
  private async append(projectId: string, events: NewLedgerEvent[]) {
    if (projectId !== this.options.context().projectId || this.stopped) return false;
    await this.options.store.append(events);
    return true;
  }
  private async join(projectId: string, candidateId: string, memberId: string) {
    const state = project(await this.options.store.read({ projectId }));
    const c = state.workContext?.pool.candidates.get(candidateId);
    if (!c || state.members.has(memberId)) return;
    const event: NewLedgerEvent = { ...this.options.context(), actor: { kind: 'system', id: 'pool' }, type: 'member_joined', idempotencyKey: `pool-join:${candidateId}`,
      payload: { memberId, kind: 'human', displayName: c.displayName, role: c.role, source: 'pool', candidateId } };
    if (await this.append(projectId, [event])) await this.options.consider({ kind: 'event', eventType: 'member_joined', refId: memberId });
  }
  /** Other tools: 제작 중 → 제작 완료; then the dev tool: 통합 빌드 중 → 빌드 완료 + the build preview. */
  private round(projectId: string, round: number) {
    const tools = { kind: 'system' as const, id: 'tools' };
    const progress = (handoffId: string, status: 'in_progress' | 'done', note?: string): NewLedgerEvent =>
      ({ ...this.options.context(), actor: tools, type: 'tool_progress_reported', idempotencyKey: `tool:${handoffId}:${status}`, payload: { handoffId, status, ...(note ? { note } : {}) } });
    const handoffs = async () => {
      const wc = project(await this.options.store.read({ projectId })).workContext;
      const list = [...(wc?.handoffs.values() ?? [])].filter(h => h.handoff.round === round);
      return { wc, others: list.filter(h => h.handoff.toolId !== 'dev-tools'), dev: list.find(h => h.handoff.toolId === 'dev-tools') };
    };
    void this.later(async () => {
      const { others } = await handoffs();
      await this.append(projectId, others.map(h => progress(h.handoff.handoffId, 'in_progress')));
    }, 1);
    void this.later(async () => {
      const { others, dev } = await handoffs();
      const into = dev ? ' → 개발 도구' : '';
      await this.append(projectId, [...others.map(h => progress(h.handoff.handoffId, 'done', `${h.handoff.title}${into}`)), ...(dev ? [progress(dev.handoff.handoffId, 'in_progress', '통합 빌드 중')] : [])]);
    }, 2);
    void this.later(async () => {
      const { wc, dev } = await handoffs();
      if (!wc || !dev) return;
      const version = wc.version, buildId = `build-v${version}`, previewId = `preview-build-v${version}`;
      const design = [...wc.previews.values()].filter(p => !p.withdrawn && p.preview.source === 'design').sort((a, b) => b.seq - a.seq)[0];
      if (!design || wc.builds.has(buildId)) return;
      const ids = [...wc.handoffs.values()].filter(h => h.handoff.round === round).map(h => h.handoff.handoffId);
      const ok = await this.append(projectId, [
        progress(dev.handoff.handoffId, 'done', `통합 빌드 v${version}`),
        { ...this.options.context(), actor: tools, type: 'preview_rendered', idempotencyKey: `build-preview:${buildId}`, payload: { previewId, source: 'build', label: `v${version} 빌드`, refId: buildId, spec: design.preview.spec } },
        { ...this.options.context(), actor: tools, type: 'build_produced', idempotencyKey: `build:${buildId}`, payload: { buildId, version, handoffIds: ids, previewId } },
      ]);
      if (ok) await this.options.consider({ kind: 'event', eventType: 'build_produced', refId: buildId });
    }, 3);
  }
}
