import { project, forecastFromState, type AnyEvent, type LedgerEvent } from '@ensemble/core';
import type { ViewModel, VmMessage, VmCard } from './view-model';

export function buildViewModel(events: readonly LedgerEvent[], options: { me: string; mode: ViewModel['mode']; busy: boolean; scenario?: ViewModel['scenario']; now?: Date }): ViewModel {
  const state = project(events), typed = events as readonly AnyEvent[];
  const name = (id: string) => state.members.get(id)?.displayName ?? id;
  const forecast = state.plan ? forecastFromState(state, options.now ?? new Date()) : null;
  const attachments = new Map(typed.filter(e => e.type === 'attachment_recorded').map(e => [e.payload.attachmentId, e.payload]));
  const considerations = new Map(typed.filter(e => e.type === 'pm_considered').map(e => [e.payload.considerationId, e.payload]));
  const messages: VmMessage[] = typed.flatMap(e => {
    if (e.type !== 'message_recorded' && e.type !== 'pm_spoke' && e.type !== 'reply_recorded') return [];
    const authorId = e.type === 'message_recorded' ? e.payload.authorId : e.type === 'reply_recorded' ? e.payload.memberId : 'pm';
    const ids = e.type === 'message_recorded' ? e.payload.attachmentIds : e.type === 'reply_recorded' ? e.payload.attachmentIds ?? [] : [];
    const considered = e.type === 'pm_spoke' ? considerations.get(e.payload.considerationId) : undefined;
    return [{ id: e.type === 'reply_recorded' ? e.id : e.payload.messageId, authorId, text: e.payload.text, at: e.at,
      kind: authorId === 'pm' ? 'pm' as const : state.members.get(authorId)?.kind ?? 'system' as const,
      ...(e.type === 'message_recorded' && e.payload.threadId ? { threadId: e.payload.threadId } : {}),
      attachments: ids.flatMap(id => { const a = attachments.get(id); return a ? [{ id, name: a.name, url: `/api/attachments/${encodeURIComponent(id)}` }] : []; }),
      ...(e.type === 'pm_spoke' ? { pm: { kind: e.payload.kind, reason: considered?.reason ?? '', evidence: considered?.evidence ?? [] } } : {}),
    }];
  });
  const cards: VmCard[] = [
    ...[...state.pendingPlans.values()].filter(p => p.forMemberId === options.me).map(p => ({ kind: 'plan_approval' as const, id: p.proposalId, planVersion: p.version, forMemberId: p.forMemberId, reason: p.reason, tasks: p.tasks.map(t => ({ id: t.id, title: t.title, assigneeName: name(t.assignee), dependsOn: t.dependsOn })) })),
    ...[...state.pendingAuthority.values()].filter(p => p.personId === options.me).map(p => ({ kind: 'authority' as const, id: p.requestId, forMemberId: p.personId, text: p.text, changeKinds: p.changeKinds })),
  ];
  return { mode: options.mode, project: { goal: state.goal?.text, deadline: state.goal?.deadline }, me: options.me,
    members: [...[...state.members.values()].map(m => ({ id: m.memberId, kind: m.kind, displayName: m.displayName, role: m.role, weeklyHours: state.availability.get(m.memberId), busy: state.activeTurn.has(m.memberId) })), { id: 'pm', kind: 'pm', displayName: 'PM' }],
    messages, cards, busy: options.busy, ...(options.scenario ? { scenario: options.scenario } : {}),
    roadmap: { planVersion: state.plan?.version ?? null,
      tasks: (state.plan?.tasks ?? []).map(t => { const span = forecast?.ok ? forecast.tasks.find(f => f.taskId === t.id) : undefined; return { id: t.id, title: t.title, assigneeName: name(t.assignee), status: state.tasks.get(t.id)?.status ?? 'waiting', ...(span ? { startDay: span.min.startDay, endDayMin: span.min.endDay, endDayMax: span.max.endDay } : {}) }; }),
      blocked: [...state.tasks.values()].filter(t => t.blocked).map(t => ({ taskId: t.spec.id, reason: t.blocked!.reason, ...(t.blocked!.unblockBy ? { unblockByName: name(t.blocked!.unblockBy!) } : {}) })),
      forecast: !forecast ? null : forecast.ok ? { ok: true, finishMin: forecast.end.min.toISOString(), finishMax: forecast.end.max.toISOString(), deadline: state.goal?.deadline, lateDaysMax: forecast.lateness?.maxDays, shortage: forecast.shortages.map(s => ({ memberName: name(s.memberId), hours: s.hours })) } : { ok: false, reasons: forecast.reasons.map(r => `${r.kind}: ${r.memberId ? name(r.memberId) : r.taskId ?? ''}`) },
      ...(state.plan ? { lastChange: { version: state.plan.version, reason: state.plan.reason } } : {}),
    },
    pmLog: typed.filter(e => e.type === 'pm_considered').map(e => ({ triggerMessageId: e.payload.triggerId, decision: e.payload.decision, reason: e.payload.reason, whoseAction: e.payload.whoseAction, alreadyKnows: e.payload.alreadyKnows, evidence: e.payload.evidence })),
  };
}
