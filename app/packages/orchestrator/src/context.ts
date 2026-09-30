import { particle, channelText } from './channel-text.ts';
// Task context for the next assignee: the six fixed slots, each item carrying the ID it came from.
// Also the short human-facing summary of an agent result. Pure functions over the ledger; no LLM.
import type { AnyEvent, EventPayloads, Id, LedgerEvent, ProjectState } from '@ensemble/core';
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
  return {
    taskId,
    planVersion,
    goalSummary: { text: goal.deadline ? `${goal.text} (기한 ${goal.deadline})` : goal.text, sourceId: eventId('goal_set') },
    taskTitle: { text: task.spec.title, sourceId: planSource },
    handoffConditions: task.spec.handoffConditions.map((text, i) => ({ text, sourceId: `${planSource}:${taskId}.handoff[${i}]` })),
    decisions: relevantDecisions(state, taskId).map((d) => ({ text: d.summary, sourceId: d.decisionId })),
    inputs: [...inputs, ...conversation(state, events, taskId)],
    openQuestions,
    files: files.flatMap((file) => file.data !== undefined ? [{ path: file.path, data: file.data }] : []),
  };
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
  if (task.status === 'reserved') return `${mention} ${title} 작업이 예약되었습니다. 지금 시작해 주세요.`;
  if (task.status === 'ready') return `${mention} ${title}${particle(title)} 시작할 수 있습니다.`;
  return undefined;
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
  else if (task.status === 'submitted') todo.push('PM이 인계 조건을 확인하는 중입니다.');
  if (report.limitations?.length) todo.push(`확인하지 못한 점: ${report.limitations.join('; ')}`);
  return [
    `[${task.spec.title}] ${name(task.spec.assignee)} 결과`,
    `무엇이 됐나: ${channelText(report.summary, state)}`,
    `할 일: ${todo.length ? todo.join(' ') : '없음'}`,
    `확인할 곳: ${report.files.length ? report.files.map((file) => file.path).join(', ') : '없음'}`,
  ].join('\n');
}
