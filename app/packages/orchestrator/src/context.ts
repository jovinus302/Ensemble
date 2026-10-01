import { particle, channelText } from './channel-text.ts';
// Task context for the next assignee: the six fixed slots, each item carrying the ID it came from.
// Also the short human-facing summary of an agent result. Pure functions over the ledger; no LLM.
import { project, type AnyEvent, type EventPayloads, type Id, type LedgerEvent, type ProjectState } from '@ensemble/core';
import { INPUTS_DIR, MAX_FILE_BYTES, type ResultReport, type SourcedItem, type TaskInstructionsInput, type UpdateInstructionsInput } from '@ensemble/agents';

/** Newest-first character budget for the related-conversation slot. */
export const CONVERSATION_CHAR_LIMIT = 1500;

const questionPrefix = (taskId: Id) => `question:${taskId}:`;
export const questionMessageId = (taskId: Id, n: number) => `${questionPrefix(taskId)}${n}`;
export const answerChangeId = (questionId: Id) => `answer:${questionId}`;

const typed = (events: readonly LedgerEvent[]) => events as readonly AnyEvent[];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, token: string) => new RegExp(`(^|[^A-Za-z0-9_])${escape(token)}($|[^A-Za-z0-9_])`).test(text);

function taskMentioned(text: string, taskId: Id, title: string): boolean {
  return mentions(text, taskId) || (title.length >= 2 && text.includes(title));
}

/**
 * Confirmed decisions that bear on a task: those its title, its handoff conditions or its direct
 * predecessors' handoff conditions cite by ID, those
 * that name the task, and scope exclusions (they bind every task). Pending authority requests are
 * candidates, not decisions, and never appear here.
 */
export function relevantDecisions(state: ProjectState, taskId: Id): EventPayloads['decision_recorded'][] {
  const task = state.tasks.get(taskId);
  if (!task) return [];
  // Predecessors' conditions count too: the next assignee builds on results checked against them.
  const predecessors = task.spec.dependsOn.flatMap((id) => state.tasks.get(id)?.spec.handoffConditions ?? []);
  const cited = [task.spec.title, ...task.spec.handoffConditions, ...predecessors].join('\n');
  return [...state.decisions.values()].filter((d) =>
    mentions(cited, d.decisionId) || taskMentioned(d.summary, taskId, task.spec.title) || d.changeKinds.includes('scope_reduce'));
}

/** The questions asked for a task and the answers delivered for them, from the ledger. */
export function taskQuestions(events: readonly LedgerEvent[], taskId: Id): { questionId: Id; text: string; answer?: { changeId: Id; text: string } }[] {
  const questions = new Map<Id, { questionId: Id; text: string; answer?: { changeId: Id; text: string } }>();
  for (const event of typed(events)) {
    if (event.type === 'pm_spoke' && event.payload.kind === 'ask' && event.payload.messageId.startsWith(questionPrefix(taskId))) {
      questions.set(event.payload.messageId, { questionId: event.payload.messageId, text: event.payload.text });
    }
    if (event.type === 'change_notified' && event.payload.changeId.startsWith(answerChangeId(questionPrefix(taskId)))) {
      const question = questions.get(event.payload.changeId.slice(answerChangeId('').length));
      if (question && !question.answer) question.answer = { changeId: event.payload.changeId, text: event.payload.text };
    }
  }
  return [...questions.values()];
}

function results(events: readonly LedgerEvent[]): Map<Id, EventPayloads['result_submitted']> {
  const byId = new Map<Id, EventPayloads['result_submitted']>();
  for (const event of typed(events)) if (event.type === 'result_submitted') byId.set(event.payload.resultId, event.payload);
  return byId;
}

function conversation(state: ProjectState, events: readonly LedgerEvent[], taskId: Id): SourcedItem[] {
  const task = state.tasks.get(taskId)!;
  const name = (id: Id) => state.members.get(id)?.displayName ?? id;
  const items: { seq: number; item: SourcedItem }[] = [];
  const related = new Set<Id>();
  for (const message of state.messages) {
    const inThread = message.threadId !== undefined && related.has(message.threadId);
    if (!inThread && !taskMentioned(message.text, taskId, task.spec.title)) continue;
    related.add(message.messageId);
    items.push({ seq: message.seq, item: { text: `[대화] ${name(message.authorId)}: ${message.text}`, sourceId: message.messageId } });
  }
  for (const event of typed(events)) {
    if (event.type === 'reply_recorded' && event.payload.taskId === taskId) {
      items.push({ seq: event.seq, item: { text: `[대화] ${name(event.payload.memberId)}: ${event.payload.text}`, sourceId: event.id } });
    }
    if (event.type === 'change_notified' && event.payload.changeId.startsWith(answerChangeId(questionPrefix(taskId)))) {
      items.push({ seq: event.seq, item: { text: `[대화] 답변: ${event.payload.text}`, sourceId: event.payload.changeId } });
    }
  }
  items.sort((a, b) => a.seq - b.seq);
  // Keep the most recent messages within the budget, then restore reading order.
  const kept: SourcedItem[] = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const { item } = items[i]!;
    if (used + item.text.length > CONVERSATION_CHAR_LIMIT && kept.length) {
      const omitted = items.slice(0, i + 1);
      kept.push({ text: `(이전 대화 ${omitted.length}건 생략)`, sourceId: `${omitted[0]!.item.sourceId}..${omitted.at(-1)!.item.sourceId}` });
      break;
    }
    used += item.text.length;
    kept.push(item);
  }
  return kept.reverse();
}

/**
 * The six slots for the next assignee: goal and plan version / task and handoff conditions /
 * confirmed decisions and exclusions / inputs (checked results of predecessor tasks) / related
 * conversation / open questions. The protocol has no conversation slot, so conversation items
 * follow the inputs, marked "[대화]".
 */
export function buildTaskContext(state: ProjectState, taskId: Id, events: readonly LedgerEvent[]): TaskInstructionsInput {
  const task = state.tasks.get(taskId);
  if (!task) throw new Error(`Unknown task ${taskId}`);
  if (!state.plan || !state.goal) throw new Error('A goal and a committed plan are required to build task context');
  const planVersion = state.plan.version;
  const eventId = (type: string) => typed(events).findLast((event) => event.type === type)?.id ?? type;
  const planSource = `${eventId('plan_committed')}#v${planVersion}`;
  const goal = state.goal;

  const byResult = results(events);
  const name = (id: Id) => state.members.get(id)?.displayName ?? id;
  const files = taskInputFiles(state, events, taskId);
  const inputs: SourcedItem[] = [];
  for (const depId of task.spec.dependsOn) {
    const dep = state.tasks.get(depId);
    const result = dep?.checkedResultId ? byResult.get(dep.checkedResultId) : undefined;
    if (!dep || !result) continue;
    inputs.push({ text: `선행 작업 "${dep.spec.title}" 결과 (${name(dep.spec.assignee)} 제출, PM 확인 완료) 요약: ${result.summary}`, sourceId: result.resultId });
    if (dep.spec.handoffConditions.length) {
      inputs.push({ text: `선행 작업 "${dep.spec.title}"에서 확인된 인계 조건: ${dep.spec.handoffConditions.join('; ')}`, sourceId: `${planSource}:${depId}.handoff` });
    }
    for (const file of files.filter((f) => f.taskId === depId)) {
      inputs.push(file.data !== undefined
        ? { text: `결과 파일: ${file.path} (원래 이름: ${file.name}, 올린 사람: ${file.uploaderName}, 선행 작업: ${dep.spec.title})`, sourceId: file.path }
        : { text: `결과 파일: ${file.name} (올린 사람: ${file.uploaderName}, 선행 작업: ${dep.spec.title}) — ${file.skipped}`, sourceId: `${result.resultId}:${file.name}` });
    }
  }

  const openQuestions = taskQuestions(events, taskId).filter((q) => !q.answer).map((q) => ({ text: q.text, sourceId: q.questionId }));
  const { exclusions, limits } = taskScope(task.spec);
  return {
    taskId,
    planVersion,
    goalSummary: { text: goal.deadline ? `${goal.text} (기한 ${goal.deadline})` : goal.text, sourceId: eventId('goal_set') },
    taskTitle: { text: task.spec.title, sourceId: planSource },
    handoffConditions: task.spec.handoffConditions.map((text, i) => ({ text, sourceId: `${planSource}:${taskId}.handoff[${i}]` })),
    // People's scope decisions stay separate from the conditions, which are never rewritten (M11 T2).
    ...(exclusions.length ? { exclusions: exclusions.map((text, i) => ({ text, sourceId: `${planSource}:${taskId}.exclusions[${i}]` })) } : {}),
    ...(limits.length ? { limits: limits.map((text, i) => ({ text, sourceId: `${planSource}:${taskId}.limits[${i}]` })) } : {}),
    decisions: relevantDecisions(state, taskId).map((d) => ({ text: d.summary, sourceId: d.decisionId })),
    inputs: [...inputs, ...conversation(state, events, taskId)],
    openQuestions,
    files: files.flatMap((file) => file.data !== undefined ? [{ path: file.path, data: file.data }] : []),
  };
}

/** What people excluded from a task and how far they limited it; both lists are kept apart from its conditions. */
export function taskScope(spec: { exclusions?: unknown; limits?: unknown }): { exclusions: string[]; limits: string[] } {
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
  return { exclusions: strings(spec.exclusions), limits: strings(spec.limits) };
}

/** A predecessor result file and where the next assignee finds it: inputs/<task title>/<file name>. */
export interface TaskInputFile {
  /** The predecessor task. */
  taskId: Id;
  taskTitle: string;
  resultId: Id;
  attachmentId: Id;
  /** Original file name. */
  name: string;
  /** Workspace-relative, "/"-separated. */
  path: string;
  uploaderId?: Id;
  uploaderName: string;
  uploaderKind?: 'human' | 'agent';
  /** Base64 content; absent when the file is not copied (see `skipped`). */
  data?: string;
  skipped?: string;
}

const UNSAFE_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
/** A single path segment that is valid on Windows and POSIX and never walks out of its folder. */
function safeSegment(text: string, fallback: string, max: number): string {
  const clean = (value: string) => value.normalize('NFC').replace(UNSAFE_NAME, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  const dot = text.lastIndexOf('.');
  const ext = dot > 0 && text.length - dot <= 10 ? clean(text.slice(dot)) : '';
  let stem = clean(ext ? text.slice(0, dot) : text).slice(0, max).trim().replace(/[. ]+$/, '');
  if (!stem || /^\.+$/.test(stem) || RESERVED_NAME.test(stem)) stem = clean(fallback).slice(0, max) || 'file';
  return `${stem}${ext}`;
}

/**
 * Result files of the task's checked predecessors (human attachments and agent outputs alike), each
 * with a stable workspace path. Pure: the same ledger always yields the same paths and contents.
 */
export function taskInputFiles(state: ProjectState, events: readonly LedgerEvent[], taskId: Id): TaskInputFile[] {
  const task = state.tasks.get(taskId);
  if (!task) return [];
  const byResult = results(events);
  const attachments = new Map<Id, { payload: EventPayloads['attachment_recorded']; actorId: Id }>();
  for (const event of typed(events)) if (event.type === 'attachment_recorded') attachments.set(event.payload.attachmentId, { payload: event.payload, actorId: event.actor.id });
  const submitters = new Map<Id, Id>();
  for (const event of typed(events)) if (event.type === 'result_submitted') submitters.set(event.payload.resultId, event.actor.id);
  const folders = new Set<string>();
  const files: TaskInputFile[] = [];
  for (const depId of task.spec.dependsOn) {
    const dep = state.tasks.get(depId);
    const result = dep?.checkedResultId ? byResult.get(dep.checkedResultId) : undefined;
    if (!dep || !result) continue;
    let folder = safeSegment(dep.spec.title, depId, 60);
    if (folders.has(folder.toLowerCase())) folder = safeSegment(`${dep.spec.title}-${depId}`, depId, 80);
    folders.add(folder.toLowerCase());
    const names = new Set<string>();
    for (const attachmentId of result.artifactIds) {
      const attachment = attachments.get(attachmentId);
      const original = attachment?.payload.name ?? attachmentId;
      let name = safeSegment(original.split(/[\\/]/).at(-1) ?? original, 'file', 80);
      for (let n = 2; names.has(name.toLowerCase()); n++) {
        const dot = name.lastIndexOf('.');
        name = dot > 0 ? `${name.slice(0, dot).replace(/-\d+$/, '')}-${n}${name.slice(dot)}` : `${name.replace(/-\d+$/, '')}-${n}`;
      }
      names.add(name.toLowerCase());
      const uploaderId = [attachment?.actorId, submitters.get(result.resultId)].find((id) => id && state.members.has(id)) ?? dep.spec.assignee;
      const member = state.members.get(uploaderId);
      const file: TaskInputFile = { taskId: depId, taskTitle: dep.spec.title, resultId: result.resultId, attachmentId, name: original,
        path: `${INPUTS_DIR}/${folder}/${name}`, uploaderId, uploaderName: member?.displayName ?? uploaderId, ...(member ? { uploaderKind: member.kind } : {}) };
      const match = attachment ? /^data:[^,]*;base64,(.*)$/s.exec(attachment.payload.uri) : null;
      if (!attachment) file.skipped = '파일 기록을 찾지 못해 작업 폴더에 복사하지 않았습니다';
      else if (!match) file.skipped = '파일 내용을 읽을 수 없어 작업 폴더에 복사하지 않았습니다';
      else if (Buffer.byteLength(match[1]!, 'base64') > MAX_FILE_BYTES) { const cap = `${MAX_FILE_BYTES / 1024 / 1024}MB`; file.skipped = `파일이 ${cap}${particle(cap)} 넘어 작업 폴더에 복사하지 않았습니다`; }
      else file.data = match[1]!;
      files.push(file);
    }
  }
  return files;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/**
 * Replaces internal references an agent may echo (attachment IDs, UUIDs, question keys, source
 * citations) with names people know; unknown UUIDs are dropped.
 */
export function humanizeRefs(text: string, events: readonly LedgerEvent[]): string {
  const names = new Map<string, string>();
  for (const event of typed(events)) if (event.type === 'attachment_recorded') names.set(event.payload.attachmentId.toLowerCase(), event.payload.name);
  let result = text.replace(/\s*\[출처:[^\]]*\]/g, '').replace(/\bquestion:[\w-]+:\d+\b/g, '질문');
  for (const [id, name] of names) result = result.replace(new RegExp(escape(id), 'gi'), `"${name}"`);
  return result.replace(new RegExp(`\\s*[(\\[]\\s*(?:${UUID.source})\\s*[)\\]]`, 'gi'), '')
    .replace(new RegExp(`(?:result|attachment|file):(?:${UUID.source})`, 'gi'), '')
    .replace(UUID, '').replace(/ {2,}/g, ' ').trim();
}

/** The update that carries a person's answer to an agent question (steered or in a new turn). */
export function answerUpdate(changeId: Id, planVersion: number, question: { text: string } | undefined, answerText: string): UpdateInstructionsInput {
  return { updateId: changeId, fromVersion: planVersion, toVersion: planVersion, keep: [],
    // The relayed channel sentence opens with "@person … 묻습니다."; the agent needs only its own question.
    change: [question ? `질문 "${question.text.replace(/^@[^\n]*?묻습니다\.\s*/, '')}"에 대한 답: ${answerText}` : `담당자 메시지: ${answerText}`], drop: [], reason: '담당자가 질문에 답했습니다' };
}

/**
 * The update for a change_notified record the agent could not receive in its turn. Coordinator
 * records carry either a steer input that was refused (JSON UpdateInstructionsInput) or the
 * agent's new tasks ({ summary, tasks, drop }); answers carry the answer text.
 */
export function pendingChangeUpdate(events: readonly LedgerEvent[], change: EventPayloads['change_notified'], taskId: Id): UpdateInstructionsInput {
  if (change.changeId.startsWith(answerChangeId(''))) {
    const question = taskQuestions(events, taskId).find((q) => q.answer?.changeId === change.changeId);
    return answerUpdate(change.changeId, change.planVersion, question, change.text);
  }
  const updateId = `${change.changeId}:${change.recipientId}:turn`;
  const base = { updateId, fromVersion: Math.max(1, change.planVersion - 1), toVersion: change.planVersion, keep: [] as string[], drop: [] as string[] };
  let parsed: unknown;
  try { parsed = JSON.parse(change.text); } catch { parsed = undefined; }
  const fields = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  if (fields && Array.isArray(fields.change)) {
    return { ...base, fromVersion: typeof fields.fromVersion === 'number' ? fields.fromVersion : base.fromVersion,
      toVersion: typeof fields.toVersion === 'number' ? fields.toVersion : base.toVersion, keep: strings(fields.keep),
      change: strings(fields.change), drop: strings(fields.drop), reason: typeof fields.reason === 'string' ? fields.reason : '계획이 바뀌었습니다' };
  }
  if (fields && typeof fields.summary === 'string') {
    const tasks = Array.isArray(fields.tasks) ? fields.tasks as { id?: unknown; title?: unknown; handoffConditions?: unknown }[] : [];
    const mine = tasks.filter((t) => t.id === taskId);
    return { ...base, drop: strings(fields.drop), reason: fields.summary,
      change: (mine.length ? mine : tasks).map((t) => `${String(t.title ?? '담당 작업')}: 인계 조건 ${strings(t.handoffConditions).join('; ') || '없음'}`) };
  }
  return { ...base, change: [change.text], reason: '계획이 바뀌었습니다' };
}

/** The person to ask about a file-related question: whoever uploaded the file it names. */
export function fileOwnerFor(state: ProjectState, events: readonly LedgerEvent[], taskId: Id, question: string): Id | undefined {
  const humans = taskInputFiles(state, events, taskId).filter((file) => file.uploaderKind === 'human' && file.uploaderId);
  const lower = question.toLowerCase();
  const stem = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name).toLowerCase();
  const named = humans.find((file) => lower.includes(file.attachmentId.toLowerCase()) || lower.includes(file.name.toLowerCase()) || lower.includes(file.path.toLowerCase())
    || (stem(file.name).length >= 3 && lower.includes(stem(file.name))));
  if (named) return named.uploaderId;
  const byTitle = humans.find((file) => file.taskTitle.length >= 2 && question.includes(file.taskTitle));
  if (byTitle) return byTitle.uploaderId;
  const owners = new Set(humans.map((file) => file.uploaderId));
  if (owners.size === 1 && /파일|자료|문서|첨부/.test(question)) return [...owners][0];
  return undefined;
}

/**
 * What a person hears about their next task: a reserved task has been booked for them to start now;
 * a ready one merely can start (its start was not reserved, e.g. automation is paused).
 */
export function startNotice(state: ProjectState, taskId: Id): string | undefined {
  const task = state.tasks.get(taskId);
  if (!task) return undefined;
  const mention = `@${state.members.get(task.spec.assignee)?.displayName ?? task.spec.assignee}`;
  const title = task.spec.title;
  // One meaning per sentence: a reserved start is about to begin; a ready one merely can.
  if (task.status === 'reserved') return `${mention} ${title}${particle(title)} 곧 시작합니다.`;
  if (task.status === 'ready') return `${mention} ${title}${particle(title)} 시작할 수 있습니다.`;
  return undefined;
}

/** PM revision requests a task (an agent's or a person's) may get before it stops for the decider instead of looping. */
export const MAX_AGENT_REVISIONS = 2;
/** The same cap, named for what it covers since M11 U2: people's tasks stop there too. */
export const MAX_REVISIONS = MAX_AGENT_REVISIONS;
/** Marks a hand-back ("다시 맡기기") of a task: the revision count starts over after it. */
export const retryKey = (taskId: Id, trigger: string) => `resolve:retry:${taskId}:${trigger}`;
type RevisionRequest = Extract<AnyEvent, { type: 'revision_requested' }>;
/** A person's own request (a hand-back or a reopened result) rather than the PM's review verdict. */
const personRequest = (event: RevisionRequest) => event.actor.kind === 'human';
/** The update ID of a revision request: the PM's keeps its M10 form; a person's is keyed by its own record. */
export function revisionChangeId(resultId: Id, request?: Pick<LedgerEvent, 'actor' | 'idempotencyKey' | 'id'>): string {
  return request?.actor.kind === 'human' ? `revision:${resultId}:${request.idempotencyKey ?? request.id}` : `revision:${resultId}`;
}

/**
 * PM revision requests for a task since it last started over: its current start was reserved (a new
 * plan version starts over), a person handed it back, or a person asked for a revision themselves.
 * Only the PM's own requests count toward the cap.
 */
export function revisionCount(events: readonly LedgerEvent[], taskId: Id): number {
  const all = typed(events);
  const since = Math.max(0, ...all.filter((e) => (e.type === 'task_start_reserved' && e.payload.taskId === taskId)
    || (e.type === 'revision_requested' && e.payload.taskId === taskId && personRequest(e))
    || e.idempotencyKey?.startsWith(retryKey(taskId, ''))).map((e) => e.seq));
  return all.filter((e) => e.type === 'revision_requested' && e.payload.taskId === taskId && !personRequest(e) && e.seq > since).length;
}

/**
 * The update that carries a revision request to the agent whose result it concerns: what is missing
 * (at most three items, internal IDs replaced by file names) and which files to fix. A person's
 * request (a hand-back or a reopened checked result) says so. Deterministic, so a retry or a restart
 * rebuilds the same update under the same ID.
 */
export function revisionUpdate(events: readonly LedgerEvent[], planVersion: number, taskId: Id, resultId: Id): UpdateInstructionsInput | undefined {
  const request = typed(events).findLast((e): e is RevisionRequest => e.type === 'revision_requested' && e.payload.taskId === taskId && e.payload.resultId === resultId);
  const result = results(events).get(resultId);
  if (!request || !result) return undefined;
  const names = new Map<Id, string>();
  for (const event of typed(events)) if (event.type === 'attachment_recorded') names.set(event.payload.attachmentId, event.payload.name);
  const files = [...new Set(result.artifactIds.map((id) => names.get(id) ?? id))];
  const human = personRequest(request);
  const missing = request.payload.missing.slice(0, 3).map((item) => humanizeRefs(item, events));
  const wasChecked = human && typed(events).some((e) => e.type === 'task_checked' && e.payload.taskId === taskId && e.payload.resultId === resultId && e.seq < request.seq);
  const requester = human ? (project(events).members.get(request.actor.id)?.displayName ?? request.actor.id) : '';
  return { updateId: revisionChangeId(resultId, request), fromVersion: planVersion, toVersion: planVersion, keep: [], drop: [],
    change: [...missing.map((item) => human ? item : `보완할 점: ${item}`), ...(files.length ? [`수정할 파일: ${files.join(', ')}`] : [])],
    reason: !human ? 'PM이 인계 조건을 검토했고 아래 보완이 필요합니다. 결과 파일을 고친 뒤 result_report로 다시 제출하세요'
      : wasChecked ? `확인된 결과에 ${requester}${particle(requester, '이/가')} 보완을 요청했습니다. 요청대로 결과 파일을 고친 뒤 result_report로 다시 제출하세요. 인계 조건과 제외 범위는 그대로 지킵니다`
      : `${requester}${particle(requester, '이/가')} 이 작업을 다시 맡겼습니다. 요청대로 결과 파일을 고친 뒤 result_report로 다시 제출하세요. 인계 조건과 제외 범위는 그대로 지킵니다` };
}

// Review verdict labels some agents carry over from their own instructions; people never need them.
const GLOSS: Record<string, string> = { 'COMMITTED CHANGE': '확정된 변경', 'PROPOSITION CHANGE': '요구 변경', 'INTENT GAP': '의도 차이',
  SOUND: '문제없음', REVISE: '수정 필요', PASS: '통과', FAIL: '실패', EXPERIMENT: '실험' };
const LABELS = [
  '[`*]*\\b(COMMITTED CHANGE|PROPOSITION CHANGE|INTENT GAP)\\b[`*]*',
  // Single words only when marked up as a label, so ordinary English (e.g. "tests PASS") stays.
  '`+(SOUND|REVISE|PASS|FAIL|EXPERIMENT)`+', '\\*\\*(SOUND|REVISE|PASS|FAIL|EXPERIMENT)\\*\\*',
];
const LABEL = new RegExp(`(?:${LABELS.join('|')})(을|를|이|가|은|는|으로|로|와|과)?`, 'g');
const withParticle = (word: string, josa: string | undefined) => {
  if (!josa) return word;
  if (josa === '을' || josa === '를') return word + particle(word);
  if (josa === '이' || josa === '가') return word + particle(word, '이/가');
  if (josa === '으로' || josa === '로') return word + particle(word, '으로/로');
  const batchim = particle(word, '이/가') === '이';
  return word + (josa === '은' || josa === '는' ? (batchim ? '은' : '는') : (batchim ? '과' : '와'));
};

/**
 * An agent's progress text as people read it: a sentence that only reports a review verdict label
 * (e.g. "사전 검토는 `SOUND`입니다") is dropped; a label inside a sentence that says something else is
 * replaced by a plain Korean word with its particle fixed.
 */
export function plainAgentText(text: string): string {
  LABEL.lastIndex = 0;
  if (!LABEL.test(text)) return text;
  const lines = text.split('\n').map((line) => {
    const sentences = line.split(/(?<=[.!?。])\s+/);
    const kept = sentences.flatMap((sentence) => {
      LABEL.lastIndex = 0;
      if (!LABEL.test(sentence)) return [sentence];
      if (/검토|판정|판단/.test(sentence)) return [];
      return [sentence.replace(LABEL, (_all, a?: string, b?: string, c?: string, josa?: string) => withParticle(GLOSS[(a ?? b ?? c)!]!, josa))];
    });
    return kept.length || !line.trim() ? kept.join(' ') : null;
  });
  return lines.filter((line): line is string => line !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Task statuses in the words people read. */
export const STATUS_LABEL: Record<string, string> = { waiting: '시작 전', ready: '시작 전', reserved: '진행 중', running: '진행 중', submitted: '검토 중', revising: '보완 중', checked: '확인됨', blocked: '멈춤', cancelled: '취소됨' };
/** Who may resolve or reopen a task, in the words of the buttons (M12 X2: never "권한을 확인할 수 없어"). */
export const REFUSAL = {
  accept: (deciderName?: string) => `"이대로 확인"은 결정권자${deciderName ? `(${deciderName})` : ''}만 할 수 있어요.`,
  retry: '"다시 맡기기"는 결정권자, 담당자 또는 후행 작업 담당자만 할 수 있어요.',
  reopen: '확인된 결과의 보완은 결정권자나 후행 작업 담당자가 요청할 수 있어요.',
};
export type RecoveryRequest = { type: 'resolve_task'; action: 'accept' | 'retry' | 'recheck'; taskId: Id } | { type: 'reopen_task'; taskId: Id };

/**
 * Why a person's request to resolve or reopen a task cannot run, as one sentence they read (M12 X2), or ''
 * when it may. Same authority as the buttons: accept is the goal's decider's; retry and reopen also the
 * task's assignee and the assignees of tasks built on it; recheck anyone, on a result waiting for review.
 */
export function recoveryRefusal(state: ProjectState, request: RecoveryRequest, by: Id): string {
  const task = state.tasks.get(request.taskId);
  if (!task || task.status === 'cancelled') return '작업을 찾지 못했습니다.';
  if (state.members.get(by)?.kind !== 'human') return '사람 멤버만 멈춘 작업을 처리할 수 있어요.';
  const title = task.spec.title;
  const label = STATUS_LABEL[task.status] ?? task.status;
  const decider = state.goal?.decider;
  const builtOn = (id: Id, seen = new Set<Id>()): boolean => !seen.has(id) && (seen.add(id), (state.tasks.get(id)?.spec.dependsOn ?? []).some(dep => dep === request.taskId || builtOn(dep, seen)));
  const involved = by === decider || task.spec.assignee === by || [...state.tasks.values()].some(t => t.status !== 'cancelled' && t.spec.assignee === by && builtOn(t.spec.id));
  if (request.type === 'reopen_task') {
    if (!involved) return REFUSAL.reopen;
    return task.status === 'checked' ? '' : `"${title}" 작업은 아직 확인 전(${label})이라 다시 열 결과가 없어요.`;
  }
  if (request.action === 'recheck') return task.status === 'submitted' && task.results.length ? '' : `"${title}" 결과는 지금 다시 검토할 상태가 아니에요(${label}).`;
  if (request.action === 'accept' && by !== decider) return REFUSAL.accept(decider ? state.members.get(decider)?.displayName ?? decider : undefined);
  if (request.action === 'retry' && !involved) return REFUSAL.retry;
  if (!['blocked', 'submitted', 'revising'].includes(task.status)) return `"${title}" 작업은 지금 ${label}${particle(label, '이/가') === '이' ? '이라' : '라'} 처리할 멈춤이 없어요.`;
  if (request.action === 'accept' && !task.results.length) return "확인할 결과가 아직 없어요. '다시 맡기기'로 작업을 다시 진행해 주세요.";
  return '';
}

/** A short template summary for people: what got done, what you need to do, where to look. */
export function summarizeForHuman(state: ProjectState, taskId: Id, report: ResultReport): string {
  const task = state.tasks.get(taskId);
  if (!task) throw new Error(`Unknown task ${taskId}`);
  const name = (id: Id) => state.members.get(id)?.displayName ?? id;
  const todo: string[] = [];
  if (task.status === 'checked') {
    for (const next of state.tasks.values()) {
      if (!next.spec.dependsOn.includes(taskId) || state.members.get(next.spec.assignee)?.kind !== 'human') continue;
      const notice = startNotice(state, next.spec.id);
      if (notice) todo.push(notice);
    }
  } else if (task.status === 'revising') todo.push('PM이 보완을 요청했습니다. 보완본이 오면 다시 알려드립니다.');
  // Written before the PM judges the result: it waits for the review (M12 X3), and the verdict is its own PM line.
  else if (task.status === 'submitted') todo.push('PM 검토 대기');
  // A limitation is not something to do: it gets its own line, and no empty "할 일:" is left (QA4 C6).
  const limits = report.limitations?.map((item) => item.trim()).filter(Boolean) ?? [];
  return [
    `[${task.spec.title}] ${name(task.spec.assignee)} 결과`,
    `무엇이 됐나: ${channelText(plainAgentText(report.summary), state)}`,
    ...(todo.length ? [`할 일: ${todo.join(' ')}`] : []),
    ...(limits.length ? [`확인하지 못한 점: ${limits.join('; ')}`] : []),
    `확인할 곳: ${report.files.length ? report.files.map((file) => file.path).join(', ') : '없음'}`,
  ].join('\n');
}
