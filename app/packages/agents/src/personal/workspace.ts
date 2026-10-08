// The PM's reach into a person's own working folder (issue #81). Unlike SessionConnector, Ensemble does not create or run this
// folder: the person's agent works there on its own schedule. The PM may only (1) read files inside the allowlist the person
// granted and (2) drop a request file into `.ensemble/inbox/`. It never edits, moves or deletes anything else there.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
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
}
export const INBOX_DIR = path.join('.ensemble', 'inbox');
const SKIPPED_DIRS = new Set(['.git', 'node_modules', '.ensemble', '.next', 'dist', '.venv', '__pycache__']);

function failure(error: unknown): DeliveryFailureReason {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENODEV' || code === 'EHOSTDOWN' ? 'unreachable' : code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'permission_denied' : 'error';
}
const inside = (root: string, target: string) => { const relative = path.relative(root, target); return !relative.startsWith('..') && !path.isAbsolute(relative); };
const posix = (p: string) => p.split(path.sep).join('/');

/**
 * Makes `relative` under `root` one level at a time and returns its real path, or undefined when an existing level (a link or
 * junction) resolves outside the root. Each level is resolved before anything below it is created, so a refused delivery never
 * creates a directory outside the folder (a recursive mkdir would follow the link first and check afterwards).
 */
async function directoryInside(root: string, relative: string): Promise<string | undefined> {
  let current = root;
  for (const segment of relative.split(path.sep)) {
    const next = path.join(current, segment);
    const exists = await lstat(next).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
    // Created inside `current`, which is already a real path inside the root. EEXIST means it appeared meanwhile; it is checked below.
    if (!exists) await mkdir(next).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const real = await realpath(next);
    if (!inside(root, real)) return undefined;
    if (!(await stat(real)).isDirectory()) throw Object.assign(new Error(`${segment} is not a directory`), { code: 'ENOTDIR' });
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
  constructor(private readonly options: LocalFolderOptions) {
    if (!path.isAbsolute(options.root)) throw new Error('Personal workspace root must be absolute');
    // Fail closed: a blank entry would normalize to `.` (the whole folder), and an explicit [] stays "nothing", never the default.
    if (options.allowedPaths?.some(p => !p.trim())) throw new Error('Allowed paths must not be empty');
    this.allowed = (options.allowedPaths ?? ['.']).map(p => path.normalize(p));
    if (this.allowed.some(p => path.isAbsolute(p) || p === '..' || p.startsWith(`..${path.sep}`))) throw new Error('Allowed paths must stay inside the workspace root');
  }

  private async root(): Promise<string> {
    let real: string;
    try { real = await realpath(this.options.root); } catch (error) { throw new WorkspaceAccessError(failure(error), `작업 폴더에 접근할 수 없습니다: ${(error as NodeJS.ErrnoException).code ?? 'error'}`); }
    if (!(await stat(real)).isDirectory()) throw new WorkspaceAccessError('unreachable', '작업 폴더가 디렉터리가 아닙니다');
    return real;
  }

  async status(): Promise<WorkspaceStatus> {
    try { await this.root(); return { reachable: true, root: this.options.root }; }
    catch (error) { return { reachable: false, root: this.options.root, detail: (error as Error).message }; }
  }

  async inspect(paths?: string[]): Promise<WorkspaceInspection> {
    const root = await this.root();
    const allowedRoots = (await Promise.all(this.allowed.map(async p => { try { return await realpath(path.resolve(root, p)); } catch { return undefined; } })))
      .filter((p): p is string => !!p && inside(root, p));
    const maxFiles = this.options.maxFiles ?? 200, maxFileBytes = this.options.maxFileBytes ?? 16 * 1024;
    let budget = this.options.maxTotalBytes ?? 96 * 1024;
    const rejected: WorkspaceInspection['rejected'] = [];
    const found = new Map<string, string>();
    let truncated = false;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
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
      try { real = await realpath(path.resolve(root, requested)); }
      catch { rejected.push({ path: requested, reason: '경로를 찾지 못했습니다' }); continue; }
      // Resolved links and junctions must still land inside the root and inside a granted path.
      if (!inside(root, real)) { rejected.push({ path: requested, reason: '작업 폴더 밖을 가리킵니다' }); continue; }
      if (!allowedRoots.some(a => inside(a, real))) { rejected.push({ path: requested, reason: '허용된 경로가 아닙니다' }); continue; }
      const info = await lstat(real);
      if (info.isDirectory()) await walk(real);
      else if (info.isFile()) { if (found.size >= maxFiles) truncated = true; else found.set(real, posix(path.relative(root, real))); }
    }
    const files: WorkspaceFile[] = [];
    const maxHashBytes = this.options.maxHashBytes ?? 5 * 1024 * 1024;
    for (const [full, relative] of found) {
      let data: Buffer, info;
      try {
        info = await stat(full);
        if (info.size > maxHashBytes) { rejected.push({ path: relative, reason: `${maxHashBytes}바이트보다 큰 파일은 읽지 않습니다` }); continue; }
        data = await readFile(full);
      } catch { rejected.push({ path: relative, reason: '읽지 못했습니다' }); continue; }
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
    try {
      // A pre-existing `.ensemble` or `inbox` link must neither redirect the write nor create anything out of the folder.
      const inbox = await directoryInside(root, INBOX_DIR);
      if (!inbox) return { delivered: false, reason: 'permission_denied', detail: '요청함 경로가 작업 폴더 밖을 가리킵니다' };
      const target = path.join(inbox, `${request.requestId}.md`);
      // Never overwrite: the same request file already there means an earlier attempt landed. The temporary file plus rename
      // keeps a half-written request from ever counting as delivered.
      if (await lstat(target).then(() => true, () => false)) return { delivered: true, location };
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, inboxDocument(request), { encoding: 'utf8', flag: 'wx' }); await rename(temporary, target); }
      finally { await rm(temporary, { force: true }); }
      return { delivered: true, location };
    } catch (error) {
      return { delivered: false, reason: failure(error), detail: `요청 파일을 쓰지 못했습니다: ${(error as NodeJS.ErrnoException).code ?? 'error'}` };
    }
  }
}
