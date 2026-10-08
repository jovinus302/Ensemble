// Figma transport (issue #78, EXPERIMENT). The bridge depends only on `FigmaClient`; `FigmaRestClient` is the
// real REST path and `FakeFigma` (fake.ts) the in-memory one. The token is read once and never put in an error,
// a log line or an enumerable field.
export interface FigmaUser { id: string; handle: string }
export interface FigmaNodeSummary { id: string; name: string; type: string }
export interface FigmaFileSnapshot {
  fileKey: string; name: string; version: string; lastModified: string;
  /** Requested node ids; null when the file has no such node (or it is not visible to this token). */
  nodes: Record<string, FigmaNodeSummary | null>;
}
export interface FigmaComment {
  id: string;
  /** Root comment id when this is a reply. */
  parentId?: string;
  user: FigmaUser;
  message: string;
  createdAt: string;
  resolvedAt?: string;
  /** Anchored frame, when the comment carries a FrameOffset. */
  nodeId?: string;
}
export interface PostCommentInput {
  message: string;
  /** Root comment to reply to. Figma rejects replies to replies. */
  replyTo?: string;
  /** Anchor a root comment on this frame. */
  nodeId?: string;
}
export interface FigmaClient {
  me(): Promise<FigmaUser>;
  file(fileKey: string, nodeIds: readonly string[]): Promise<FigmaFileSnapshot>;
  comments(fileKey: string): Promise<FigmaComment[]>;
  postComment(fileKey: string, input: PostCommentInput): Promise<FigmaComment>;
}

export type FigmaErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'bad_request' | 'server' | 'network' | 'invalid_response';
export class FigmaApiError extends Error {
  constructor(
    readonly kind: FigmaErrorKind,
    message: string,
    readonly status?: number,
    /** A write whose outcome is unknown (network failure or 5xx): it may exist on Figma. Reconcile before retrying. */
    readonly ambiguous = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'FigmaApiError';
  }
}

export const FIGMA_TOKEN_ENV = 'FIGMA_ACCESS_TOKEN';
/** Accepted alias, checked after `FIGMA_ACCESS_TOKEN`. */
export const FIGMA_TOKEN_ENV_ALIAS = 'FIGMA_TOKEN';
const DETAIL_MAX = 200;

function kindFor(status: number): FigmaErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;

export function toUser(raw: unknown): FigmaUser {
  const user = record(raw);
  const id = text(user.id);
  if (!id) throw new FigmaApiError('invalid_response', 'Figma user without id');
  return { id, handle: text(user.handle) ?? id };
}

export function toComment(raw: unknown): FigmaComment {
  const comment = record(raw);
  const id = text(comment.id);
  if (!id || typeof comment.message !== 'string') throw new FigmaApiError('invalid_response', 'Figma comment without id or message');
  const meta = record(comment.client_meta);
  const parentId = text(comment.parent_id);
  const resolvedAt = text(comment.resolved_at);
  const nodeId = text(meta.node_id);
  return {
    id, user: toUser(comment.user), message: comment.message, createdAt: text(comment.created_at) ?? '',
    ...(parentId ? { parentId } : {}), ...(resolvedAt ? { resolvedAt } : {}), ...(nodeId ? { nodeId } : {}),
  };
}

export interface FigmaRestOptions { token: string; fetch?: typeof fetch; baseUrl?: string }

export class FigmaRestClient implements FigmaClient {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;

  constructor(options: FigmaRestOptions) {
    if (!options.token) throw new Error(`Figma token is empty; set ${FIGMA_TOKEN_ENV}`);
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#baseUrl = (options.baseUrl ?? 'https://api.figma.com').replace(/\/$/, '');
  }

  /** Refuses to build without the env var; there is no fallback credential. */
  static fromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): FigmaRestClient {
    const token = env[FIGMA_TOKEN_ENV] || env[FIGMA_TOKEN_ENV_ALIAS];
    if (!token) throw new Error(`${FIGMA_TOKEN_ENV} (or ${FIGMA_TOKEN_ENV_ALIAS}) is not set`);
    return new FigmaRestClient({ token, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  async me(): Promise<FigmaUser> {
    return toUser(await this.request('GET', '/v1/me'));
  }

  async file(fileKey: string, nodeIds: readonly string[]): Promise<FigmaFileSnapshot> {
    const key = encodeURIComponent(fileKey);
    if (!nodeIds.length) {
      const body = record(await this.request('GET', `/v1/files/${key}?depth=1`));
      return { fileKey, ...this.fileHeader(body), nodes: {} };
    }
    const query = new URLSearchParams({ ids: nodeIds.join(','), depth: '1' });
    const body = record(await this.request('GET', `/v1/files/${key}/nodes?${query}`));
    const nodes: Record<string, FigmaNodeSummary | null> = {};
    const raw = record(body.nodes);
    for (const id of nodeIds) {
      const doc = record(record(raw[id]).document);
      const name = text(doc.name);
      nodes[id] = raw[id] && name !== undefined ? { id: text(doc.id) ?? id, name, type: text(doc.type) ?? 'UNKNOWN' } : null;
    }
    return { fileKey, ...this.fileHeader(body), nodes };
  }

  /** First top-level FRAME of the first page, for links without a node id. Read-only. */
  async firstFrame(fileKey: string): Promise<FigmaNodeSummary | null> {
    const body = record(await this.request('GET', `/v1/files/${encodeURIComponent(fileKey)}?depth=2`));
    const pages = record(body.document).children;
    const page = Array.isArray(pages) ? record(pages[0]) : {};
    const frame = Array.isArray(page.children) ? page.children.map(record).find(node => node.type === 'FRAME' && text(node.id)) : undefined;
    return frame ? { id: text(frame.id)!, name: text(frame.name) ?? '', type: 'FRAME' } : null;
  }

  async comments(fileKey: string): Promise<FigmaComment[]> {
    const body = record(await this.request('GET', `/v1/files/${encodeURIComponent(fileKey)}/comments`));
    if (!Array.isArray(body.comments)) throw new FigmaApiError('invalid_response', 'Figma comments response without a comments array');
    return body.comments.map(toComment);
  }

  async postComment(fileKey: string, input: PostCommentInput): Promise<FigmaComment> {
    const body: Record<string, unknown> = { message: input.message };
    if (input.replyTo) body.comment_id = input.replyTo;
    else if (input.nodeId) body.client_meta = { node_id: input.nodeId, node_offset: { x: 0, y: 0 } };
    return toComment(await this.request('POST', `/v1/files/${encodeURIComponent(fileKey)}/comments`, body));
  }

  private fileHeader(body: Record<string, unknown>): Omit<FigmaFileSnapshot, 'fileKey' | 'nodes'> {
    const version = text(body.version);
    const lastModified = text(body.lastModified);
    if (!version || !lastModified) throw new FigmaApiError('invalid_response', 'Figma file response without version or lastModified');
    return { name: text(body.name) ?? '', version, lastModified };
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const write = method === 'POST';
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: { 'X-Figma-Token': this.#token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new FigmaApiError('network', `Figma ${method} ${path.split('?')[0]} failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, DETAIL_MAX * 2), undefined, write);
    }
    const raw = await response.text().catch(() => '');
    if (!response.ok) {
      let detail = raw;
      try { const parsed = record(JSON.parse(raw)); detail = text(parsed.err) ?? text(parsed.message) ?? raw; } catch { /* keep raw text */ }
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new FigmaApiError(kindFor(response.status), `Figma ${method} ${path.split('?')[0]} → ${response.status}: ${detail.slice(0, DETAIL_MAX)}`,
        response.status, write && response.status >= 500, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
    }
    try { return JSON.parse(raw); } catch {
      throw new FigmaApiError('invalid_response', `Figma ${method} ${path.split('?')[0]} returned non-JSON`, response.status, write);
    }
  }
}
