import { project, forecast, forecastFromState, availabilityWeek, bundleDecisions, isParentTask, openDecisions, taskActivity, waitingOn, workStatus,
  type AnyEvent, type DecisionEffect, type EventPayloads, type LedgerEvent, type PlanOp, type Priority, type ProjectState, type RoutingReason, type TaskActivity, type TaskState, type TaskStatus } from '@ensemble/core';
import type { ViewModel, VmActivity, VmActivityItem, VmMessage, VmCard, VmDecisionCard, VmPmJudgement, VmPlanTask, VmTaskDetail, VmWork, VmWorkItem, VmWorkStatus, VmWorkTeamRow } from './view-model';
import { taskResolutions } from './task-resolution';
import { buildWorkContext } from './build-work-context';

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

/**
 * 기계가 남긴 문장의 마지막 방어선: 직렬화된 JSON 덩어리(`{"key": …}`)와 UUID 같은 내부 값은 사람에게 보이지 않는다.
 * 지운 뒤 남는 빈 괄호·구두점은 정리하고, 아무것도 남지 않으면 빈 문자열을 돌려준다(호출하는 쪽이 대신할 말을 정한다).
 */
export function sanitizeMachineText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    // `{` 다음에 `"키":`가 오면 짝이 맞는 `}`까지 JSON 덩어리로 보고 뺀다(문자열 안의 괄호는 세지 않는다).
    if (text[i] === '{' && /^\{\s*"[^"]*"\s*:/.test(text.slice(i))) {
      let depth = 0, inString = false, j = i;
      for (; j < text.length; j++) {
        const c = text[j];
        if (inString) { if (c === '\\') j++; else if (c === '"') inString = false; continue; }
        if (c === '"') inString = true;
        else if (c === '{' || c === '[') depth++;
        else if ((c === '}' || c === ']') && --depth === 0) break;
      }
      i = j;
      continue;
    }
    out += text[i];
  }
  const stripped = out.replace(new RegExp(UUID.source, 'gi'), '');
  if (stripped === text) return text; // 뺀 것이 없으면 원문 그대로(줄바꿈·구두점을 건드리지 않는다)
  return stripped
    .replace(/\[\s*(?:,\s*)*\]|\(\s*\)/g, '')
    .split('\n').map(line => line.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.:;)])/g, '$1').replace(/[:,]\s*$/, '').trimEnd()).join('\n').trim();
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
    if (prefix === 'task' && state.tasks.has(rest)) return taskTitle(rest);
    if (prefix === 'msg') { const m = messages.get(rest); return m ? `메시지 · ${quote(m)}` : '메시지'; }
    if (prefix === 'availability') { const h = state.availability.get(rest); return `${name(rest)} 주간 가용 시간${h === undefined ? '' : ` ${h}시간`}`; }
    if (prefix === 'start') { const v = version(rest.split(':')[0]!); return v ? `계획 v${v} 승인 후 작업 시작 안내` : '작업 시작 안내'; }
    if (prefix === 'reject') { const v = version(rest); return v ? `계획 v${v} 거절` : '계획 거절'; }
    if (prefix === 'plan-failed') return '계획 초안 작성 실패';
    if (prefix === 'turn-blocked') return 'Agent 작업 멈춤';
    if (prefix === 'question') {
      // question:<taskId>:<n> — 누가 어느 작업에서 물었는지로 읽는다.
      const taskId = rest.slice(0, rest.lastIndexOf(':')), task = state.tasks.get(taskId);
      return task ? `${name(task.spec.assignee)}의 질문 · ${taskTitle(taskId)}` : 'Agent 질문';
    }
    const id = results.has(raw) || attachments.has(raw) ? raw : prefix === 'result' || prefix === 'attachment' ? rest : raw;
    const attachment = attachments.get(id);
    if (attachment) return `${attachment.name}${attachment.taskId ? ` · ${taskTitle(attachment.taskId)}` : ''}`;
    const m = messages.get(id) ?? messageEvents.get(id);
    if (m) return `메시지 · ${quote(m)}`;
    if (proposals.has(id)) return `계획 v${version(id)} 제안`;
    if (results.has(id)) return `${taskTitle(results.get(id)!)} 결과`;
    const type = events.get(id);
    if (type) return `작업 기록 · ${EVENT_LABEL[type] ?? '기타'}`;
    if (UUID.test(raw) && raw.replace(UUID, '').replace(/[:\s]/g, '').length === 0) return '작업 기록';
    return raw;
  };
  const humanize = (text: string) => {
    const operations: Record<string, string> = { exclude_scope: '범위 제외', limit_scope: '범위 한정', reopen_task: '작업 다시 열기', set_availability: '가용 시간 변경', handoff_early: '초안 인계', resolve_task: '작업 해결' };
    const ids = [...results.keys()].flatMap(id => [`result:${id}`, id]).concat([...attachments.keys()].flatMap(id => [`attachment:${id}`, id]), [...state.tasks.keys()].map(id => `task:${id}`), [...state.members.keys()], Object.keys(operations));
    if (!ids.length) return text;
    return text.replace(new RegExp(`(?<![A-Za-z0-9_-])(?:${ids.sort((a, b) => b.length - a.length).map(escape).join('|')})(?![A-Za-z0-9_-])`, 'g'), id => operations[id] ?? (state.members.has(id) ? name(id) : label(id)));
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

/** 작업 id와 계획 제안·결정 요청 안의 새 작업 id: 화면 문구에서 떼어 낼 내부 값. */
function knownTaskIds(typed: readonly AnyEvent[], state: ProjectState): string[] {
  return [...new Set([...state.tasks.keys(), ...typed.flatMap(e => e.type === 'plan_proposed' ? e.payload.tasks.map(t => t.id) : []),
    ...[...state.decisionRequests.values()].flatMap(r => r.request.options.flatMap(o => o.effects.flatMap(draftIds)))])];
}
const isTaskThread = (threadId: string | undefined) => !!threadId?.startsWith('task:');

/** 채널·작업 댓글에 보이는 모든 발언(작업 스레드 포함). 채널은 스레드 발언을 빼고, 작업 상세는 그 작업의 스레드만 고른다. */
function buildMessages(typed: readonly AnyEvent[], state: ProjectState, name: (id: string) => string, labels: ReturnType<typeof labeler>, taskIds: readonly string[]): VmMessage[] {
  const { version } = labels;
  const { visible, evidence, plainIds } = readers(typed, state, labels, taskIds);
  const attachments = new Map(typed.filter(e => e.type === 'attachment_recorded').map(e => [e.payload.attachmentId, e.payload]));
  const considerations = new Map(typed.filter(e => e.type === 'pm_considered').map(e => [e.payload.considerationId, e.payload]));
  // 작업마다 가장 최근의 Agent 결과 요약만 현재 상태를 말한다.
  const latestSummary = new Map<string, string>();
  for (const e of typed) if (e.type === 'reply_recorded' && e.payload.taskId && /^할 일: /m.test(e.payload.text)) latestSummary.set(e.payload.taskId, e.id);

  // 계획 제안 안내 발언(considerationId = proposalId)은 그 카드와 같은 내용이다.
  const proposalIds = new Set(typed.flatMap(e => e.type === 'plan_proposed' ? [e.payload.proposalId] : []));
  return typed.flatMap((e): VmMessage[] => {
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
    if (e.type !== 'message_recorded') text = sanitizeMachineText(plainIds(stripTaskKeys(text, taskIds))) || (e.type === 'pm_spoke' ? 'PM이 기록을 남겼어요' : '결과를 남겼어요');
    if (e.type === 'reply_recorded' && e.payload.taskId) text = refreshTodo(text, state.tasks.get(e.payload.taskId)?.status, latestSummary.get(e.payload.taskId) === e.id);
    // 결정 요청을 안내하는 발언은 그 카드 자리다(카드가 보이는 사람에게는 카드로 그려진다).
    const cardId = e.type === 'pm_spoke' ? e.payload.requestId ?? (proposalIds.has(e.payload.considerationId) ? e.payload.considerationId : undefined) : undefined;
    const threadId = e.type === 'message_recorded' || e.type === 'pm_spoke' ? e.payload.threadId : undefined;
    const mentioned = e.type === 'pm_spoke' ? (e.payload.taskIds ?? []).filter(id => state.tasks.has(id)) : [];
    return [{ id: e.type === 'reply_recorded' ? e.id : e.payload.messageId, authorId, text, at: e.at, ...(cardId ? { cardId } : {}),
      kind: authorId === 'pm' ? 'pm' as const : state.members.get(authorId)?.kind ?? 'system' as const,
      ...(threadId ? { threadId } : {}), ...(mentioned.length ? { taskIds: mentioned } : {}),
      attachments: ids.flatMap(id => { const a = attachments.get(id); return a ? [{ id, name: a.name, url: `/api/attachments/${encodeURIComponent(id)}` }] : []; }),
      ...(e.type === 'pm_spoke' ? { pm: { kind: e.payload.kind === 'ask' && /^(?:start:|handoff-notice:|turn-blocked:)/.test(e.payload.considerationId) ? 'nudge' : e.payload.kind, reason: visible(REASONS[considered?.reason ?? ''] ?? considered?.reason ?? ''), evidence: [...new Set((considered?.evidence ?? []).flatMap(evidence))] } } : {}),
    }];
  });
}

export function buildViewModel(events: readonly LedgerEvent[], options: { me: string; mode: ViewModel['mode']; busy: boolean; scenario?: ViewModel['scenario']; now?: Date; activity?: VmActivity }): ViewModel {
  const state = project(events), typed = events as readonly AnyEvent[];
  const now = options.now ?? new Date();
  const name = (id: string) => id === 'pm' ? 'PM' : state.members.get(id)?.displayName ?? id;
  const forecastNow = state.plan ? forecastFromState(state, now) : null;
  const uncertainty = forecastNow?.uncertainty;
  const labels = labeler(typed, state, name);
  const { label, humanize, isMessage, version, taskTitle } = labels;
  const taskIds = knownTaskIds(typed, state);
  const dayIso = (day: number) => new Date(now.getTime() + day * DAY_MS).toISOString();
  const channelMessages = buildMessages(typed, state, name, labels, taskIds).filter(m => !isTaskThread(m.threadId));
  const context = buildWorkContext(state, name, options.me, channelMessages, typed);
  const messages = context?.messages ?? channelMessages;
  const work = workBuilder(events, typed, state, name, labels, taskIds);
  const read = readers(typed, state, labels, taskIds);
  const week = availabilityWeek(now);

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
      const tasks: VmPlanTask[] = p.tasks.map(t => { const h = hours.get(t.id), end = spans?.get(t.id); return { id: t.id, title: t.title, assigneeName: name(t.assignee), dependsOn: t.dependsOn, ...(t.parentId ? { parentId: t.parentId } : {}),
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
    const p = e.payload, spokenText = spoken.get(p.considerationId), reason = read.visible(REASONS[p.reason] ?? p.reason);
    // 같은 계기에 같은 판단·같은 말이 두 번 기록되면 한 번만 보인다.
    const key = JSON.stringify([p.triggerId, p.decision, reason, spokenText ?? '']);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ triggerMessageId: p.triggerId, decision: p.decision, reason, whoseAction: p.whoseAction === null ? null : humanize(whoLabel(p.whoseAction, state)),
      alreadyKnows: KNOWS[p.alreadyKnows] ?? p.alreadyKnows, evidence: [...new Set(p.evidence.flatMap(read.evidence))], at: e.at,
      ...(isMessage(p.triggerId) ? {} : { triggerLabel: read.evidence(p.triggerId)[0] ?? '작업 기록' }), ...(spokenText ? { spokenText: read.visible(spokenText) } : {}) }];
  });

  const forecastView = !forecastNow ? null : forecastNow.ok
    ? { ok: true as const, finishMin: forecastNow.end.min.toISOString(), finishMax: forecastNow.end.max.toISOString(), deadline: state.goal?.deadline, lateDaysMax: forecastNow.lateness?.maxDays, shortage: forecastNow.shortages.map(s => ({ memberName: name(s.memberId), hours: s.hours })) }
    : { ok: false as const, reasons: [...new Set(forecastNow.reasons.map(r => { const subject = r.memberId ? name(r.memberId) : r.taskId ? taskTitle(r.taskId) : ''; const why = FORECAST_REASON[r.kind] ?? r.kind; return subject ? `${subject}: ${why}` : why; }))] };

  const thisWeek = (id: string) => { const h = state.availabilityOverrides?.get(id)?.get(week); return h === undefined ? {} : { weeklyHoursThisWeek: h }; };
  return { mode: options.mode, project: { goal: state.goal?.text, deadline: state.goal?.deadline, ...projectTitle(state.goal?.text) }, me: options.me,
    members: [...[...state.members.values()].map(m => ({ id: m.memberId, kind: m.kind, displayName: m.displayName, role: m.role, weeklyHours: state.availability.get(m.memberId), ...thisWeek(m.memberId), busy: state.activeTurn.has(m.memberId), ...(m.source === 'pool' ? { pool: true } : {}) })), { id: 'pm', kind: 'pm', displayName: 'PM' }],
    messages, cards, ...(context ? { workContext: context.view } : {}), decisionCards: work.decisionCards(options.me),
    // No plan yet means no work projection: the panel then keeps showing the roadmap (WorkPanel fallback).
    ...(state.plan ? { work: work.view(options.me) } : {}), busy: options.busy, ...(options.scenario ? { scenario: options.scenario } : {}), ...(options.activity ? { activity: options.activity } : {}),
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

// ── 작업 패널(§4): 작업 항목·팀·결정 요청 카드·작업 상세. 사람에게 보이는 글에는 작업 id·키를 넣지 않는다. ──
const WORK_LABEL: Record<VmWorkStatus, string> = { todo: '할 일', in_progress: '진행 중', in_review: '검토 중', waiting_human: '사람 대기', blocked: '막힘', done: '완료', cancelled: '취소' };
const ROUTING_LABEL: Record<RoutingReason, string> = {
  agent_capable: 'Agent가 할 수 있는 일이라 바로 맡겼어요',
  needs_decision: '결정이 필요한 일이라 사람에게 맡겼어요',
  needs_human_access: '사람만 접근할 수 있는 일이라 사람에게 맡겼어요',
  needs_human_judgement: '사람의 판단이 필요한 일이라 사람에게 맡겼어요',
  no_capable_agent: '맡을 수 있는 Agent가 없어 사람에게 맡겼어요',
};
const PRIORITY_LABEL: Record<Priority, string> = { high: '높음', normal: '보통', low: '낮음' };
const OUTCOME_TEXT: Record<string, string> = {
  approved: '추천대로 진행하기로 했어요', chose_other: '다른 안을 골랐어요', edited: '고쳐서 승인했어요', rejected: '보류했어요',
  answered: '답을 보냈어요', withdrawn: '상황이 바뀌어 PM이 요청을 닫았어요', expired: '답이 없어 요청이 만료됐어요',
};
const RESOLVE_TEXT = { accept: '결과를 지금 그대로 확인', retry: '다시 맡기기', recheck: '결과 다시 검토' } as const;

/** 결정 요청 선택지 안의 새 작업 id(create_task·split_task의 tempId). */
function draftIds(effect: DecisionEffect): string[] {
  if (effect.type !== 'plan_ops') return [];
  return effect.ops.flatMap(op => op.type === 'create_task' ? [op.tempId] : op.type === 'split_task' ? op.children.map(c => c.tempId) : []);
}

/**
 * What people read in place of internal ids: work titles for task ids (also new work still inside a decision request),
 * and evidence labels that never show a raw ledger key (`research-1`, `digest:2026-10-01`, a request id).
 */
function readers(typed: readonly AnyEvent[], state: ProjectState, labels: ReturnType<typeof labeler>, taskIds: readonly string[]) {
  const { label, humanize } = labels;
  const drafts = new Map<string, string>();
  for (const entry of state.decisionRequests.values()) for (const option of entry.request.options) for (const effect of option.effects) {
    if (effect.type !== 'plan_ops') continue;
    for (const op of effect.ops) {
      if (op.type === 'create_task') drafts.set(op.tempId, op.title);
      else if (op.type === 'split_task') for (const child of op.children) drafts.set(child.tempId, child.title);
    }
  }
  const proposed = new Map(typed.flatMap(e => e.type === 'plan_proposed' ? e.payload.tasks.map(t => [t.id, t.title] as const) : []));
  // 모르는 id라도 그 id를 그대로 보이지 않는다.
  const titleOf = (id: string) => state.tasks.get(id)?.spec.title ?? drafts.get(id) ?? proposed.get(id) ?? '새 작업';
  const ids = [...taskIds].sort((a, b) => b.length - a.length);
  const bare = ids.length ? new RegExp(`(?<![A-Za-z0-9_-])(?:${ids.map(escape).join('|')})(?![A-Za-z0-9_-])`, 'g') : undefined;
  /** 모델·코드가 쓴 문장에서 "[id 제목]"·"task:id"·맨 id를 작업 이름으로, 멤버 id를 이름으로 바꾼다. */
  /** Bare task ids in PM/agent sentences become work titles (people never see work keys). */
  const plainIds = (text: string) => bare ? text.replace(bare, id => titleOf(id)) : text;
  const visible = (text: string) => sanitizeMachineText(plainIds(humanize(stripTaskKeys(text, taskIds))));
  /** Evidence ids as people read them; an id that has no readable name is left out rather than shown raw. */
  const evidence = (raw: string): string[] => {
    const prefix = raw.split(':')[0];
    if (state.tasks.has(raw) || drafts.has(raw)) return [titleOf(raw)];
    if (prefix === 'digest') return ['하루 요약'];
    if (prefix === 'sweep') return ['정체 점검'];
    const request = state.decisionRequests.get(raw);
    if (request) return [`결정 요청 · ${clip(visible(request.request.question), 28)}`];
    const text = label(raw);
    if (text !== raw) return [visible(text)];
    return /\s|[가-힣]/.test(raw) ? [visible(raw)] : [];
  };
  return { titleOf, visible, evidence, plainIds };
}

function workBuilder(events: readonly LedgerEvent[], typed: readonly AnyEvent[], state: ProjectState, name: (id: string) => string, labels: ReturnType<typeof labeler>, taskIds: readonly string[]) {
  const { titleOf, visible, evidence } = readers(typed, state, labels, taskIds);
  const quoted = (id: string) => `"${titleOf(id)}"`;
  const messageText = new Map<string, { authorId: string; text: string }>();
  for (const e of typed) {
    if (e.type === 'message_recorded') messageText.set(e.payload.messageId, { authorId: e.payload.authorId, text: e.payload.text });
    else if (e.type === 'pm_spoke') messageText.set(e.payload.messageId, { authorId: 'pm', text: e.payload.text });
  }
  const attachments = new Map(typed.flatMap(e => e.type === 'attachment_recorded' ? [[e.payload.attachmentId, e.payload] as const] : []));
  const opens = openDecisions(state);

  const live = (task: TaskState | undefined): task is TaskState => !!task && task.status !== 'cancelled';
  /** 상위 작업은 실행하지 않으므로 "진행 중"은 하위 작업에서 계산한다(§2.1). */
  const statusOf = (task: TaskState, depth = 0): VmWorkStatus => {
    if (!isParentTask(state, task) || depth > 2) return workStatus(task, state);
    if (task.status === 'checked') return 'done';
    if (waitingOn(state, task.spec.id)) return 'waiting_human';
    const children = (task.children ?? []).map(id => state.tasks.get(id)).filter(live).map(child => statusOf(child, depth + 1));
    return children.some(s => s !== 'todo') ? 'in_progress' : 'todo';
  };
  const parent = (id: string) => { const task = state.tasks.get(id); return !!task && isParentTask(state, task); };
  const planned = (state.plan?.tasks ?? []).map(t => state.tasks.get(t.id)).filter((t): t is TaskState => !!t);
  const dropped = [...state.tasks.values()].filter(t => t.status === 'cancelled' && !state.plan?.tasks.some(p => p.id === t.spec.id)).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const ordered = [...planned, ...dropped];

  const item = (task: TaskState, resolutions: ReturnType<typeof taskResolutions>): VmWorkItem => {
    const { spec, meta } = task;
    const member = state.members.get(spec.assignee);
    const status = statusOf(task);
    const waiting = status === 'waiting_human' ? waitingOn(state, spec.id) : undefined;
    const routing = meta?.routing;
    const routingNote = routing ? (routing.note.trim() ? visible(routing.note) : ROUTING_LABEL[routing.reason])
      : member?.kind === 'agent' && !parent(spec.id) ? ROUTING_LABEL.agent_capable : undefined;
    const brief = meta?.brief, origin = meta?.origin;
    const resolution = resolutions.find(r => r.taskId === spec.id);
    return {
      id: spec.id, title: spec.title, ...(spec.parentId ? { parentId: spec.parentId } : {}),
      ownerId: spec.assignee, ownerKind: member?.kind === 'agent' ? 'agent' : 'human', status, priority: meta?.priority ?? 'normal',
      ...(routingNote ? { routingNote } : {}), ...(waiting ? { waitingOn: { memberId: waiting.memberId, requestId: waiting.requestId } } : {}),
      childIds: (task.children ?? []).filter(id => state.tasks.has(id)),
      ...(brief ? { brief: {
        why: visible(brief.why),
        sources: brief.sourceMessageIds.flatMap(id => { const m = messageText.get(id); return m ? [{ messageId: id, excerpt: clip(m.text, 80) }] : []; }),
        decisions: brief.decisionIds.flatMap(id => { const d = state.decisions.get(id); return d ? [{ id, summary: visible(d.summary) }] : []; }),
        attachments: brief.attachmentIds.flatMap(id => { const a = attachments.get(id); return a ? [{ id, name: a.name, url: `/api/attachments/${encodeURIComponent(id)}` }] : []; }),
        constraints: brief.constraints.map(visible),
      } } : {}),
      // The conversation the work came from: the creator's own words first (an approved request's origin is the answer record).
      ...(origin ? { origin: { createdByName: origin.createdBy === 'pm' ? 'PM' : name(origin.createdBy),
        messageIds: [...new Set([...origin.sourceMessageIds, ...(brief?.sourceMessageIds ?? [])])].filter(id => messageText.has(id))
          .sort((a, b) => Number(messageText.get(b)!.authorId === origin.createdBy) - Number(messageText.get(a)!.authorId === origin.createdBy)) } } : {}),
      ...(spec.handoffConditions.length ? { handoffConditions: [...spec.handoffConditions] } : {}),
      ...(spec.exclusions?.length ? { exclusions: [...spec.exclusions] } : {}), ...(spec.limits?.length ? { limits: [...spec.limits] } : {}),
      ...(resolution ? { resolution: { taskId: resolution.taskId, actions: resolution.actions } } : {}),
    };
  };
  const items = (me: string) => { const resolutions = taskResolutions(events, me); return ordered.map(task => item(task, resolutions)); };

  const team = (list: VmWorkItem[]): VmWorkTeamRow[] => [...state.members.values()].map(member => {
    const leaves = list.filter(i => i.ownerId === member.memberId && !parent(i.id));
    const openCount = opens.filter(d => d.targetMemberId === member.memberId).length;
    const turn = state.activeTurn.get(member.memberId);
    const current = (turn ? leaves.find(i => i.id === turn) : undefined) ?? leaves.find(i => i.status === 'waiting_human')
      ?? leaves.find(i => ['in_progress', 'in_review', 'blocked'].includes(i.status)) ?? (member.kind === 'human' ? leaves.find(i => i.status === 'todo') : undefined);
    const currentLabel = current?.status === 'waiting_human' && current.waitingOn ? `${name(current.waitingOn.memberId)}님 결정 대기` : current ? WORK_LABEL[current.status] : undefined;
    const text = member.kind === 'human' && openCount ? `결정 ${openCount}건 대기` : currentLabel ?? '쉬는 중';
    return { memberId: member.memberId, ...(current ? { currentItemId: current.id } : {}), state: text, openDecisions: openCount };
  });

  const opLine = (op: PlanOp): string => {
    switch (op.type) {
      case 'create_task': return `새 작업 "${op.title}" 만들기 · 담당 ${name(op.assignee)}${op.parentId ? ` · ${quoted(op.parentId)} 아래` : ''}`;
      case 'split_task': return `${quoted(op.taskId)} 작업을 ${op.children.map(c => `"${c.title}"`).join(', ')}(으)로 나누기`;
      case 'cancel_task': return `${quoted(op.taskId)} 작업 취소`;
      case 'set_priority': return `${quoted(op.taskId)} 우선순위 ${PRIORITY_LABEL[op.priority] ?? '보통'}`;
      case 'reassign': return `${quoted(op.taskId)} 담당을 ${name(op.assignee)}에게`;
      case 'exclude_scope': return `${quoted(op.taskId)}에서 "${op.item}" 빼기`;
      case 'limit_scope': return `${quoted(op.taskId)} 범위를 ${op.items.map(x => `"${x}"`).join(', ')}(으)로 한정`;
      case 'handoff_early': return `${quoted(op.taskId)} 초안으로 먼저 넘기기`;
      case 'set_availability': return `${name(op.memberId)} 주간 가용 시간 ${op.weeklyHours}시간`;
      case 'set_deadline': return `기한 바꾸기: ${op.date.slice(0, 10)}`;
      case 'change_goal': return `목표 바꾸기: ${clip(visible(op.text), 60)}`;
      default: return '계획 변경';
    }
  };
  const effectLines = (effect: DecisionEffect): string[] => {
    switch (effect.type) {
      case 'plan_ops': return effect.ops.map(opLine);
      case 'resolve_task': return [`${quoted(effect.taskId)} ${RESOLVE_TEXT[effect.action]}${effect.note ? `: ${visible(effect.note)}` : ''}`];
      case 'answer': return ['답을 담당 Agent에게 그대로 전달'];
      default: return ['변경 없음'];
    }
  };
  type OpenRequest = Parameters<typeof bundleDecisions>[0][number];
  const decisionCard = (request: OpenRequest): VmDecisionCard => ({
      kind: 'decision' as const, id: request.requestId, forMemberId: request.targetMemberId, requestKind: request.kind, question: visible(request.question),
      recommendation: { optionId: request.recommendation.optionId, rationale: visible(request.recommendation.rationale), evidence: [...new Set(request.recommendation.evidence.flatMap(evidence))] },
      options: request.options.map(o => {
        // answerText는 core 선택지의 선택 필드다(계약 FIX-R1-CORE). 아직 없는 core에서도 같은 코드가 돈다.
        const answer = (o as { answerText?: string }).answerText?.trim();
        return { optionId: o.optionId, label: visible(o.label), tradeoff: visible(o.tradeoff), summary: o.effects.flatMap(effectLines), ...(answer ? { answerText: answer } : {}) };
      }),
      impact: { taskTitles: [...new Set(request.impact.taskIds.map(titleOf))], blockedTitles: [...new Set(request.impact.blockedTaskIds.map(titleOf))],
        ...(request.impact.deadlineDeltaDays !== undefined ? { deadlineDeltaDays: request.impact.deadlineDeltaDays } : {}) },
      ...(request.editable?.length ? { editable: [...request.editable] } : {}),
      answerMode: request.kind === 'missing_info' ? 'text' as const : 'choose' as const,
    });
  /**
   * 한 사람에게 열린 결정 요청은 카드 최대 3장(core bundleDecisions): 넷째부터는 셋째 카드에 묶여 `bundled`로 따라간다.
   * 계획 승인·권한 카드(vm.cards)는 따로 보이므로 묶지 않는다.
   */
  const decisionCards = (me: string): VmDecisionCard[] =>
    bundleDecisions(openDecisions(state).filter(d => d.source === 'decision_requested' && d.targetMemberId === me))
      .map(([lead, ...rest]) => ({ ...decisionCard(lead!), ...(rest.length ? { bundled: rest.map(decisionCard) } : {}) }));

  /** 활동 한 줄 뒤에 붙는 설명. 정리하고 남는 말이 없으면 붙이지 않는다. */
  const detail = (text: string | undefined) => { const t = text ? visible(text) : ''; return t ? `: ${t}` : ''; };
  const activityText = (a: TaskActivity): string => {
    switch (a.kind) {
      case 'created': {
        const by = a.source?.createdBy;
        const base = by && by !== 'pm' ? `${name(by)}의 발언에서 작업이 생겼어요` : 'PM이 계획에 작업을 넣었어요';
        return a.source?.decisionRequestId ? `${base}(결정 요청 승인)` : base;
      }
      case 'assigned': return `담당이 ${name(a.assignee ?? '')}(으)로 바뀌었어요`;
      case 'started': return '작업을 시작했어요';
      case 'submitted': { const text = visible(a.text ?? ''); return text ? `결과를 냈어요: ${clip(text, 80)}` : '결과를 냈어요'; }
      case 'reviewed': return a.event === 'task_checked' ? 'PM이 인계 조건을 확인했어요' : a.text === 'sufficient' ? 'PM이 결과를 검토했어요: 조건 충족' : 'PM이 결과를 검토했어요: 보완 필요';
      case 'revision': return `보완을 요청했어요${detail(a.text)}`;
      case 'blocked': return `멈췄어요${detail(a.text)}`;
      case 'resumed': return '다시 이어서 진행해요';
      case 'changed': return a.cancelled ? '계획에서 빠졌어요' : a.event === 'update_sent' ? '바뀐 내용을 담당에게 전달했어요' : `작업 내용이 바뀌었어요${detail(a.text)}`;
      case 'decision_requested': {
        const target = a.requestId ? state.decisionRequests.get(a.requestId)?.request.targetMemberId : undefined;
        return `${target ? `${name(target)}님에게 ` : ''}결정을 요청했어요${detail(a.text)}`;
      }
      case 'decision_resolved': return OUTCOME_TEXT[a.text ?? ''] ?? '결정했어요';
      case 'comment': return visible(a.text ?? '') || '댓글을 남겼어요';
    }
  };
  const activity = (taskId: string): VmActivityItem[] => taskActivity(events, taskId).map(a => {
    const messageId = a.messageId ?? a.source?.sourceMessageIds.find(id => messageText.has(id));
    // The PM creates, assigns, delivers changes, reviews and asks; starts, results, answers and comments are the member's own.
    const own = ['started', 'submitted', 'comment', 'decision_resolved', 'blocked', 'resumed'].includes(a.kind);
    return { at: a.at, kind: a.kind, actorId: own && state.members.has(a.actorId) ? a.actorId : 'pm', text: activityText(a), ...(messageId ? { messageId } : {}) };
  });

  return {
    view: (me: string): VmWork => { const list = items(me); return { items: list, team: team(list) }; },
    decisionCards,
    detail: (taskId: string, me: string, messages: readonly VmMessage[]): VmTaskDetail | undefined => {
      const task = state.tasks.get(taskId);
      if (!task) return undefined;
      return { item: item(task, taskResolutions(events, me)), activity: activity(taskId), comments: messages.filter(m => m.threadId === `task:${taskId}`) };
    },
  };
}

/** `GET /api/tasks/:id`: 작업 하나와 활동 기록·댓글(상태 폴링에는 싣지 않는다). 없는 작업이면 undefined. */
export function buildTaskDetail(events: readonly LedgerEvent[], taskId: string, options: { me: string }): VmTaskDetail | undefined {
  const state = project(events), typed = events as readonly AnyEvent[];
  if (!state.tasks.has(taskId)) return undefined;
  const name = (id: string) => id === 'pm' ? 'PM' : state.members.get(id)?.displayName ?? id;
  const labels = labeler(typed, state, name);
  const taskIds = knownTaskIds(typed, state);
  return workBuilder(events, typed, state, name, labels, taskIds).detail(taskId, options.me, buildMessages(typed, state, name, labels, taskIds));
}
