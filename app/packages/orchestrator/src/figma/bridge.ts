// PM Agent ↔ Figma comment round trip for one Space (issue #78, EXPERIMENT; docs/experiments/figma-78.md).
// Flow: a Figma link + question enters the Space (or a Space decision is relayed) → the PM reads the file/frame
// and its comments itself → posts one tagged comment on that frame → polls the thread → each new reply becomes
// an open follow-up in the Space ledger. Every Figma call happens outside a ledger transaction; every record is
// keyed so re-running a step never duplicates work. The PM never answers comments, so it cannot loop on its own.
import { createHash, randomUUID } from 'node:crypto';
import { project, type ActorKind, type EventContext, type Id, type LedgerEvent, type NewLedgerEvent, type ProjectState } from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import { FigmaApiError, type FigmaClient, type FigmaComment, type FigmaFileSnapshot, type FigmaUser } from './client.ts';
import { parseFigmaLink } from './link.ts';
import { figmaRequests, type FigmaEventPayloads, type FigmaEventType, type FigmaFollowUp, type FigmaOrigin, type FigmaRequestView, type FigmaStage } from './ledger.ts';

export class FigmaBridgeError extends Error {
  readonly status: number;
  constructor(readonly code: 'not_found' | 'forbidden' | 'invalid_state' | 'invalid_input', message: string) {
    super(message);
    this.name = 'FigmaBridgeError';
    this.status = code === 'not_found' ? 404 : code === 'forbidden' ? 403 : code === 'invalid_input' ? 400 : 409;
  }
}

export interface FigmaBridgeOptions extends EventContext {
  store: LedgerStore;
  client: FigmaClient;
  clock?: () => Date;
}
export interface ShareFigmaLinkInput {
  url: string; question: string;
  /** Space member who shared (a personal Agent or a person). */
  sharedBy: Id;
  /** The person the sharing Agent works for. */
  onBehalfOf?: Id;
  /** The Space message that carried the link, when there is one (#81). */
  sourceMessageId?: Id;
}
export interface PollResult { view: FigmaRequestView; newReplies: number; skippedOwn: number; duplicates: number }

const PM = { kind: 'pm' as const, id: 'pm' };
const QUESTION_MAX = 2_000;
const QUOTE_MAX = 500;
const TAG = /\[ensemble-req:[A-Za-z0-9:_-]+\]/g;
/** Machine tag that ties a Figma comment to its Space request. */
export const pmTag = (requestId: Id) => `[ensemble-req:${requestId}]`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

function figmaEvent<K extends FigmaEventType>(context: EventContext, type: K, payload: FigmaEventPayloads[K], actor: { kind: ActorKind; id: Id } = PM, idempotencyKey?: string): NewLedgerEvent {
  return { ...context, type, actor, payload, ...(idempotencyKey ? { idempotencyKey } : {}) };
}

export class FigmaBridge {
  private readonly context: EventContext;
  private self?: FigmaUser;
  private readonly locks = new Map<Id, Promise<unknown>>();

  constructor(private readonly options: FigmaBridgeOptions) {
    this.context = { projectId: options.projectId, targetProductId: options.targetProductId };
  }

  /** Step 1: a Figma link and a question enter the Space. The same share received again returns the same request. */
  async shareLink(input: ShareFigmaLinkInput): Promise<{ requestId: Id; duplicate: boolean }> {
    const link = parseFigmaLink(input.url);
    if (!link) throw new FigmaBridgeError('invalid_input', 'figma.com 파일/프레임 링크가 아닙니다.');
    const question = input.question.trim();
    if (!question || question.length > QUESTION_MAX) throw new FigmaBridgeError('invalid_input', `질문은 1~${QUESTION_MAX}자여야 합니다.`);
    const origin: FigmaOrigin = { kind: 'shared_link', sharedBy: input.sharedBy, ...(input.onBehalfOf ? { onBehalfOf: input.onBehalfOf } : {}), ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}) };
    const requestId = `figma-${hash(['shared_link', link.fileKey, link.nodeId ?? '', question, input.sharedBy, input.sourceMessageId ?? '']).slice(0, 16)}`;
    return this.open(requestId, { requestId, origin, url: link.url, fileKey: link.fileKey, ...(link.nodeId ? { nodeId: link.nodeId } : {}), question }, state => {
      const member = state.members.get(input.sharedBy);
      if (!member) throw new FigmaBridgeError('forbidden', `${input.sharedBy}은(는) 이 Space의 참여자가 아닙니다.`);
      if (input.onBehalfOf && state.members.get(input.onBehalfOf)?.kind !== 'human') throw new FigmaBridgeError('invalid_input', `${input.onBehalfOf}은(는) 이 Space의 사람 참여자가 아닙니다.`);
      if (input.sourceMessageId && !state.messages.some(m => m.messageId === input.sourceMessageId)) throw new FigmaBridgeError('invalid_input', `메시지 ${input.sourceMessageId}가 이 Space에 없습니다.`);
      return { kind: member.kind, id: input.sharedBy };
    });
  }

  /** Space → Figma: a recorded Space decision is carried to the linked frame. */
  async relayDecision(input: { url: string; decisionId: Id }): Promise<{ requestId: Id; duplicate: boolean }> {
    const link = parseFigmaLink(input.url);
    if (!link) throw new FigmaBridgeError('invalid_input', 'figma.com 파일/프레임 링크가 아닙니다.');
    const requestId = `figma-${hash(['space_decision', input.decisionId, link.fileKey, link.nodeId ?? '']).slice(0, 16)}`;
    let question = '';
    return this.open(requestId, () => ({ requestId, origin: { kind: 'space_decision', decisionId: input.decisionId }, url: link.url, fileKey: link.fileKey, ...(link.nodeId ? { nodeId: link.nodeId } : {}), question }), state => {
      const decision = state.decisions.get(input.decisionId);
      if (!decision) throw new FigmaBridgeError('not_found', `결정 ${input.decisionId}이(가) 이 Space에 없습니다.`);
      question = clip(decision.summary, QUESTION_MAX);
      return PM;
    });
  }

  /** Step 2: the PM reads the Space context and the file/frame and its comments itself. */
  async inspect(requestId: Id): Promise<FigmaRequestView> {
    const request = await this.view(requestId);
    const observedAt = this.now();
    const me = await this.me(request, observedAt);
    if (!me) return this.view(requestId);
    const nodeIds = request.nodeId ? [request.nodeId] : [];
    let snapshot: FigmaFileSnapshot;
    try { snapshot = await this.options.client.file(request.fileKey, nodeIds); }
    catch (error) { await this.fail(requestId, 'file', error, observedAt); return this.view(requestId); }
    let comments: FigmaComment[];
    try { comments = await this.options.client.comments(request.fileKey); }
    catch (error) { await this.fail(requestId, 'comments', error, observedAt); return this.view(requestId); }
    await this.options.store.transaction(this.context.projectId, events => {
      const state = project(events);
      return { result: undefined, append: [figmaEvent(this.context, 'figma_inspected', {
        inspectionId: randomUUID(), requestId, fileKey: request.fileKey, fileName: snapshot.name, version: snapshot.version, lastModified: snapshot.lastModified, observedAt,
        nodes: nodeIds.map(id => { const node = snapshot.nodes[id]; return node ? { id, found: true, name: node.name, type: node.type } : { id, found: false }; }),
        relatedCommentIds: comments.filter(c => !c.parentId && (!request.nodeId || c.nodeId === request.nodeId)).map(c => c.id),
        pm: me, space: { ...(state.goal ? { goal: state.goal.text } : {}), decisionIds: [...state.decisions.keys()] },
      })] };
    });
    return this.view(requestId);
  }

  /**
   * Step 3: post one comment on the inspected frame. Delivered only when Figma returns a comment id. A write
   * with an unknown outcome is reconciled against the file's comments before anything is posted again.
   */
  deliver(requestId: Id, input: { text?: string } = {}): Promise<FigmaRequestView> {
    return this.locked(requestId, async () => {
      const view = await this.view(requestId);
      if (view.delivery) return view;
      if (!view.inspection || view.status === 'opened' || view.status === 'access_failed' || view.status === 'frame_not_found')
        throw new FigmaBridgeError('invalid_state', `확인하지 못한 프레임에는 댓글을 남기지 않습니다 (상태: ${view.status}).`);
      const at = this.now();
      const me = await this.me(view, at);
      if (!me) return this.view(requestId);
      const unknownAttempt = view.pendingAttempt?.attemptId;
      if (unknownAttempt) {
        let comments: FigmaComment[];
        try { comments = await this.options.client.comments(view.fileKey); }
        catch (error) { await this.fail(requestId, 'comments', error, at); return this.view(requestId); }
        const found = comments.find(c => !c.parentId && c.user.id === me.id && c.message.includes(pmTag(requestId)));
        if (found) {
          await this.options.store.append([this.posted(view, unknownAttempt, found, true)]);
          return this.view(requestId);
        }
      }
      const state = project(await this.options.store.read({ projectId: this.context.projectId }));
      const message = composeComment(this.context, state, view, input.text);
      const attemptId = randomUUID();
      await this.options.store.append([figmaEvent(this.context, 'figma_comment_attempted', { requestId, attemptId, inspectionId: view.inspection.inspectionId, fileKey: view.fileKey, ...(view.nodeId ? { nodeId: view.nodeId } : {}), message }, PM, `figma-attempt:${attemptId}`)]);
      try {
        const comment = await this.options.client.postComment(view.fileKey, { message, ...(view.nodeId ? { nodeId: view.nodeId } : {}) });
        await this.options.store.append([this.posted(view, attemptId, comment, false)]);
      } catch (error) {
        const e = error instanceof FigmaApiError ? error : undefined;
        await this.options.store.append([figmaEvent(this.context, 'figma_comment_failed', {
          requestId, attemptId, kind: e?.kind ?? 'unknown', ...(e?.status ? { status: e.status } : {}), detail: clip(errorText(error), 300), ambiguous: e ? e.ambiguous : true,
        }, PM, `figma-failed:${attemptId}`)]);
      }
      return this.view(requestId);
    });
  }

  /**
   * Step 4: read the PM comment's thread. New replies from others become open follow-ups in the Space; replies
   * already recorded and the PM's own tagged comments are skipped.
   */
  pollReplies(requestId: Id): Promise<PollResult> {
    return this.locked(requestId, async () => {
      const view = await this.view(requestId);
      const delivery = view.delivery;
      if (!delivery) throw new FigmaBridgeError('invalid_state', `아직 Figma에 전달되지 않은 요청입니다 (상태: ${view.status}).`);
      const observedAt = this.now();
      const me = await this.me(view, observedAt);
      if (!me) return { view: await this.view(requestId), newReplies: 0, skippedOwn: 0, duplicates: 0 };
      let comments: FigmaComment[];
      try { comments = await this.options.client.comments(view.fileKey); }
      catch (error) { await this.fail(requestId, 'comments', error, observedAt); return { view: await this.view(requestId), newReplies: 0, skippedOwn: 0, duplicates: 0 }; }
      const thread = comments.filter(c => c.parentId === delivery.commentId && c.id !== delivery.commentId);
      const own = thread.filter(c => c.user.id === me.id && c.message.includes('[ensemble-req:'));
      const others = thread.filter(c => !own.includes(c));
      const { result } = await this.options.store.transaction(this.context.projectId, events => {
        const known = new Set(figmaRequests(events).get(requestId)?.replies.map(r => r.commentId));
        const fresh = others.filter(c => !known.has(c.id));
        return { result: { fresh: fresh.length, duplicates: others.length - fresh.length }, append: fresh.flatMap(c => {
          const author = { ...c.user };
          return [
            figmaEvent(this.context, 'figma_reply_received', { requestId, commentId: c.id, parentId: delivery.commentId, fileKey: view.fileKey, author, message: c.message, createdAt: c.createdAt, observedAt, sameAccountAsPm: c.user.id === me.id }, PM, `figma-reply:${view.fileKey}:${c.id}`),
            figmaEvent(this.context, 'figma_followup_linked', { followUpId: `figma-followup:${view.fileKey}:${c.id}`, requestId, replyCommentId: c.id, text: clip(c.message, QUESTION_MAX), author, verification: 'claimed' }, PM, `figma-followup:${view.fileKey}:${c.id}`),
          ];
        }) };
      });
      return { view: await this.view(requestId), newReplies: result.fresh, skippedOwn: own.length, duplicates: result.duplicates };
    });
  }

  /**
   * The PM re-reads the file after a reply. A changed version is "changed, content not judged"; nothing here marks
   * a design as reflected.
   */
  async recheck(followUpId: Id): Promise<FigmaFollowUp> {
    const { request, followUp } = await this.followUp(followUpId);
    if (!request.delivery) throw new FigmaBridgeError('invalid_state', '전달되지 않은 요청입니다.');
    const before = request.inspection?.inspectionId;
    const view = await this.inspect(request.requestId);
    const inspection = view.inspection;
    if (!inspection || inspection.inspectionId === before) throw new FigmaBridgeError('invalid_state', `파일을 다시 확인하지 못했습니다: ${view.problem?.detail ?? view.status}`);
    const events = await this.options.store.read({ projectId: this.context.projectId });
    const baseline = events.find((e): e is LedgerEvent<'figma_inspected', FigmaEventPayloads['figma_inspected']> =>
      e.type === 'figma_inspected' && (e.payload as FigmaEventPayloads['figma_inspected']).inspectionId === request.delivery?.inspectionId)?.payload;
    if (!baseline) throw new FigmaBridgeError('invalid_state', '댓글을 남길 때의 확인 기록이 없습니다.');
    const changed = baseline.version !== inspection.version || baseline.lastModified !== inspection.lastModified;
    await this.options.store.append([figmaEvent(this.context, 'figma_followup_rechecked', {
      followUpId: followUp.followUpId, requestId: request.requestId, inspectionId: inspection.inspectionId, baselineVersion: baseline.version, observedVersion: inspection.version,
      observedAt: inspection.observedAt, verification: changed ? 'file_changed_unconfirmed' : 'no_change_observed',
    })]);
    return (await this.followUp(followUpId)).followUp;
  }

  /** Step 5 (claim only): a member reports applying the follow-up or being blocked. */
  async reportFollowUp(followUpId: Id, input: { by: Id; outcome: 'applied' | 'blocked'; note: string }): Promise<FigmaFollowUp> {
    await this.followUp(followUpId);
    const note = input.note.trim();
    if (!note) throw new FigmaBridgeError('invalid_input', '반영 결과나 막힘을 한 문장 이상 남겨 주세요.');
    await this.options.store.transaction(this.context.projectId, events => {
      const member = project(events).members.get(input.by);
      if (!member) throw new FigmaBridgeError('forbidden', `${input.by}은(는) 이 Space의 참여자가 아닙니다.`);
      return { result: undefined, append: [figmaEvent(this.context, 'figma_followup_reported', { followUpId, by: input.by, outcome: input.outcome, note },
        { kind: member.kind, id: input.by }, `figma-report:${followUpId}:${hash([input.by, input.outcome, note]).slice(0, 16)}`)] };
    });
    return (await this.followUp(followUpId)).followUp;
  }

  async view(requestId: Id): Promise<FigmaRequestView> {
    const view = figmaRequests(await this.options.store.read({ projectId: this.context.projectId })).get(requestId);
    if (!view) throw new FigmaBridgeError('not_found', `Figma 요청 ${requestId}이(가) 없습니다.`);
    return view;
  }

  async list(): Promise<FigmaRequestView[]> {
    return [...figmaRequests(await this.options.store.read({ projectId: this.context.projectId })).values()].sort((a, b) => a.seq - b.seq);
  }

  private async open(requestId: Id, payload: FigmaEventPayloads['figma_request_opened'] | (() => FigmaEventPayloads['figma_request_opened']),
    authorize: (state: ProjectState) => { kind: ActorKind; id: Id }): Promise<{ requestId: Id; duplicate: boolean }> {
    const { result } = await this.options.store.transaction(this.context.projectId, events => {
      const actor = authorize(project(events));
      if (figmaRequests(events).has(requestId)) return { result: true, append: [] };
      return { result: false, append: [figmaEvent(this.context, 'figma_request_opened', typeof payload === 'function' ? payload() : payload, actor, `figma-open:${requestId}`)] };
    });
    return { requestId, duplicate: result };
  }

  private posted(view: FigmaRequestView, attemptId: Id, comment: FigmaComment, reconciled: boolean): NewLedgerEvent {
    return figmaEvent(this.context, 'figma_comment_posted', {
      requestId: view.requestId, attemptId, commentId: comment.id, fileKey: view.fileKey, ...(view.nodeId ? { nodeId: view.nodeId } : {}),
      author: { ...comment.user }, createdAt: comment.createdAt, reconciled,
    }, PM, `figma-posted:${view.requestId}`);
  }

  private async me(view: FigmaRequestView, at: string): Promise<FigmaUser | undefined> {
    if (this.self) return this.self;
    try { this.self = await this.options.client.me(); return this.self; }
    catch (error) { await this.fail(view.requestId, 'me', error, at); return undefined; }
  }

  private async fail(requestId: Id, stage: FigmaStage, error: unknown, observedAt: string): Promise<void> {
    const e = error instanceof FigmaApiError ? error : undefined;
    await this.options.store.append([figmaEvent(this.context, 'figma_access_failed', {
      requestId, stage, kind: e?.kind ?? 'unknown', ...(e?.status ? { status: e.status } : {}), detail: clip(errorText(error), 300), observedAt,
    })]);
  }

  private async followUp(followUpId: Id): Promise<{ request: FigmaRequestView; followUp: FigmaFollowUp }> {
    for (const request of await this.list()) {
      const followUp = request.followUps.find(f => f.followUpId === followUpId);
      if (followUp) return { request, followUp };
    }
    throw new FigmaBridgeError('not_found', `후속 항목 ${followUpId}이(가) 없습니다.`);
  }

  /** One Figma write per request at a time in this process. */
  private locked<T>(requestId: Id, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(requestId) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.locks.set(requestId, run);
    return run;
  }

  private now(): string { return (this.options.clock?.() ?? new Date()).toISOString(); }
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Code-written comment. It states what the PM actually looked at (frame and file version) and ends with the
 * Space/request tag. Caller text (e.g. a model draft) replaces the body but never the tag.
 */
export function composeComment(context: EventContext, state: ProjectState, view: FigmaRequestView, text?: string): string {
  const inspection = view.inspection;
  const node = inspection?.nodes[0];
  const scope = `${node?.name ? `프레임 "${node.name}" (${node.id})` : '파일 전체'} · 파일 버전 ${inspection?.version ?? '?'}`;
  const quote = clip(view.question, QUOTE_MAX);
  const body = text?.replace(TAG, '').trim() || (view.origin.kind === 'shared_link'
    ? [
      `${state.members.get(view.origin.sharedBy)?.displayName ?? view.origin.sharedBy}이(가) Ensemble Space에 공유한 질문을 확인하려고 합니다.`,
      `질문: ${quote}`,
      `확인한 범위: ${scope}`,
      ...(state.goal ? [`Space 목표: ${clip(state.goal.text, 200)}`] : []),
      '이 프레임 기준의 답을 이 댓글 스레드에 남겨 주세요.',
    ].join('\n')
    : [
      `Ensemble Space에서 결정이 바뀌었습니다: ${quote}`,
      `확인한 범위: ${scope}`,
      '이 프레임에 반영이 필요한지, 필요하면 언제 반영할지 이 댓글 스레드에 답해 주세요.',
    ].join('\n'));
  return `${body}\n\n— Ensemble PM Agent · Space ${context.projectId} ${pmTag(view.requestId)}`;
}
