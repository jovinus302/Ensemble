import { particle, channelText } from './channel-text.ts';
// Task context for the next assignee: the six fixed slots, each item carrying the ID it came from.
// Also the short human-facing summary of an agent result. Pure functions over the ledger; no LLM.
import type { AnyEvent, EventPayloads, Id, LedgerEvent, ProjectState } from '@ensemble/core';
import type { ResultReport, SourcedItem, TaskInstructionsInput } from '@ensemble/agents';

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
  const inputs: SourcedItem[] = [];
  for (const depId of task.spec.dependsOn) {
    const dep = state.tasks.get(depId);
    const result = dep?.checkedResultId ? byResult.get(dep.checkedResultId) : undefined;
    if (!dep || !result) continue;
    inputs.push({ text: `${depId} "${dep.spec.title}" 결과 요약: ${result.summary}`, sourceId: result.resultId });
    for (const path of result.artifactIds) inputs.push({ text: `${depId} 결과 파일: ${path}`, sourceId: `${result.resultId}:${path}` });
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
  };
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
      if (next.status === 'ready' || next.status === 'reserved') todo.push(`@${name(next.spec.assignee)} ${next.spec.title}${particle(next.spec.title)} 시작할 수 있습니다.`);
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
