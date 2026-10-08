// Text-trigger context queries (issue #78, EXPERIMENT; docs/experiments/figma-78.md). Figma @mentions resolve only
// to real Figma users, so `@ensemble` / `@pm_agent` arrive as plain text in a comment. Such a human comment is a
// question to the PM about the Space; the PM answers in the same thread with the Space goal, decisions and open
// items that overlap the question, each with where it came from. Selection is deterministic keyword overlap (no
// model call); a caller may pass a model-written body instead, the tag line is always code-written.
import { externalConversation, openDecisions, project, type Id, type LedgerEvent } from '@ensemble/core';
import { figmaRequests, type FigmaMentionView, type MentionSelection, type MentionTrigger } from './ledger.ts';

const MENTION = /(^|[^\p{L}\p{N}_@.])@(ensemble|pm_agent)(?![\p{L}\p{N}_])/giu;
const TAG = /\[ensemble-req:[A-Za-z0-9:_-]+\]/g;
const ITEM_MAX = 160;
const QUERY_MAX = 300;
export const MENTION_ANSWER_ITEMS = 6;

/** Which text triggers a comment carries (`@ensemble`, `@pm_agent`; case-insensitive, word boundary). */
export function mentionTriggers(message: string): MentionTrigger[] {
  const found = new Set<MentionTrigger>();
  for (const match of message.matchAll(MENTION)) found.add(match[2]!.toLowerCase() as MentionTrigger);
  return [...found];
}
/** The question with the trigger words and any PM tag removed. */
export function mentionQuery(message: string): string {
  return message.replace(MENTION, '$1').replace(TAG, '').replace(/\s+/g, ' ').trim();
}
/**
 * The line every PM comment ends with. A comment that carries it for this Space was composed by the PM (perhaps a
 * write whose id is not recorded yet), so a mention inside it never triggers an answer.
 */
export const pmSignature = (projectId: Id) => `— Ensemble PM Agent · Space ${projectId} [ensemble-req:`;

export type SpaceContextKind = 'goal' | 'decision' | 'open';
/** One Space item an answer can cite. `source` says where it came from (ledger id and tool). */
export interface SpaceContextItem { kind: SpaceContextKind; id: string; text: string; source: string; seq: number }

interface MeetingNote { noteId: Id; meetingId: Id; kind: string; text: string }

/** Current goal, decisions and open (unresolved) items of the Space, with their sources, from the ledger. */
export function spaceContextItems(events: readonly LedgerEvent[]): SpaceContextItem[] {
  const state = project(events);
  const items = new Map<string, SpaceContextItem>();
  const add = (item: SpaceContextItem) => items.set(`${item.kind}:${item.id}`, item);
  let topics: { considerationId: Id; seq: number } | undefined;
  for (const event of events) {
    const p = event.payload as Record<string, unknown>;
    if (event.type === 'goal_set' && state.goal) add({ kind: 'goal', id: 'goal', text: state.goal.text, source: `Space 목표 (goal_set, 결정권자 ${state.goal.decider})`, seq: event.seq });
    else if (event.type === 'decision_recorded') {
      const d = state.decisions.get(p.decisionId as Id);
      if (d) add({ kind: 'decision', id: d.decisionId, text: d.summary, source: `Space 결정 ${d.decisionId}${d.sourceMessageIds.length ? ` · 메시지 ${d.sourceMessageIds.join(', ')}` : ''}`, seq: event.seq });
    } else if (event.type === 'meeting_note_recorded') {
      const note = p as unknown as MeetingNote;
      if (note.kind === 'decision' || note.kind === 'open') add({ kind: note.kind === 'decision' ? 'decision' : 'open', id: note.noteId, text: note.text, source: `회의 ${note.meetingId} 기록 ${note.noteId}`, seq: event.seq });
    } else if (event.type === 'pm_considered') topics = { considerationId: p.considerationId as Id, seq: event.seq };
  }
  const external = externalConversation(events);
  for (const m of external.messages) {
    const where = `Slack ${m.source.channelId} ${m.source.messageTs} (메시지 ${m.messageId})`;
    const seq = events.find(e => e.type === 'external_message_observed' && (e.payload as { messageId?: Id }).messageId === m.messageId)?.seq ?? 0;
    if (m.kind === 'decision' && m.author.kind !== 'pm') add({ kind: 'decision', id: m.messageId, text: m.text, source: where, seq });
    (m.remaining ?? []).forEach((text, i) => add({ kind: 'open', id: `${m.messageId}#${i + 1}`, text, source: `${where} 남은 일`, seq }));
  }
  for (const r of external.requests.values()) {
    if (r.status !== 'awaiting_response') continue;
    const seq = events.find(e => e.type === 'external_request_sent' && (e.payload as { requestId?: Id }).requestId === r.request.requestId)?.seq ?? 0;
    add({ kind: 'open', id: r.request.requestId, text: r.request.text, source: `Slack 요청 ${r.request.requestId} (${r.request.source.channelId} ${r.request.source.messageTs}) 응답 대기`, seq });
  }
  const label = { decision_requested: 'Space 결정 요청', plan_proposed: '계획 승인 요청', authority_requested: '권한 요청' } as const;
  for (const d of openDecisions(state)) add({ kind: 'open', id: d.requestId, text: d.question, source: `${label[d.source]} ${d.requestId} (답 대기)`, seq: d.requestedSeq ?? 0 });
  if (topics) state.openTopics.forEach((text, i) => add({ kind: 'open', id: `${topics!.considerationId}#${i + 1}`, text, source: `PM 미해결 주제 (pm_considered ${topics!.considerationId})`, seq: topics!.seq }));
  for (const request of figmaRequests(events).values()) {
    for (const f of request.followUps) {
      if (f.reports.some(r => r.outcome === 'applied')) continue;
      add({ kind: 'open', id: f.followUpId, text: f.text, source: `Figma 요청 ${request.requestId} · 답글 ${f.replyCommentId}`, seq: request.seq });
    }
  }
  const order: Record<SpaceContextKind, number> = { decision: 0, open: 1, goal: 2 };
  return [...items.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.seq - b.seq);
}

const STOP = new Set(['the', 'and', 'for', 'what', 'about', 'any', 'this', 'that', '이거', '저거', '그거', '혹시', '관련', '관련해', '어떻게', '무엇', '뭐가', '있어', '있나요', '인가요', '알려', '주세요', '있는지', '이번', '지금']);
const HANGUL = /[ㄱ-ㆎ가-힣]/;
function tokens(text: string): string[] {
  return [...new Set(mentionQuery(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2 && !STOP.has(t)))];
}
/** A query word matches when the item contains it, or (Korean particles, English plurals) a prefix of it. */
function matches(token: string, haystack: string): boolean {
  const min = Math.min(token.length, HANGUL.test(token) ? 2 : 4);
  for (let n = token.length; n >= min; n--) if (haystack.includes(token.slice(0, n))) return true;
  return false;
}

/** Items overlapping the query, best first; with no overlap, the current goal, latest decisions and open items. */
export function selectContextItems(items: readonly SpaceContextItem[], query: string, cap = MENTION_ANSWER_ITEMS): { selection: Exclude<MentionSelection, 'caller'>; items: SpaceContextItem[] } {
  const words = tokens(query);
  const scored = items.map((item, index) => ({ item, index, score: words.filter(w => matches(w, item.text.toLowerCase())).length })).filter(s => s.score > 0);
  if (scored.length) return { selection: 'keyword', items: scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, cap).map(s => s.item) };
  const goal = items.filter(i => i.kind === 'goal');
  const decisions = items.filter(i => i.kind === 'decision').slice(-2);
  const open = items.filter(i => i.kind === 'open').slice(0, cap - goal.length - decisions.length);
  return { selection: 'fallback', items: [...decisions, ...open, ...goal].slice(0, cap) };
}

const KIND_LABEL: Record<SpaceContextKind, string> = { goal: '목표', decision: '결정', open: '미해결' };
const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** The PM's answer to one mention. Caller text (a model draft) replaces the body, never the tag line. */
export function composeMentionAnswer(projectId: Id, mention: Pick<FigmaMentionView, 'mentionId' | 'query'>, items: readonly SpaceContextItem[], text?: string):
  { message: string; selection: MentionSelection; citedItemIds: string[] } {
  const picked = selectContextItems(items, mention.query);
  const custom = text?.replace(TAG, '').trim();
  const body = custom || [
    picked.selection === 'keyword'
      ? `Space 기록에서 질문과 겹치는 항목 ${picked.items.length}개입니다.`
      : 'Space 기록에서 질문과 겹치는 항목이 없어 현재 목표·결정·미해결 항목을 보여 드립니다.',
    `질문: ${clip(mention.query || '(본문 없음)', QUERY_MAX)}`,
    ...(picked.items.length
      ? picked.items.map(i => `- [${KIND_LABEL[i.kind]}] ${clip(i.text.replace(/\s+/g, ' '), ITEM_MAX)} — 출처: ${i.source}`)
      : ['- (Space에 기록된 목표·결정·미해결 항목이 없습니다)']),
    'Space 기록을 읽은 답이며, 디자인 반영 여부를 확인한 것은 아닙니다.',
  ].join('\n');
  return {
    message: `${body}\n\n${pmSignature(projectId)}${mention.mentionId}]`,
    selection: custom ? 'caller' : picked.selection,
    citedItemIds: custom ? [] : picked.items.map(i => i.id),
  };
}
