// The PM's reach into a person's own working folder (issue #81). Unlike SessionConnector, Ensemble does not create or run this
// folder: the person's agent works there on its own schedule. The PM may only (1) read files inside the allowlist the person
// granted and (2) drop a request file into `.ensemble/inbox/`. It never edits, moves or deletes anything else there.
import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';

export interface WorkspaceFile {
  /** Relative to the workspace root, with forward slashes. */
  path: string; sha256: string; bytes: number; mtime: string;
  /** UTF-8 text up to the per-file cap; absent for binary or over-budget files. */
  content?: string;
  contentTruncated?: boolean;
}
export interface WorkspaceInspection {
  files: WorkspaceFile[];
  /** Requested paths that were refused (outside the allowlist, escaping symlinks, missing). */
  rejected: { path: string; reason: string }[];
  /** More files existed than the listing limit. */
  truncated: boolean;
}
export interface PersonalRequest {
  requestId: string; projectId: string; participantId: string;
  /** Request body the PM composed (Korean, plain text). */
  text: string;
  /** How the agent replies: Space post URL and the `inReplyTo` it must send. */
  reply: { postUrl: string; contextUrl: string; inReplyTo: string };
  taskId?: string;
  createdAt: string;
}
export type DeliveryFailureReason = 'unreachable' | 'permission_denied' | 'error';
export type DeliveryResult = { delivered: true; location: string } | { delivered: false; reason: DeliveryFailureReason; detail: string };
export interface WorkspaceStatus { reachable: boolean; root: string; detail?: string }

/** Runtime-neutral boundary to one person's environment; implementations never write the ledger. */
export interface PersonalWorkspace {
  /** Reads `paths` (default: the whole allowlist). Throws WorkspaceAccessError when the folder itself is unreachable. */
  inspect(paths?: string[]): Promise<WorkspaceInspection>;
  /** Idempotent per requestId: an already-written request file counts as delivered. */
  deliverRequest(request: PersonalRequest): Promise<DeliveryResult>;
  status(): Promise<WorkspaceStatus>;
}

export class WorkspaceAccessError extends Error {
  constructor(readonly reason: DeliveryFailureReason, message: string) { super(message); this.name = 'WorkspaceAccessError'; }
}

export interface LocalFolderOptions {
  root: string;
  /** Relative to root; `.` grants the whole folder. Omitted means `.`; an explicit empty list grants no reading at all. */
  allowedPaths?: string[];
  maxFiles?: number;
  /** Text read per file and in total; hashes always cover the whole file. */
  maxFileBytes?: number;
  maxTotalBytes?: number;
  /** Larger files are listed as rejected instead of being read and hashed. */
  maxHashBytes?: number;
  /** Test seam: the filesystem calls this adapter makes, so tests can interleave concurrent changes. Defaults to node:fs/promises. */
  fs?: WorkspaceFs;
}
export type WorkspaceFs = Pick<typeof nodeFs, 'lstat' | 'mkdir' | 'open' | 'readdir' | 'realpath' | 'rename' | 'rm' | 'rmdir' | 'stat' | 'unlink'>;
export const INBOX_DIR = path.join('.ensemble', 'inbox');
const SKIPPED_DIRS = new Set(['.git', 'node_modules', '.ensemble', '.next', 'dist', '.venv', '__pycache__']);

function failure(error: unknown): DeliveryFailureReason {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENODEV' || code === 'EHOSTDOWN' ? 'unreachable' : code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'permission_denied' : 'error';
}
const inside = (root: string, target: string) => { const relative = path.relative(root, target); return !relative.startsWith('..') && !path.isAbsolute(relative); };
const posix = (p: string) => p.split(path.sep).join('/');
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
type Identity = Pick<BigIntStats, 'dev' | 'ino'>;
const sameObject = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
/** Where `target` really is right now and which file object that is; undefined when it is gone. */
async function located(fs: WorkspaceFs, target: string): Promise<{ real: string; id: BigIntStats } | undefined> {
  try { const real = await fs.realpath(target); return { real, id: await fs.stat(real, { bigint: true }) }; } catch { return undefined; }
}
const DENIED = (detail: string): DeliveryResult => ({ delivered: false, reason: 'permission_denied', detail });

/*
 * Concurrent changes (re-review N1). Node has no openat()/handle-relative API, so a path checked with realpath can be re-pointed
 * (a directory renamed away and replaced by a link or junction) before it is used. What this adapter guarantees:
 * - Reads: the file is opened first, then its real path must be inside the root and a granted path and must still be the very
 *   object behind the open handle (same dev/ino); only then is it read, through that handle. Swapped paths yield no content.
 * - Writes: directories and the request file are re-checked right after they are created, the request text is written only
 *   through a handle verified to be inside the inbox, and the final file is checked again after the rename. A detected escape
 *   is rolled back (the empty directory or the file this call made is removed) and reported as permission_denied, never as
 *   delivered. What remains: during that narrow window a concurrent actor with write access to the folder (e.g. the same
 *   user's own agent) can make an empty directory or file appear outside briefly, and anything such an actor moves elsewhere
 *   after the last check is out of reach. Identity checks rely on the filesystem reporting real file ids (dev/ino).
 */

/**
 * Makes `relative` under `root` one level at a time and returns its real path, or undefined when a level (a link or junction)
 * resolves outside the root. Each level is resolved before anything below it is created, so a pre-existing link never gets a
 * directory made outside the folder (a recursive mkdir would follow the link first and check afterwards). A level is also
 * re-resolved right after this call made it: if an ancestor was swapped for a link meanwhile, the directory landed outside and
 * is removed again (only if it is still the same, empty directory).
 */
async function directoryInside(fs: WorkspaceFs, root: string, relative: string): Promise<string | undefined> {
  let current = root;
  for (const segment of relative.split(path.sep)) {
    const next = path.join(current, segment);
    const exists = await fs.lstat(next).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
    // EEXIST means it appeared meanwhile; it is checked below like any existing level.
    const made = !exists && await fs.mkdir(next).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; return false; });
    const madeId = made ? await fs.stat(next, { bigint: true }).catch(() => undefined) : undefined;
    const real = await fs.realpath(next);
    if (!inside(root, real)) {
      if (madeId) { const now = await fs.stat(real, { bigint: true }).catch(() => undefined); if (now && sameObject(now, madeId)) await fs.rmdir(real).catch(() => undefined); }
      return undefined;
    }
    if (!(await fs.stat(real)).isDirectory()) throw Object.assign(new Error(`${segment} is not a directory`), { code: 'ENOTDIR' });
    current = real;
  }
  return current;
}

/** Front matter values are single-line JSON strings, so a request text can never break out of the header. */
export function inboxDocument(request: PersonalRequest): string {
  const header = { requestId: request.requestId, project: request.projectId, participant: request.participantId, from: 'Ensemble PM Agent', createdAt: request.createdAt,
    inReplyTo: request.reply.inReplyTo, replyUrl: request.reply.postUrl, contextUrl: request.reply.contextUrl, ...(request.taskId ? { taskId: request.taskId } : {}) };
  const body = JSON.stringify({ kind: 'result', text: '<무엇을 했는지 또는 할 수 없는 이유>', inReplyTo: request.reply.inReplyTo, clientPostId: `reply-${request.requestId}` });
  return [
    '---', ...Object.entries(header).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---', '',
    '# Ensemble PM Agent 요청', '', request.text.trim(), '',
    '## 답하는 방법', '',
    '이 폴더에서 요청을 처리한 뒤 결과나 처리할 수 없는 이유를 Space에 남겨 주세요. `inReplyTo`가 있어야 이 요청의 답으로 연결됩니다.',
    '질문이면 `kind`를 `question`, 막혔으면 `blocked`로 보내세요. 같은 `clientPostId`로 다시 보내도 한 번만 기록됩니다.', '',
    '`<연결 토큰>`은 이 폴더를 Space에 연결할 때 사람이 받은 토큰입니다. 이 파일에는 토큰을 쓰지 않습니다.', '',
    '```sh', `curl -s -X POST ${JSON.stringify(request.reply.postUrl)} -H 'Content-Type: application/json' -H 'Authorization: Bearer <연결 토큰>' -d '${body.replaceAll("'", "'\\''")}'`, '```', '',
    `Space 맥락(같은 헤더 필요): ${request.reply.contextUrl}`, '',
    '이 파일은 Ensemble이 요청 전달용으로만 만든 것입니다. 지워도 요청 기록은 Space에 남습니다.', '',
  ].join('\n');
}

/** A person's existing local folder. Reads stay inside the allowlist after resolving symlinks; the only write is the inbox file. */
export class LocalFolderWorkspace implements PersonalWorkspace {
  private readonly allowed: string[];
  private readonly fs: WorkspaceFs;
  constructor(private readonly options: LocalFolderOptions) {
    this.fs = options.fs ?? nodeFs;
    if (!path.isAbsolute(options.root)) throw new Error('Personal workspace root must be absolute');
    // Fail closed: a blank entry would normalize to `.` (the whole folder), and an explicit [] stays "nothing", never the default.
    if (options.allowedPaths?.some(p => !p.trim())) throw new Error('Allowed paths must not be empty');
    this.allowed = (options.allowedPaths ?? ['.']).map(p => path.normalize(p));
    if (this.allowed.some(p => path.isAbsolute(p) || p === '..' || p.startsWith(`..${path.sep}`))) throw new Error('Allowed paths must stay inside the workspace root');
  }

  private async root(): Promise<string> {
    let real: string;
    try { real = await this.fs.realpath(this.options.root); } catch (error) { throw new WorkspaceAccessError(failure(error), `작업 폴더에 접근할 수 없습니다: ${(error as NodeJS.ErrnoException).code ?? 'error'}`); }
    if (!(await this.fs.stat(real)).isDirectory()) throw new WorkspaceAccessError('unreachable', '작업 폴더가 디렉터리가 아닙니다');
    return real;
  }

  async status(): Promise<WorkspaceStatus> {
    try { await this.root(); return { reachable: true, root: this.options.root }; }
    catch (error) { return { reachable: false, root: this.options.root, detail: (error as Error).message }; }
  }

  async inspect(paths?: string[]): Promise<WorkspaceInspection> {
    const root = await this.root();
    const allowedRoots = (await Promise.all(this.allowed.map(async p => { try { return await this.fs.realpath(path.resolve(root, p)); } catch { return undefined; } })))
      .filter((p): p is string => !!p && inside(root, p));
    const maxFiles = this.options.maxFiles ?? 200, maxFileBytes = this.options.maxFileBytes ?? 16 * 1024;
    let budget = this.options.maxTotalBytes ?? 96 * 1024;
    const rejected: WorkspaceInspection['rejected'] = [];
    const found = new Map<string, string>();
    let truncated = false;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try { entries = await this.fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (found.size >= maxFiles) { truncated = true; return; }
        const full = path.join(dir, entry.name);
        // Walks never follow links: a link into the allowlist is read through its own path only when named explicitly.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { if (!SKIPPED_DIRS.has(entry.name)) await walk(full); }
        else if (entry.isFile()) found.set(full, posix(path.relative(root, full)));
      }
    };
    const targets = paths?.length ? paths : this.allowed;
    for (const requested of targets) {
      let real: string;
      try { real = await this.fs.realpath(path.resolve(root, requested)); }
      catch { rejected.push({ path: requested, reason: '경로를 찾지 못했습니다' }); continue; }
      // Resolved links and junctions must still land inside the root and inside a granted path.
      if (!inside(root, real)) { rejected.push({ path: requested, reason: '작업 폴더 밖을 가리킵니다' }); continue; }
      if (!allowedRoots.some(a => inside(a, real))) { rejected.push({ path: requested, reason: '허용된 경로가 아닙니다' }); continue; }
      const info = await this.fs.lstat(real);
      if (info.isDirectory()) await walk(real);
      else if (info.isFile()) { if (found.size >= maxFiles) truncated = true; else found.set(real, posix(path.relative(root, real))); }
    }
    const files: WorkspaceFile[] = [];
    const maxHashBytes = this.options.maxHashBytes ?? 5 * 1024 * 1024;
    for (const [full, relative] of found) {
      let data: Buffer, info: BigIntStats;
      let handle: nodeFs.FileHandle | undefined;
      try {
        // Open first, then prove the handle is the file at a checked in-root, granted path: a directory swapped for a link
        // after the allowlist check above would otherwise be read through.
        handle = await this.fs.open(full, 'r');
        info = await handle.stat({ bigint: true });
        const where = await located(this.fs, full);
        if (!info.isFile() || !where || !sameObject(where.id, info) || !inside(root, where.real) || !allowedRoots.some(a => inside(a, where.real))) {
          rejected.push({ path: relative, reason: '읽는 동안 경로가 바뀌어 읽지 않았습니다' }); continue;
        }
        if (info.size > BigInt(maxHashBytes)) { rejected.push({ path: relative, reason: `${maxHashBytes}바이트보다 큰 파일은 읽지 않습니다` }); continue; }
        data = await handle.readFile();
      } catch { rejected.push({ path: relative, reason: '읽지 못했습니다' }); continue; }
      finally { await handle?.close().catch(() => undefined); }
      const file: WorkspaceFile = { path: relative, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length, mtime: info.mtime.toISOString() };
      const textual = !data.subarray(0, 8000).includes(0);
      if (textual && budget > 0) {
        const take = Math.min(data.length, maxFileBytes, budget);
        file.content = data.subarray(0, take).toString('utf8');
        // A cut inside a multi-byte character decodes to U+FFFD; drop it so the excerpt stays within the cap.
        if (take < data.length) { file.content = file.content.replace(/�+$/, ''); file.contentTruncated = true; }
        budget -= take;
      }
      files.push(file);
    }
    return { files, rejected, truncated };
  }

  async deliverRequest(request: PersonalRequest): Promise<DeliveryResult> {
    if (!/^[\w.-]+$/.test(request.requestId)) return { delivered: false, reason: 'error', detail: '요청 id 형식이 올바르지 않습니다' };
    let root: string;
    try { root = await this.root(); } catch (error) { return { delivered: false, reason: error instanceof WorkspaceAccessError ? error.reason : 'error', detail: (error as Error).message }; }
    const location = path.join(root, INBOX_DIR, `${request.requestId}.md`);
    let temporary: string | undefined;
    try {
      // A pre-existing `.ensemble` or `inbox` link must neither redirect the write nor create anything out of the folder.
      const inbox = await directoryInside(this.fs, root, INBOX_DIR);
      if (!inbox) return DENIED('요청함 경로가 작업 폴더 밖을 가리킵니다');
      const target = path.join(inbox, `${request.requestId}.md`);
      // Never overwrite: the same request file already there means an earlier attempt landed, as long as it really is a file
      // in this inbox (not a link, not reached through a swapped directory).
      const existing = await this.fs.lstat(target).catch(() => undefined);
      if (existing) {
        const where = await located(this.fs, target);
        return existing.isFile() && where && samePath(where.real, target) ? { delivered: true, location } : DENIED('요청함 경로가 작업 폴더 밖을 가리킵니다');
      }
      // The temporary file plus rename keeps a half-written request from ever counting as delivered.
      const tmp = temporary = `${target}.${randomUUID()}.tmp`;
      let written: BigIntStats | undefined;
      /** The file this call created is still at `expected` (re-resolved now), inside the inbox. */
      const stillAt = async (expected: string) => { const where = await located(this.fs, expected); return !!where && !!written && samePath(where.real, expected) && sameObject(where.id, written); };
      const rollBack = async () => {
        for (const candidate of [tmp, target]) {
          const where = await located(this.fs, candidate);
          if (where && written && sameObject(where.id, written)) await this.fs.unlink(where.real).catch(() => undefined);
        }
        return DENIED('요청함 경로가 쓰는 동안 작업 폴더 밖으로 바뀌어 전달하지 않았습니다');
      };
      // 'wx' (O_CREAT|O_EXCL) never opens an existing file or a planted link. The text goes only through this handle, after the
      // handle is proven to be the new file inside the inbox.
      const handle = await this.fs.open(tmp, 'wx');
      try {
        written = await handle.stat({ bigint: true });
        if (!(await stillAt(tmp))) { await handle.close(); return await rollBack(); }
        await handle.writeFile(inboxDocument(request), 'utf8');
      } finally { await handle.close().catch(() => undefined); }
      if (!(await stillAt(tmp))) return await rollBack();
      await this.fs.rename(tmp, target);
      if (!(await stillAt(target))) return await rollBack();
      return { delivered: true, location };
    } catch (error) {
      return { delivered: false, reason: failure(error), detail: `요청 파일을 쓰지 못했습니다: ${(error as NodeJS.ErrnoException).code ?? 'error'}` };
    } finally {
      // Our uniquely named temporary file, wherever the path leads now; a no-op after the rename.
      if (temporary) await this.fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
