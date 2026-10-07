// In-memory Figma for tests and dry runs. It keeps the REST semantics the bridge relies on: replies only to
// root comments, nodes missing from a file come back null, and a write can fail after it took effect.
import { FigmaApiError, type FigmaClient, type FigmaComment, type FigmaFileSnapshot, type FigmaNodeSummary, type FigmaUser, type PostCommentInput } from './client.ts';

interface FakeFile { name: string; version: number; lastModified: string; nodes: Map<string, FigmaNodeSummary>; comments: FigmaComment[] }
type Operation = 'me' | 'file' | 'comments' | 'postComment';
interface Fault { error: FigmaApiError; /** postComment only: the comment is created, then the error is thrown. */ afterWrite?: boolean }

export class FakeFigma implements FigmaClient {
  readonly calls: { op: Operation; fileKey?: string }[] = [];
  private readonly files = new Map<string, FakeFile>();
  /** Files this token cannot open (403). */
  readonly denied = new Set<string>();
  private readonly faults = new Map<Operation, Fault[]>();
  private nextId = 1;
  private tick = 0;

  constructor(readonly user: FigmaUser = { id: 'pm-bot', handle: 'Ensemble PM' }) {}

  addFile(fileKey: string, name: string, nodes: FigmaNodeSummary[]): this {
    this.files.set(fileKey, { name, version: 1, lastModified: this.now(), nodes: new Map(nodes.map(n => [n.id, n])), comments: [] });
    return this;
  }

  /** A designer edits the file: version and lastModified move. */
  edit(fileKey: string): void {
    const file = this.mustFile(fileKey);
    file.version++;
    file.lastModified = this.now();
  }

  /** Someone other than the token owner comments (a root comment, or a reply when parentId is set). */
  addComment(fileKey: string, user: FigmaUser, message: string, parentId?: string, nodeId?: string): FigmaComment {
    const comment: FigmaComment = { id: String(this.nextId++), user, message, createdAt: this.now(), ...(parentId ? { parentId } : {}), ...(nodeId ? { nodeId } : {}) };
    this.mustFile(fileKey).comments.push(comment);
    return comment;
  }

  /** Queue a failure for the next call of `op`. */
  failNext(op: Operation, error: FigmaApiError, afterWrite = false): void {
    this.faults.set(op, [...(this.faults.get(op) ?? []), { error, ...(afterWrite ? { afterWrite } : {}) }]);
  }

  commentsOf(fileKey: string): FigmaComment[] { return structuredClone(this.mustFile(fileKey).comments); }

  async me(): Promise<FigmaUser> {
    this.call('me');
    this.fault('me');
    return { ...this.user };
  }

  async file(fileKey: string, nodeIds: readonly string[]): Promise<FigmaFileSnapshot> {
    this.call('file', fileKey);
    this.fault('file');
    const file = this.open(fileKey);
    return {
      fileKey, name: file.name, version: String(file.version), lastModified: file.lastModified,
      nodes: Object.fromEntries(nodeIds.map(id => [id, file.nodes.get(id) ?? null])),
    };
  }

  async comments(fileKey: string): Promise<FigmaComment[]> {
    this.call('comments', fileKey);
    this.fault('comments');
    return structuredClone(this.open(fileKey).comments);
  }

  async postComment(fileKey: string, input: PostCommentInput): Promise<FigmaComment> {
    this.call('postComment', fileKey);
    const fault = this.faults.get('postComment')?.shift();
    if (fault && !fault.afterWrite) throw fault.error;
    const file = this.open(fileKey);
    if (input.replyTo) {
      const root = file.comments.find(c => c.id === input.replyTo);
      if (!root || root.parentId) throw new FigmaApiError('bad_request', 'comment_id must be a root comment', 400);
    }
    if (input.nodeId && !file.nodes.has(input.nodeId)) throw new FigmaApiError('bad_request', 'client_meta node not found', 400);
    const comment = this.addComment(fileKey, this.user, input.message, input.replyTo, input.replyTo ? undefined : input.nodeId);
    if (fault) throw fault.error;
    return structuredClone(comment);
  }

  private open(fileKey: string): FakeFile {
    if (this.denied.has(fileKey)) throw new FigmaApiError('forbidden', 'Figma GET /v1/files → 403: forbidden', 403);
    const file = this.files.get(fileKey);
    if (!file) throw new FigmaApiError('not_found', 'Figma GET /v1/files → 404: Not found', 404);
    return file;
  }
  private mustFile(fileKey: string): FakeFile {
    const file = this.files.get(fileKey);
    if (!file) throw new Error(`FakeFigma has no file ${fileKey}`);
    return file;
  }
  private fault(op: Operation): void {
    const fault = this.faults.get(op)?.shift();
    if (fault) throw fault.error;
  }
  private call(op: Operation, fileKey?: string): void { this.calls.push({ op, ...(fileKey ? { fileKey } : {}) }); }
  private now(): string { return new Date(Date.UTC(2026, 9, 7, 0, 0, this.tick++)).toISOString(); }
}
