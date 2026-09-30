import { project, forecast, forecastFromState, availabilityWeek, type AnyEvent, type EventPayloads, type LedgerEvent, type ProjectState, type TaskStatus } from '@ensemble/core';
import type { ViewModel, VmActivity, VmMessage, VmCard, VmPmJudgement, VmPlanTask } from './view-model';
import { taskResolutions } from './task-resolution';

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DEMO_PREFIX = /^\s*시연용 가상 자료(?:입니다)?[.。]?\s*/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (text: string, max: number) => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** 긴 목표에서 상단에 쓸 짧은 제목을 만든다. "시연용 가상 자료" 머리말은 배지로 뺀다. 서버가 제목을 따로 주면 그 값이 우선한다. */
export function projectTitle(goal: string | undefined): { title?: string; synthetic?: boolean } {
  if (!goal) return {};
  const synthetic = DEMO_PREFIX.test(goal);
  const body = goal.replace(DEMO_PREFIX, '').trim();
  const sentence = (/^(.+?)[.!?。](?:\s|$)/.exec(body)?.[1] ?? body).trim();
  let title = sentence;
  if (title.length > 40) { const cut = title.slice(0, 40); const space = cut.lastIndexOf(' '); title = `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`; }
  return { title, ...(synthetic ? { synthetic } : {}) };
}

// orchestrator가 남기는 영어·코드 값을 사람이 읽는 말로. 없는 값은 그대로 둔다.
const REASONS: Record<string, string> = {
  'A person must decide the next action': '사람이 다음 행동을 정해야 해요',
  'Person approved the recorded operation': '사람이 기록된 변경을 승인했어요',
};
const KNOWS: Record<string, string> = { yes: '이미 알고 있음', no: '아직 모름', unknown: '확인하지 못함' };
const FORECAST_FACTS: Record<string, string> = {
  'forecast:current': '현재 계획의 예측', 'forecast:candidate': '변경안을 적용한 예측', 'forecast:before_availability': '가용 시간 변경 전 예측',
};
const EVENT_LABEL: Partial<Record<AnyEvent['type'], string>> = {
  availability_updated: '가용 시간 변경', plan_committed: '계획 확정', plan_proposed: '계획 제안', plan_decided: '계획 승인 결정',
  result_submitted: '결과 제출', task_checked: '인계 조건 확인', revision_requested: '보완 요청', handoff_reviewed: '인계 판단',
  task_start_reserved: '작업 시작', task_started: '작업 시작', task_blocked: '작업 막힘', decision_recorded: '결정', estimate_updated: '추정 시간 변경',
  message_recorded: '메시지', reply_recorded: 'Agent 메시지', attachment_recorded: '첨부', goal_set: '목표',
};
const FORECAST_REASON: Record<string, string> = {
  missing_estimate: '추정 시간이 없어요', missing_availability: '주간 가용 시간이 입력되지 않았어요', zero_availability: '주간 가용 시간이 0이에요',
  cycle: '작업 순서가 서로 물려 있어요', unknown_dependency: '알 수 없는 선행 작업이 있어요',
};
// Agent 결과 요약의 "할 일" 문장 중 상태가 바뀌면 낡는 것들(orchestrator summarizeForHuman).
const STALE_TODO: { text: string; status: TaskStatus }[] = [
  { text: 'PM이 인계 조건을 확인하는 중입니다.', status: 'submitted' },
  { text: 'PM이 보완을 요청했습니다. 보완본이 오면 다시 알려드립니다.', status: 'revising' },
];
const CURRENT_TODO: Partial<Record<TaskStatus, string>> = {
  checked: 'PM이 인계 조건을 확인했습니다.',
  revising: 'PM이 보완을 요청했습니다. 보완본이 오면 다시 알려드립니다.',
  submitted: 'PM이 인계 조건을 확인하는 중입니다.',
  cancelled: '이 작업은 계획에서 빠졌습니다.',
};

/** "[research 제목]"·'@사용자 interview "제목"'처럼 문장에 섞인 내부 작업 키를 뗀다. */
export function stripTaskKeys(text: string, taskIds: readonly string[]): string {
  let out = text;
  for (const id of taskIds) {
    const key = escape(id);
    out = out.replace(new RegExp(`\\[${key} (?=[^\\]]+\\])`, 'g'), '[').replace(new RegExp(`(@\\S+ )${key} (?=")`, 'g'), '$1');
  }
  return out;
}

/** Agent 요약의 "할 일" 줄을 작업의 현재 상태에 맞춘다. 가장 최근 요약만 현재 상태를 말하고, 이전 요약에서는 낡은 문장을 뺀다. */
export function refreshTodo(text: string, status: TaskStatus | undefined, latest: boolean): string {
  return text.split('\n').map(line => {
    const m = /^할 일: (.*)$/.exec(line);
    if (!m) return line;
    let rest = m[1]!;
    let changed = false;
    for (const stale of STALE_TODO) {
      if (!rest.includes(stale.text) || (latest && status === stale.status)) continue;
      rest = rest.replace(stale.text, '').trim(); changed = true;
    }
    if (!changed) return line;
    const current = latest && status ? CURRENT_TODO[status] : undefined;
    if (current && !rest.includes(current)) rest = `${current} ${rest}`.trim();
    if (rest === '없음' || !rest) return latest ? '할 일: 없음' : null;
    return `할 일: ${rest.replace(/^없음\s*/, '')}`;
  }).filter((line): line is string => line !== null).join('\n');
}

function labeler(typed: readonly AnyEvent[], state: ProjectState, name: (id: string) => string) {
  const messages = new Map<string, { authorId: string; text: string }>();
  const proposals = new Map<string, EventPayloads['plan_proposed']>();
  const results = new Map<string, string>();
  const attachments = new Map<string, EventPayloads['attachment_recorded']>();
  const events = new Map<string, AnyEvent['type']>();
  // 근거가 메시지 id 대신 기록(event) id를 가리키는 경우도 같은 메시지로 읽는다.
  const messageEvents = new Map<string, { authorId: string; text: string }>();
  for (const e of typed) {
    events.set(e.id, e.type);
    if (e.type === 'message_recorded') { messages.set(e.payload.messageId, { authorId: e.payload.authorId, text: e.payload.text }); messageEvents.set(e.id, messages.get(e.payload.messageId)!); }
    else if (e.type === 'pm_spoke') { messages.set(e.payload.messageId, { authorId: 'pm', text: e.payload.text }); messageEvents.set(e.id, messages.get(e.payload.messageId)!); }
    else if (e.type === 'reply_recorded') messages.set(e.id, { authorId: e.payload.memberId, text: e.payload.text });
    else if (e.type === 'plan_proposed') proposals.set(e.payload.proposalId, e.payload);
    else if (e.type === 'result_submitted') results.set(e.payload.resultId, e.payload.taskId);
    else if (e.type === 'attachment_recorded') attachments.set(e.payload.attachmentId, e.payload);
  }
  const taskTitle = (id: string) => state.tasks.get(id)?.spec.title ?? [...proposals.values()].flatMap(p => p.tasks).find(t => t.id === id)?.title ?? id;
  const quote = (m: { authorId: string; text: string }) => `${name(m.authorId)}: "${clip(m.text, 28)}"`;
  const version = (proposalId: string) => proposals.get(proposalId)?.version;
  const label = (raw: string): string => {
    const colon = raw.indexOf(':'), prefix = colon > 0 ? raw.slice(0, colon) : '', rest = colon > 0 ? raw.slice(colon + 1) : raw;
    if (FORECAST_FACTS[raw]) return FORECAST_FACTS[raw]!;
    if (prefix === 'forecast') return '예측';
    if (prefix === 'msg') { const m = messages.get(rest); return m ? `메시지 · ${quote(m)}` : '메시지'; }
    if (prefix === 'availability') { const h = state.availability.get(rest); return `${name(rest)} 주간 가용 시간${h === undefined ? '' : ` ${h}시간`}`; }
    if (prefix === 'start') { const v = version(rest.split(':')[0]!); return v ? `계획 v${v} 승인 후 작업 시작 안내` : '작업 시작 안내'; }
    if (prefix === 'reject') { const v = version(rest); return v ? `계획 v${v} 거절` : '계획 거절'; }
    if (prefix === 'plan-failed') return '계획 초안 작성 실패';
    if (prefix === 'turn-blocked') return 'Agent 작업 멈춤';
    if (prefix === 'question') return 'Agent 질문';
    const id = results.has(raw) || attachments.has(raw) ? raw : prefix === 'result' || prefix === 'attachment' ? rest : raw;
    const attachment = attachments.get(id);
    if (attachment) return `${attachment.name}${attachment.taskId ? ` · ${taskTitle(attachment.taskId)}` : ''}`;
    const m = messages.get(id) ?? messageEvents.get(id);
    if (m) return `메시지 · ${quote(m)}`;
    if (proposals.has(id)) return `계획 v${version(id)} 제안`;
    if (results.has(id)) return `${taskTitle(results.get(id)!)} 결과`;
    const type = events.get(id);
    if (type) return `작업 기록 · ${EVENT_LABEL[type] ?? '기타'}`;
    if (UUID.test(raw) && raw.replace(UUID, '').replace(/[:\s]/g, '').length <= 8) return '작업 기록';
    return raw;
  };
  const humanize = (text: string) => {
    const ids = [...results.keys()].flatMap(id => [`result:${id}`, id]).concat([...attachments.keys()].flatMap(id => [`attachment:${id}`, id]));
    if (!ids.length) return text;
    return text.replace(new RegExp(ids.sort((a, b) => b.length - a.length).map(escape).join('|'), 'g'), label);
  };
  return { label, humanize, isMessage: (id: string) => messages.has(id), version, taskTitle };
}

/** "designer: 결과 보완", "prototype-agent, designer" 같은 값의 멤버 id를 이름으로. */
function whoLabel(value: string, state: ProjectState): string {
  const ids = [...state.members.keys(), 'pm'].sort((a, b) => b.length - a.length);
  let out = value;
  for (const id of ids) out = out.replace(new RegExp(`(^|[\\s,(])${escape(id)}(?=$|[\\s,:)])`, 'g'), `$1${id === 'pm' ? 'PM' : state.members.get(id)?.displayName ?? id}`);
  return out;
}

export function buildViewModel(events: readonly LedgerEvent[], options: { me: string; mode: ViewModel['mode']; busy: boolean; scenario?: ViewModel['scenario']; now?: Date; activity?: VmActivity }): ViewModel {
  const state = project(events), typed = events as readonly AnyEvent[];
  const now = options.now ?? new Date();
  const name = (id: string) => id === 'pm' ? 'PM' : state.members.get(id)?.displayName ?? id;
  const forecastNow = state.plan ? forecastFromState(state, now) : null;
  const uncertainty = forecastNow?.uncertainty;
  const { label, humanize, isMessage, version, taskTitle } = labeler(typed, state, name);
  const taskIds = [...new Set([...state.tasks.keys(), ...typed.flatMap(e => e.type === 'plan_proposed' ? e.payload.tasks.map(t => t.id) : [])])];
  const dayIso = (day: number) => new Date(now.getTime() + day * DAY_MS).toISOString();
  const attachments = new Map(typed.filter(e => e.type === 'attachment_recorded').map(e => [e.payload.attachmentId, e.payload]));
  const considerations = new Map(typed.filter(e => e.type === 'pm_considered').map(e => [e.payload.considerationId, e.payload]));
  // 작업마다 가장 최근의 Agent 결과 요약만 현재 상태를 말한다.
  const latestSummary = new Map<string, string>();
  for (const e of typed) if (e.type === 'reply_recorded' && e.payload.taskId && /^할 일: /m.test(e.payload.text)) latestSummary.set(e.payload.taskId, e.id);

  // 계획 제안 안내 발언(considerationId = proposalId)은 그 카드와 같은 내용이다.
  const proposalIds = new Set(typed.flatMap(e => e.type === 'plan_proposed' ? [e.payload.proposalId] : []));
  const week = availabilityWeek(now);
  const messages: VmMessage[] = typed.flatMap((e): VmMessage[] => {
    if (e.type === 'plan_decided') {
      const v = version(e.payload.proposalId);
      if (v === undefined) return [];
      const byName = name(e.payload.memberId);
      return [{ id: e.id, authorId: 'system', kind: 'system', at: e.at, attachments: [], text: `계획 v${v} ${e.payload.approved ? '승인' : '거절'} — ${byName}`,
        record: { kind: 'plan_decision', planVersion: v, approved: e.payload.approved, byName } }];
    }
    if (e.type !== 'message_recorded' && e.type !== 'pm_spoke' && e.type !== 'reply_recorded') return [];
    const authorId = e.type === 'message_recorded' ? e.payload.authorId : e.type === 'reply_recorded' ? e.payload.memberId : 'pm';
    const ids = e.type === 'message_recorded' ? e.payload.attachmentIds : e.type === 'reply_recorded' ? e.payload.attachmentIds ?? [] : [];
    const considered = e.type === 'pm_spoke' ? considerations.get(e.payload.considerationId) : undefined;
    let text = e.payload.text;
    if (e.type === 'reply_recorded') text = text.replace(/^Agent question \([^)]*\):\s*/, '질문: ').replace(/\sOptions:\s*/g, '\n선택지: ');
    if (e.type !== 'message_recorded') text = stripTaskKeys(text, taskIds);
    if (e.type === 'reply_recorded' && e.payload.taskId) text = refreshTodo(text, state.tasks.get(e.payload.taskId)?.status, latestSummary.get(e.payload.taskId) === e.id);
    const cardId = e.type === 'pm_spoke' && proposalIds.has(e.payload.considerationId) ? e.payload.considerationId : undefined;
    return [{ id: e.type === 'reply_recorded' ? e.id : e.payload.messageId, authorId, text, at: e.at, ...(cardId ? { cardId } : {}),
      kind: authorId === 'pm' ? 'pm' as const : state.members.get(authorId)?.kind ?? 'system' as const,
      ...(e.type === 'message_recorded' && e.payload.threadId ? { threadId: e.payload.threadId } : {}),
      attachments: ids.flatMap(id => { const a = attachments.get(id); return a ? [{ id, name: a.name, url: `/api/attachments/${encodeURIComponent(id)}` }] : []; }),
      ...(e.type === 'pm_spoke' ? { pm: { kind: e.payload.kind === 'ask' && /^(?:start:|handoff-notice:|turn-blocked:)/.test(e.payload.considerationId) ? 'nudge' : e.payload.kind, reason: REASONS[considered?.reason ?? ''] ?? considered?.reason ?? '', evidence: [...new Set((considered?.evidence ?? []).map(label))] } } : {}),
    }];
  });

  const cards: VmCard[] = [
    ...[...state.pendingPlans.values()].filter(p => p.forMemberId === options.me).map(p => {
      const hours = new Map(p.estimates.map(x => [x.taskId, x.hours]));
      let spans: Map<string, { min: string; max: string }> | undefined, finish: { min: string; max: string } | undefined;
      try {
        const result = forecast({ now, deadline: state.goal?.deadline ? new Date(state.goal.deadline) : undefined, weeklyHours: state.availability,
          tasks: p.tasks.map(t => ({ id: t.id, assignee: t.assignee, assigneeKind: state.members.get(t.assignee)?.kind ?? 'human', dependsOn: [...t.dependsOn], done: state.tasks.get(t.id)?.status === 'checked', hours: hours.get(t.id) })) });
        if (result.ok) {
          spans = new Map(result.tasks.map(f => [f.taskId, { min: dayIso(f.min.endDay), max: dayIso(f.max.endDay) }]));
          finish = { min: result.end.min.toISOString(), max: result.end.max.toISOString() };
        }
      } catch { /* 예측할 수 없는 초안이면 날짜 없이 보여 준다. */ }
      const tasks: VmPlanTask[] = p.tasks.map(t => { const h = hours.get(t.id), end = spans?.get(t.id); return { id: t.id, title: t.title, assigneeName: name(t.assignee), dependsOn: t.dependsOn,
        exclusions: [...(t.exclusions ?? [])], limits: [...(t.limits ?? [])],
        ...(h ? { hours: h } : {}), ...(end ? { expectedEnd: end } : {}), ...(t.handoffConditions.length ? { handoffConditions: t.handoffConditions } : {}) }; });
      return { kind: 'plan_approval' as const, id: p.proposalId, planVersion: p.version, forMemberId: p.forMemberId, reason: p.reason, tasks, ...(finish ? { finish } : {}) };
    }),
    ...[...state.pendingAuthority.values()].filter(p => p.personId === options.me).map(p => ({ kind: 'authority' as const, id: p.requestId, forMemberId: p.personId, text: p.text, changeKinds: p.changeKinds })),
  ];

  const spoken = new Map(typed.flatMap(e => e.type === 'pm_spoke' ? [[e.payload.considerationId, e.payload.text] as const] : []));
  const seen = new Set<string>();
  const pmLog: VmPmJudgement[] = typed.flatMap(e => {
    if (e.type !== 'pm_considered') return [];
    const p = e.payload, spokenText = spoken.get(p.considerationId), reason = humanize(REASONS[p.reason] ?? p.reason);
    // 같은 계기에 같은 판단·같은 말이 두 번 기록되면 한 번만 보인다.
    const key = JSON.stringify([p.triggerId, p.decision, reason, spokenText ?? '']);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ triggerMessageId: p.triggerId, decision: p.decision, reason, whoseAction: p.whoseAction === null ? null : whoLabel(p.whoseAction, state),
      alreadyKnows: KNOWS[p.alreadyKnows] ?? p.alreadyKnows, evidence: [...new Set(p.evidence.map(e => label(humanize(e))))], at: e.at,
      ...(isMessage(p.triggerId) ? {} : { triggerLabel: label(p.triggerId) }), ...(spokenText ? { spokenText: humanize(stripTaskKeys(spokenText, taskIds)) } : {}) }];
  });

  const forecastView = !forecastNow ? null : forecastNow.ok
    ? { ok: true as const, finishMin: forecastNow.end.min.toISOString(), finishMax: forecastNow.end.max.toISOString(), deadline: state.goal?.deadline, lateDaysMax: forecastNow.lateness?.maxDays, shortage: forecastNow.shortages.map(s => ({ memberName: name(s.memberId), hours: s.hours })) }
    : { ok: false as const, reasons: [...new Set(forecastNow.reasons.map(r => { const subject = r.memberId ? name(r.memberId) : r.taskId ? taskTitle(r.taskId) : ''; const why = FORECAST_REASON[r.kind] ?? r.kind; return subject ? `${subject}: ${why}` : why; }))] };

  const thisWeek = (id: string) => { const h = state.availabilityOverrides?.get(id)?.get(week); return h === undefined ? {} : { weeklyHoursThisWeek: h }; };
  return { mode: options.mode, project: { goal: state.goal?.text, deadline: state.goal?.deadline, ...projectTitle(state.goal?.text) }, me: options.me,
    members: [...[...state.members.values()].map(m => ({ id: m.memberId, kind: m.kind, displayName: m.displayName, role: m.role, weeklyHours: state.availability.get(m.memberId), ...thisWeek(m.memberId), busy: state.activeTurn.has(m.memberId) })), { id: 'pm', kind: 'pm', displayName: 'PM' }],
    messages, cards, busy: options.busy, ...(options.scenario ? { scenario: options.scenario } : {}), ...(options.activity ? { activity: options.activity } : {}),
    roadmap: { planVersion: state.plan?.version ?? null, ...(options.mode === 'scenario' ? { clockLabel: '시연 시계' } : {}),
      tasks: (state.plan?.tasks ?? []).map(t => { const span = forecastNow?.ok ? forecastNow.tasks.find(f => f.taskId === t.id) : undefined; const h = state.estimates.get(t.id);
        return { id: t.id, title: t.title, assigneeName: name(t.assignee), status: state.tasks.get(t.id)?.status ?? 'waiting',
          exclusions: [...(t.exclusions ?? [])], limits: [...(t.limits ?? [])],
          resolution: taskResolutions(events, options.me).find(r => r.taskId === t.id),
          ...(uncertainty?.stoppedTaskIds.includes(t.id) ? { stopped: true } : {}),
          ...(span ? { startDay: span.min.startDay, endDayMin: span.min.endDay, endDayMax: span.max.endDay } : {}),
          ...(h ? { hours: { min: h.min, max: h.max } } : {}), ...(t.handoffConditions.length ? { handoffConditions: t.handoffConditions } : {}) }; }),
      blocked: [...state.tasks.values()].filter(t => t.blocked).map(t => ({ taskId: t.spec.id, reason: t.blocked!.reason, ...(t.blocked!.unblockBy ? { unblockByName: name(t.blocked!.unblockBy!) } : {}) })),
      forecast: forecastView ? { ...forecastView, ...(uncertainty ? { uncertainty } : {}) } : null,
      ...(forecastNow?.ok ? { origin: now.toISOString() } : {}),
      ...(state.plan ? { lastChange: { version: state.plan.version, reason: state.plan.reason } } : {}),
    },
    pmLog,
  };
}
