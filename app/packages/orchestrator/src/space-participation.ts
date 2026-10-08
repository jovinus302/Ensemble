// Personal agents in the Space (issue #81): the common participation path that Figma/Slack/meeting touchpoints (#78–#80)
// reuse. A participant is a person's own agent in the person's own folder; Ensemble never starts or steers it. The Space is
// read and written over HTTP (this module is the logic behind those routes), and the PM reaches the folder only through a
// PersonalWorkspace the person authorized. All writes are ledger events (core/src/participation.ts).
// Grants: a link request grants nothing until a person confirms it with a one-time code shown only on the server console;
// confirming issues the agent's connection token, which every agent call must carry (only its hash is recorded).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { LocalFolderWorkspace, WorkspaceAccessError, type PersonalWorkspace, type WorkspaceInspection } from '@ensemble/agents';
import {
  LINK_REQUEST_TTL_MS, MAX_REQUEST_DEPTH, openRequests, participation, project, requestDepthFor, workStatus,
  type Actor, type Id, type LedgerEvent, type NewLedgerEvent, type ParticipantScopes, type ParticipationPayloads,
  type ParticipationState, type SpacePost, type SpacePostKind,
} from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import type { LedgerStore } from '@ensemble/store';

export type ParticipationErrorCode = 'not_found' | 'forbidden' | 'unauthorized' | 'invalid_input' | 'workspace_unreachable' | 'permission_denied';
export class ParticipationError extends Error {
  readonly status: number;
  constructor(readonly code: ParticipationErrorCode, message: string) {
    super(message);
    this.name = 'ParticipationError';
    this.status = code === 'not_found' ? 404 : code === 'unauthorized' ? 401 : code === 'forbidden' || code === 'permission_denied' ? 403 : code === 'workspace_unreachable' ? 503 : 400;
  }
}

/** What the agent reads from the Space; JSON as is, or rendered by `spaceContextMarkdown`. */
export interface SpaceContext {
  project: { id: Id; goal?: string; deadline?: string };
  participant: { id: Id; displayName: string; tool: string; scopes: ParticipantScopes };
  decisions: { id: Id; summary: string }[];
  tasks: { id: Id; title: string; status: string; assignee: string }[];
  requests: { requestId: Id; text: string; status: string; createdAt: string; taskId?: Id; inbox?: string }[];
  posts: { postId: Id; kind: SpacePostKind; text: string; at: string; inReplyTo?: Id; taskId?: Id }[];
  howToPost: { url: string; headers: Record<string, string>; body: Record<string, string> };
}
export interface ComposeInput {
  participant: ParticipationPayloads['participant_linked'];
  context: SpaceContext;
  trigger: SpacePost;
  /** What the PM itself read in the folder; absent when the person did not grant workspace reading. */
  observation?: WorkspaceInspection;
  depth: number;
}
/** Returns the request text for the personal workspace, or null when no follow-up is needed. */
export type RequestComposer = (input: ComposeInput) => Promise<string | null>;

export interface SpaceParticipationOptions {
  store: LedgerStore;
  projectId: Id;
  targetProductId: Id;
  composer: RequestComposer;
  /** Defaults to the person's local folder with the granted allowlist. */
  workspaceFor?: (link: ParticipationPayloads['participant_linked']) => PersonalWorkspace;
  /** This server's own Space URL (server configuration, trusted). Used when a link carries no local Space URL. */
  defaultSpaceUrl?: string;
  clock?: () => Date;
}
export interface LinkInput {
  participantId: Id; displayName: string; tool: string; workspaceRoot: string; allowedPaths?: string[]; scopes?: Partial<ParticipantScopes>;
  /** Where the agent reaches this Space. Must be a loopback origin (`localSpaceOrigin`); the web route passes the server's own. */
  spaceUrl?: string;
}
/** A pending link. `code` goes to the person out of band (the server console), never to the HTTP caller. */
export interface LinkRequestIssued { linkRequestId: Id; participantId: Id; workspaceRoot: string; allowedPaths: string[]; expiresAt: string; code: string }
export interface PostInput { kind: SpacePostKind; text: string; clientPostId: string; taskId?: Id; inReplyTo?: Id }
export interface RequestInput {
  participantId: Id; text: string;
  /** A person sending through the PM, or the PM itself. */
  actor: Actor;
  triggerPostId?: Id; observationId?: Id; taskId?: Id; depth?: number;
  /** Stable key for this request's cause (e.g. `meeting:<id>:<item>`); a repeated cause creates no second request. */
  dedupeKey?: string;
}
export type LiaisonOutcome = ParticipationPayloads['liaison_considered'] & { delivery?: ParticipationPayloads['personal_request_delivered'] | ParticipationPayloads['personal_request_delivery_failed'] };

const PM: Actor = { kind: 'pm', id: 'pm' };
const KINDS: SpacePostKind[] = ['result', 'question', 'blocked', 'note'];
const DEFAULT_SCOPES: ParticipantScopes = { readSpace: true, post: true, receiveRequests: true, pmReadWorkspace: true };
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const shortHash = (value: string) => sha256(value).slice(0, 16);
/** Wrong codes allowed per link request (per server run) before it must be asked again. */
const MAX_CONFIRM_FAILURES = 5;
// No 0/O or 1/I: the code is read off a console and typed by a person.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { const bytes = randomBytes(8); const c = [...bytes].map(b => CODE_ALPHABET[b % 32]).join(''); return `${c.slice(0, 4)}-${c.slice(4)}`; };
const codeHash = (linkRequestId: Id, code: string) => sha256(`${linkRequestId}:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`);
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/**
 * The agent is told to send its connection token to the Space URL, so that URL must be this machine's own Space: the Space
 * routes answer only loopback callers anyway. Returns the normalized origin of a loopback http(s) URL with no path, query or
 * credentials (localhost, 127.0.0.1, [::1]), or undefined for anything else.
 */
export function localSpaceOrigin(value: string): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? url.origin : undefined;
}
/** Agents send `Authorization: Bearer <token>` on every Space call. */
export const TOKEN_HINT = 'Bearer <연결 토큰>';
const WORK_LABEL: Record<string, string> = { todo: '할 일', in_progress: '진행 중', in_review: '검토 중', waiting_human: '사람 결정 대기', blocked: '막힘', done: '완료', cancelled: '취소' };

export class SpaceParticipation {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly failedConfirms = new Map<Id, number>();
  constructor(private readonly options: SpaceParticipationOptions) {}

  private now() { return (this.options.clock ?? (() => new Date()))(); }
  private event<K extends keyof ParticipationPayloads>(type: K, actor: Actor, payload: ParticipationPayloads[K], idempotencyKey?: string): NewLedgerEvent {
    return { projectId: this.options.projectId, targetProductId: this.options.targetProductId, type, actor, payload, ...(idempotencyKey ? { idempotencyKey } : {}), at: this.now().toISOString() };
  }
  private async read() { return this.options.store.read({ projectId: this.options.projectId }); }
  /** Liaison and delivery touch the person's folder; one at a time keeps attempts and requests ordered. */
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private participant(state: ParticipationState, participantId: Id) {
    const entry = state.participants.get(participantId);
    if (!entry) throw new ParticipationError('not_found', '연결된 개인 Agent를 찾지 못했습니다.');
    return entry;
  }
  /** An agent call: the participant must exist and the token must match the confirmed link's hash. */
  private authenticated(state: ParticipationState, participantId: Id, token: string | undefined) {
    const entry = this.participant(state, participantId);
    const expected = entry.link.tokenHash;
    if (!expected || !token || !sameHash(sha256(token), expected)) {
      throw new ParticipationError('unauthorized', expected
        ? '연결 토큰이 없거나 맞지 않습니다. 연결을 확인할 때 받은 토큰을 Authorization: Bearer 헤더로 보내 주세요.'
        : '이 연결에는 토큰이 없습니다. 대시보드에서 다시 연결해 주세요.');
    }
    return entry;
  }
  private workspace(link: ParticipationPayloads['participant_linked']): PersonalWorkspace {
    return this.options.workspaceFor?.(link) ?? new LocalFolderWorkspace({ root: link.workspaceRoot, allowedPaths: link.allowedPaths });
  }
  /** Where this participant's agent reads the Space and posts (the token goes only there). */
  urls(link: ParticipationPayloads['participant_linked']) {
    // A link recorded before the Space URL was checked may carry a foreign one: never point the agent's token there.
    const base = ((link.spaceUrl && localSpaceOrigin(link.spaceUrl)) || this.options.defaultSpaceUrl || 'http://localhost:3000').replace(/\/+$/, '');
    const root = `${base}/api/space/participants/${encodeURIComponent(link.participantId)}`;
    return { postUrl: `${root}/posts`, contextUrl: `${root}/context?format=md` };
  }

  /**
   * Asks to link an agent and folder. Grants nothing yet: returns a pending request and the one-time code the caller must show
   * the person out of band (the web runtime prints it on the server console, never in the HTTP response).
   */
  async requestLink(input: LinkInput, requestedBy: Id): Promise<LinkRequestIssued> {
    if (!/^[\w.-]{1,64}$/.test(input.participantId)) throw new ParticipationError('invalid_input', '참여자 id는 영문·숫자·-_. 64자 이내로 정해 주세요.');
    if (!input.displayName.trim() || !input.tool.trim()) throw new ParticipationError('invalid_input', '이름과 도구를 입력해 주세요.');
    if (!path.isAbsolute(input.workspaceRoot)) throw new ParticipationError('invalid_input', '작업 폴더는 절대 경로로 입력해 주세요.');
    // Omitted means the whole folder. An explicit list must name something: a blank entry or an empty list is refused, never
    // widened to the default (fail closed: a malformed narrow grant must not become the whole folder).
    if (input.allowedPaths && (!input.allowedPaths.length || input.allowedPaths.some(p => !p.trim()))) throw new ParticipationError('invalid_input', '허용 경로를 비우지 말고 작업 폴더 안의 상대 경로로 입력해 주세요. 폴더 전체는 "."입니다.');
    const allowedPaths = (input.allowedPaths ?? ['.']).map(p => p.trim());
    if (allowedPaths.some(p => path.isAbsolute(p) || path.normalize(p).split(/[\\/]/)[0] === '..')) throw new ParticipationError('invalid_input', '허용 경로는 작업 폴더 안의 상대 경로여야 합니다.');
    const spaceUrl = input.spaceUrl === undefined ? undefined : localSpaceOrigin(input.spaceUrl);
    if (input.spaceUrl !== undefined && !spaceUrl) throw new ParticipationError('invalid_input', 'Space 주소는 이 컴퓨터의 Ensemble 주소(예: http://127.0.0.1:3000)만 쓸 수 있습니다.');
    const linkRequestId = `link-${randomUUID()}`, code = newCode();
    const expiresAt = new Date(this.now().getTime() + LINK_REQUEST_TTL_MS).toISOString();
    await this.options.store.transaction(this.options.projectId, events => {
      const state = project(events);
      if (state.members.get(requestedBy)?.kind !== 'human') throw new ParticipationError('forbidden', '프로젝트의 사람만 개인 Agent를 연결할 수 있습니다.');
      // A participant is not a member: sharing an id would let Space posts pass as the member's own words.
      if (state.members.has(input.participantId)) throw new ParticipationError('invalid_input', '프로젝트 멤버와 같은 id는 쓸 수 없습니다.');
      const payload: ParticipationPayloads['participant_link_requested'] = {
        participantId: input.participantId, displayName: input.displayName.trim(), tool: input.tool.trim(), workspaceRoot: path.resolve(input.workspaceRoot),
        allowedPaths, scopes: { ...DEFAULT_SCOPES, ...input.scopes }, ...(spaceUrl ? { spaceUrl } : {}),
        linkRequestId, requestedBy, codeHash: codeHash(linkRequestId, code), expiresAt,
      };
      return { append: [this.event('participant_link_requested', { kind: 'human', id: requestedBy }, payload)], result: undefined };
    });
    return { linkRequestId, participantId: input.participantId, workspaceRoot: path.resolve(input.workspaceRoot), allowedPaths, expiresAt, code };
  }

  /**
   * A person confirms a pending link with its one-time code (from the dashboard). Activates the grant, replacing any earlier
   * link and token for the participant, and returns the agent's connection token once; the ledger keeps only its hash.
   */
  async confirmLink(linkRequestId: Id, code: string, confirmedBy: Id) {
    const token = `ens_${randomBytes(32).toString('base64url')}`;
    const { result } = await this.options.store.transaction(this.options.projectId, events => {
      if (project(events).members.get(confirmedBy)?.kind !== 'human') throw new ParticipationError('forbidden', '프로젝트의 사람만 개인 Agent 연결을 확인할 수 있습니다.');
      const entry = participation(events).linkRequests.get(linkRequestId);
      if (!entry) throw new ParticipationError('not_found', '연결 요청을 찾지 못했습니다.');
      if (entry.confirmedAt) throw new ParticipationError('invalid_input', '이미 확인한 연결 요청입니다.');
      if ((this.failedConfirms.get(linkRequestId) ?? 0) >= MAX_CONFIRM_FAILURES) throw new ParticipationError('forbidden', `확인 코드를 ${MAX_CONFIRM_FAILURES}번 틀렸습니다. 연결을 다시 요청해 주세요.`);
      if (Date.parse(entry.request.expiresAt) <= this.now().getTime()) throw new ParticipationError('invalid_input', '연결 요청이 만료되었습니다. 다시 요청해 주세요.');
      // Counted here, inside the same synchronous transaction as the admission check above, so concurrent wrong codes cannot
      // all pass the check before any of them is counted.
      if (!sameHash(codeHash(linkRequestId, code), entry.request.codeHash)) { this.failedConfirms.set(linkRequestId, (this.failedConfirms.get(linkRequestId) ?? 0) + 1); return { append: [], result: undefined }; }
      const { linkRequestId: _id, requestedBy: _by, codeHash: _hash, expiresAt: _expires, ...grant } = entry.request;
      const payload: ParticipationPayloads['participant_linked'] = { ...grant, linkedBy: confirmedBy, linkRequestId, tokenHash: sha256(token) };
      return { append: [this.event('participant_linked', { kind: 'human', id: confirmedBy }, payload)], result: payload };
    });
    if (!result) {
      throw new ParticipationError('forbidden', '확인 코드가 맞지 않습니다. 서버 콘솔에 표시된 코드를 입력해 주세요.');
    }
    this.failedConfirms.delete(linkRequestId);
    return { link: result, token, ...this.urls(result) };
  }

  /** Builds what this participant may read. Pure: `readContext` records the read. */
  contextFor(events: readonly LedgerEvent[], participantId: Id): SpaceContext {
    const state = project(events), space = participation(events);
    const { link } = this.participant(space, participantId);
    const urls = this.urls(link);
    const name = (id: Id) => state.members.get(id)?.displayName ?? space.participants.get(id)?.link.displayName ?? id;
    return {
      project: { id: this.options.projectId, ...(state.goal ? { goal: state.goal.text, ...(state.goal.deadline ? { deadline: state.goal.deadline } : {}) } : {}) },
      participant: { id: link.participantId, displayName: link.displayName, tool: link.tool, scopes: link.scopes },
      decisions: [...state.decisions.values()].map(d => ({ id: d.decisionId, summary: d.summary })),
      tasks: [...state.tasks.values()].map(t => ({ task: t, status: workStatus(t, state) })).filter(t => t.status !== 'done' && t.status !== 'cancelled')
        .map(({ task, status }) => ({ id: task.spec.id, title: task.spec.title, status: WORK_LABEL[status] ?? status, assignee: name(task.spec.assignee) })),
      requests: openRequests(space, participantId).map(r => ({ requestId: r.request.requestId, text: r.request.text, status: r.status, createdAt: r.createdAt,
        ...(r.request.taskId ? { taskId: r.request.taskId } : {}), ...(r.delivered ? { inbox: r.delivered.location } : {}) })),
      posts: [...space.posts.values()].filter(p => p.participantId === participantId).slice(-20)
        .map(p => ({ postId: p.postId, kind: p.kind, text: p.text, at: p.at, ...(p.inReplyTo ? { inReplyTo: p.inReplyTo } : {}), ...(p.taskId ? { taskId: p.taskId } : {}) })),
      howToPost: { url: urls.postUrl, headers: { Authorization: TOKEN_HINT }, body: { kind: 'result | question | blocked | note', text: '내용', clientPostId: '같은 글을 다시 보내도 한 번만 남도록 고정한 id', inReplyTo: '(요청에 답할 때) requestId', taskId: '(선택) 작업 id' } },
    };
  }

  /** The agent reads the Space. Records the read and marks listed requests as seen, so arrival is distinguishable from posting. */
  async readContext(participantId: Id, token: string | undefined, format: 'md' | 'json') {
    const { result } = await this.options.store.transaction(this.options.projectId, events => {
      const space = participation(events);
      const { link } = this.authenticated(space, participantId, token);
      if (!link.scopes.readSpace) throw new ParticipationError('forbidden', '이 개인 Agent에는 Space 읽기 권한이 없습니다.');
      const context = this.contextFor(events, participantId);
      const readId = randomUUID();
      const requestIds = context.requests.map(r => r.requestId);
      return { append: [
        this.event('space_context_read', { kind: 'agent', id: participantId }, { participantId, readId, format, requestIds }),
        ...requestIds.filter(id => !space.requests.get(id)?.seenAt).map(requestId => this.event('personal_request_seen', { kind: 'agent', id: participantId }, { requestId, participantId, via: 'space_context' }, `request-seen:${requestId}`)),
      ], result: context };
    });
    return result;
  }

  /** A post written by the agent itself. A repeated `clientPostId` returns the first post; a reply marks its request answered. */
  async post(participantId: Id, token: string | undefined, input: PostInput) {
    if (!KINDS.includes(input.kind)) throw new ParticipationError('invalid_input', 'kind는 result, question, blocked, note 중 하나여야 합니다.');
    if (!input.text.trim()) throw new ParticipationError('invalid_input', '공유할 내용을 입력해 주세요.');
    if (!/^[\w.:-]{1,128}$/.test(input.clientPostId)) throw new ParticipationError('invalid_input', 'clientPostId는 영문·숫자·-_.: 128자 이내여야 합니다.');
    const idempotencyKey = `space-post:${participantId}:${input.clientPostId}`;
    const { result } = await this.options.store.transaction(this.options.projectId, events => {
      const space = participation(events), state = project(events);
      const { link } = this.authenticated(space, participantId, token);
      if (!link.scopes.post) throw new ParticipationError('forbidden', '이 개인 Agent에는 Space 공유 권한이 없습니다.');
      const existing = [...space.posts.values()].find(p => p.participantId === participantId && p.clientPostId === input.clientPostId);
      if (existing) return { append: [], result: { postId: existing.postId, duplicate: true } };
      const request = input.inReplyTo ? space.requests.get(input.inReplyTo) : undefined;
      if (input.inReplyTo && request?.request.participantId !== participantId) throw new ParticipationError('invalid_input', '답하려는 요청을 찾지 못했습니다.');
      if (input.taskId && !state.tasks.has(input.taskId)) throw new ParticipationError('invalid_input', '작업을 찾지 못했습니다.');
      const postId = `post-${shortHash(idempotencyKey)}`;
      const actor: Actor = { kind: 'agent', id: participantId };
      const append = [this.event('space_post_recorded', actor, {
        postId, participantId, kind: input.kind, text: input.text.trim(), clientPostId: input.clientPostId,
        ...(input.taskId ? { taskId: input.taskId } : request?.request.taskId ? { taskId: request.request.taskId } : {}),
        ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        source: { tool: link.tool, workspaceRoot: link.workspaceRoot, via: 'space_http' }, observedAt: this.now().toISOString(),
      }, idempotencyKey)];
      if (request && !request.answer) append.push(this.event('personal_request_answered', actor, { requestId: request.request.requestId, participantId, postId }, `request-answered:${request.request.requestId}`));
      return { append, result: { postId, duplicate: false } };
    });
    return result;
  }

  /** The PM reads the person's folder itself (not what was posted) and records what it saw, file metadata only. */
  async inspect(participantId: Id, paths?: string[]) {
    const space = participation(await this.read());
    const { link, lastObservation } = this.participant(space, participantId);
    if (!link.scopes.pmReadWorkspace) throw new ParticipationError('forbidden', '이 작업 폴더를 PM이 읽도록 허용하지 않았습니다.');
    let inspection: WorkspaceInspection;
    try { inspection = await this.workspace(link).inspect(paths); }
    catch (error) {
      if (error instanceof WorkspaceAccessError) throw new ParticipationError(error.reason === 'permission_denied' ? 'permission_denied' : 'workspace_unreachable', error.message);
      throw error;
    }
    const before = new Map((lastObservation?.files ?? []).map(f => [f.path, f.sha256]));
    const after = new Map(inspection.files.map(f => [f.path, f.sha256]));
    const scoped = !paths?.length;
    const payload: ParticipationPayloads['workspace_context_observed'] = {
      observationId: randomUUID(), participantId, source: 'local_workspace',
      files: inspection.files.map(({ path: p, sha256, bytes, mtime }) => ({ path: p, sha256, bytes, mtime })),
      changes: {
        added: [...after.keys()].filter(p => !before.has(p)),
        modified: [...after].filter(([p, h]) => before.has(p) && before.get(p) !== h).map(([p]) => p),
        // Only a full-allowlist read can tell that a file is gone.
        removed: scoped && !inspection.truncated ? [...before.keys()].filter(p => !after.has(p)) : [],
      },
      truncated: inspection.truncated, rejected: inspection.rejected,
    };
    await this.options.store.append([this.event('workspace_context_observed', PM, payload)]);
    return { observation: payload, inspection };
  }

  /** Records a request for the personal workspace and tries to deliver it once; an undelivered request stays pending. */
  createRequest(input: RequestInput) { return this.serial(() => this.createRequestNow(input)); }
  private async createRequestNow(input: RequestInput) {
    if (!input.text.trim()) throw new ParticipationError('invalid_input', '요청 내용을 입력해 주세요.');
    const requestId = `req-${shortHash(input.dedupeKey ?? randomUUID())}`;
    const { appended } = await this.options.store.transaction(this.options.projectId, events => {
      const space = participation(events), state = project(events);
      this.participant(space, input.participantId);
      if (input.actor.kind === 'human' && state.members.get(input.actor.id)?.kind !== 'human') throw new ParticipationError('forbidden', '프로젝트의 사람만 요청을 보낼 수 있습니다.');
      return { append: [this.event('personal_request_created', input.actor, {
        requestId, participantId: input.participantId, text: input.text.trim(), depth: input.depth ?? 1,
        ...(input.triggerPostId ? { triggerPostId: input.triggerPostId } : {}), ...(input.observationId ? { observationId: input.observationId } : {}), ...(input.taskId ? { taskId: input.taskId } : {}),
      }, input.dedupeKey ? `request-${input.dedupeKey}` : undefined)], result: undefined };
    });
    const created = appended[0]!.payload as ParticipationPayloads['personal_request_created'];
    return { requestId: created.requestId, delivery: await this.deliverNow(created.requestId) };
  }

  /** One delivery attempt. Failure is recorded and the request stays pending for the next sweep. */
  deliver(requestId: Id) { return this.serial(() => this.deliverNow(requestId)); }
  private async deliverNow(requestId: Id) {
    const events = await this.read();
    const space = participation(events);
    const entry = space.requests.get(requestId);
    if (!entry) throw new ParticipationError('not_found', '요청을 찾지 못했습니다.');
    const { request } = entry;
    if (entry.delivered) return { requestId, participantId: request.participantId, location: entry.delivered.location, attempt: entry.attempts };
    const { link } = this.participant(space, request.participantId);
    const attempt = entry.attempts + 1;
    const failed = (reason: ParticipationPayloads['personal_request_delivery_failed']['reason'], detail: string) => ({ requestId, participantId: request.participantId, reason, detail, attempt });
    let outcome: ParticipationPayloads['personal_request_delivered'] | ParticipationPayloads['personal_request_delivery_failed'];
    if (!link.scopes.receiveRequests) outcome = failed('not_permitted', '이 작업 폴더로 요청을 보내도록 허용하지 않았습니다.');
    else {
      const result = await this.workspace(link).deliverRequest({ requestId, projectId: this.options.projectId, participantId: request.participantId, text: request.text,
        reply: { ...this.urls(link), inReplyTo: requestId }, createdAt: entry.createdAt, ...(request.taskId ? { taskId: request.taskId } : {}) })
        .catch((error: unknown) => ({ delivered: false as const, reason: 'error' as const, detail: error instanceof Error ? error.message : 'delivery failed' }));
      outcome = result.delivered ? { requestId, participantId: request.participantId, location: result.location, attempt } : failed(result.reason, result.detail);
    }
    await this.options.store.append(['location' in outcome
      ? this.event('personal_request_delivered', PM, outcome, `request-delivered:${requestId}`)
      : this.event('personal_request_delivery_failed', PM, outcome)]);
    return outcome;
  }

  /**
   * Retries every request the folder has not received yet (explicitly called: on a timer, a reconnect, or by a person).
   * Eligibility is the delivery fact, not the shown status: a request seen in the Space but never written to the folder
   * still needs its folder copy; an answered one does not.
   */
  sweep() {
    return this.serial(async () => {
      const pending = [...participation(await this.read()).requests.values()].filter(r => !r.delivered && !r.answer);
      const results = [];
      for (const r of pending) results.push(await this.deliverNow(r.request.requestId));
      return results;
    });
  }

  /**
   * The PM's step after a participant's post: read the folder, then ask the composer whether the folder needs a follow-up.
   * Loop guards: PM-authored posts and notes never trigger; one consideration (and so at most one request) per post;
   * a thread deeper than MAX_REQUEST_DEPTH stops for a person.
   */
  liaison(postId: Id) { return this.serial(() => this.liaisonNow(postId)); }
  private async liaisonNow(postId: Id): Promise<LiaisonOutcome> {
    const events = await this.read();
    const space = participation(events);
    const post = space.posts.get(postId);
    if (!post) throw new ParticipationError('not_found', 'Space 글을 찾지 못했습니다.');
    const previous = space.considerations.get(postId);
    if (previous) return previous;
    const { link } = this.participant(space, post.participantId);
    const depth = requestDepthFor(space, post);
    const consider = async (outcome: LiaisonOutcome['outcome'], reason: string, extra: { observationId?: Id; requestId?: Id } = {}) => {
      const payload: ParticipationPayloads['liaison_considered'] = { considerationId: randomUUID(), participantId: post.participantId, triggerPostId: postId, outcome, reason, depth, ...extra };
      const [stored] = await this.options.store.append([this.event('liaison_considered', PM, payload, `liaison:${postId}`)]);
      return stored!.payload as ParticipationPayloads['liaison_considered'];
    };
    if (post.actor.kind === 'pm' || post.actor.kind === 'system' || post.actor.id !== post.participantId) return consider('skipped', 'PM이나 시스템이 쓴 글은 요청의 계기가 되지 않습니다');
    if (post.kind === 'note') return consider('skipped', '메모 글은 후속 요청 없이 기록만 합니다');
    if (!link.scopes.receiveRequests) return consider('skipped', '이 작업 폴더는 요청 받기를 허용하지 않았습니다');
    // A request already made for this post (an interrupted earlier run) is finished, not composed again.
    const made = [...space.requests.values()].find(r => r.request.triggerPostId === postId);
    if (made) return { ...(await consider('request', '이 글에 대한 요청이 이미 있습니다', { requestId: made.request.requestId })), delivery: await this.deliverNow(made.request.requestId) };
    if (depth > MAX_REQUEST_DEPTH) return consider('needs_human', `같은 흐름에서 요청이 ${MAX_REQUEST_DEPTH}번 오갔습니다. 다음 요청은 사람이 정합니다`);
    let observation: Awaited<ReturnType<SpaceParticipation['inspect']>> | undefined;
    if (link.scopes.pmReadWorkspace) {
      try { observation = await this.inspect(post.participantId); }
      catch (error) { if (!(error instanceof ParticipationError)) throw error; }
    }
    const context = this.contextFor(await this.read(), post.participantId);
    const text = await this.options.composer({ participant: link, context, trigger: post, ...(observation ? { observation: observation.inspection } : {}), depth });
    const observationId = observation?.observation.observationId;
    if (!text?.trim()) return consider('none', '작업 폴더와 글을 확인했고 보낼 후속 요청이 없습니다', observationId ? { observationId } : {});
    const created = await this.createRequestNow({ participantId: post.participantId, text, actor: PM, triggerPostId: postId, depth, dedupeKey: `from:${postId}`,
      ...(observationId ? { observationId } : {}), ...(post.taskId ? { taskId: post.taskId } : {}) });
    const considered = await consider('request', observation ? '작업 폴더의 실제 파일을 확인하고 후속 요청을 보냈습니다' : '작업 폴더를 읽지 못해 글만 보고 후속 요청을 보냈습니다',
      { requestId: created.requestId, ...(observationId ? { observationId } : {}) });
    return { ...considered, delivery: created.delivery };
  }
}

/** Renders the Space context for an agent: plain Markdown with the exact post instructions. */
export function spaceContextMarkdown(context: SpaceContext): string {
  const lines = [
    `# Ensemble Space — ${context.participant.displayName}`, '',
    `프로젝트: ${context.project.id}`, `목표: ${context.project.goal ?? '(아직 없음)'}${context.project.deadline ? ` (기한 ${context.project.deadline})` : ''}`, '',
    '## 결정', ...(context.decisions.length ? context.decisions.map(d => `- ${d.summary}`) : ['- (아직 없음)']), '',
    '## 열린 작업', ...(context.tasks.length ? context.tasks.map(t => `- [${t.status}] ${t.title} — 담당 ${t.assignee} (id: ${t.id})`) : ['- (아직 없음)']), '',
    '## 나에게 온 PM 요청', ...(context.requests.length ? context.requests.flatMap(r => [`- requestId: ${r.requestId} (${r.status}, ${r.createdAt})${r.inbox ? ` — 요청 파일: ${r.inbox}` : ''}`, ...r.text.split('\n').map(l => `  > ${l}`)]) : ['- (없음)']), '',
    '## 내가 남긴 글', ...(context.posts.length ? context.posts.map(p => `- ${p.at} [${p.kind}] ${p.text.replace(/\s+/g, ' ').slice(0, 200)}${p.inReplyTo ? ` (답: ${p.inReplyTo})` : ''}`) : ['- (없음)']), '',
    '## 공유하는 방법', '',
    `POST ${context.howToPost.url}`, 'Content-Type: application/json', ...Object.entries(context.howToPost.headers).map(([k, v]) => `${k}: ${v}`), '',
    '```json', JSON.stringify(context.howToPost.body, null, 2), '```', '',
    'PM 요청에 답할 때는 `inReplyTo`에 requestId를 넣으세요. 같은 `clientPostId`는 한 번만 기록됩니다.',
    '맥락을 읽을 때와 글을 남길 때 모두 연결을 확인할 때 받은 토큰을 `Authorization: Bearer <토큰>` 헤더로 보냅니다. 토큰은 이 문서에 다시 나오지 않습니다.', '',
  ];
  return lines.join('\n');
}

/** Default composer for a model-backed PM: one plain-text completion, `NONE` meaning no follow-up. */
export function llmRequestComposer(llm: LlmProvider, model: string): RequestComposer {
  const system = [
    '너는 Ensemble 프로젝트의 PM Agent다. 사람의 개인 Agent가 자기 작업 폴더에서 일하고 Space에 글을 남겼다.',
    '너는 그 글과, 네가 직접 읽은 그 사람 작업 폴더의 실제 파일(허용된 범위)을 받는다.',
    '그 작업 폴더로 보낼 후속 질문이나 변경 요청이 필요한지 판단한다.',
    '필요하면 요청 본문만 한국어로 쓴다: 무엇을 어느 파일에서 왜(목표·결정 근거) 하는지 2~6문장. 질문 글이면 목표·결정으로 답할 수 있는 만큼 답하고 그에 따른 할 일을 요청한다.',
    '목표·결정에 근거가 없는 사실을 지어내지 않는다. 사람만 정할 수 있는 결정이면 그렇다고 쓰고 그 사이 할 수 있는 일만 요청한다.',
    '후속 요청이 필요 없으면(예: 요청에 대한 답으로 일이 끝났다) 정확히 NONE 한 단어만 출력한다. 다른 설명은 붙이지 않는다.',
  ].join('\n');
  return async ({ participant, context, trigger, observation, depth }) => {
    const facts = {
      goal: context.project.goal, decisions: context.decisions, openTasks: context.tasks,
      participant: { id: participant.participantId, displayName: participant.displayName, tool: participant.tool },
      trigger: { kind: trigger.kind, text: trigger.text, inReplyTo: trigger.inReplyTo ?? null, taskId: trigger.taskId ?? null }, depth,
      previousRequests: context.requests.map(r => ({ requestId: r.requestId, text: r.text, status: r.status })),
      workspace: observation ? observation.files.map(f => ({ path: f.path, bytes: f.bytes, sha256: f.sha256.slice(0, 12), content: f.content ?? null, contentTruncated: !!f.contentTruncated })) : null,
    };
    const response = await llm.complete({ model, system, maxTokens: 800, messages: [{ role: 'user', content: JSON.stringify(facts) }] });
    const text = response.text.trim();
    return !text || /^NONE\.?$/i.test(text) ? null : text;
  };
}

/** Deterministic composer for the rule-based demo PM: questions and blockers get one follow-up naming the files it read. */
export const ruleRequestComposer: RequestComposer = async ({ context, trigger, observation }) => {
  if (trigger.inReplyTo || (trigger.kind !== 'question' && trigger.kind !== 'blocked')) return null;
  const files = observation?.files.map(f => f.path).slice(0, 8) ?? [];
  return [
    `${trigger.kind === 'question' ? '질문' : '막힘'}을 확인했습니다: "${trigger.text.replace(/\s+/g, ' ').slice(0, 200)}"`,
    context.project.goal ? `현재 목표는 "${context.project.goal}"입니다.` : '',
    files.length ? `PM이 작업 폴더에서 확인한 파일: ${files.join(', ')}.` : '',
    '목표와 결정 기준으로 진행할 수 있는 만큼 이어서 작업하고, 바꾼 파일과 남은 확인 사항을 이 요청의 답으로 남겨 주세요.',
  ].filter(Boolean).join('\n');
};
