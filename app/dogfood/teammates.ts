// 가상 팀원 A·B. 사람 팀원이 운영하는 로컬 Claude Code 세션을 headless claude -p로 대신한다.
// 하네스가 맡는 일: Space 연결, 일감 모으기, 세션 실행, 팀원 브랜치의 main 머지, 보드 결과 제출, 통합 테스트, 사후 검증.
// 팀원이 맡는 일: 자기 worktree에서 구현·커밋, Space 게시. 팀원은 main에 머지하지 않고 보드에도 쓰지 않는다.
// 팀원의 보고(주장)와 git·제품 원장(검증)을 나란히 dogfood_teammate_session에 남긴다.
// 제품 원장에는 직접 쓰지 않는다. 토큰은 secrets/<id>.token에만 있고 원장·로그에는 *** 로 가린다.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isParentTask, openRequests, participation, project, type AnyEvent } from '@ensemble/core';
import { backlogIdsIn, boardDone, parseGoal, verifiedDone } from './backlog.ts';
import { BASH, runClaude } from './claude.ts';
import { isInside, type RunLayout } from './config.ts';
import { changedFiles, commitsBetween, ensureWorktree, git, head, isAncestor, mergeBranchIntoMain, mergeMainInto, runTests, type TestRun } from './git.ts';
import { httpJson } from './host.ts';
import { submitHumanResult, type HumanFile } from './human-result.ts';
import { cleanSummary, splitBacklogTitle } from './proxy.ts';
import { lastSeq, loadRolePrompt, recordHarnessUsage, type RoleContext } from './role-context.ts';

// ---------------------------------------------------------------- 팀원 정의와 연결

export interface TeammateSpec {
  /** Space 참여자 id이자 역할 프롬프트 이름·하네스 원장의 행위자. */
  id: 'teammate-a' | 'teammate-b';
  /** layout.teammate()에 넘기는 짧은 이름(worktree 폴더 teammate-a·b). */
  short: 'a' | 'b';
  displayName: string;
  /** A는 보드 일감을 먼저 맡고(board-first), B는 BACKLOG의 solo 항목만 보드 밖에서 한다(local-first). */
  persona: 'board-first' | 'local-first';
  /** 대행하는 제품 멤버. B는 멤버가 아니라 Space 참여자일 뿐이다. */
  memberId?: 'designer';
  branch: string;
}

export const TEAMMATES: readonly TeammateSpec[] = [
  { id: 'teammate-a', short: 'a', displayName: '팀원 A', persona: 'board-first', memberId: 'designer', branch: 'dogfood/teammate-a' },
  { id: 'teammate-b', short: 'b', displayName: '팀원 B', persona: 'local-first', branch: 'dogfood/teammate-b' },
];

export const worktreeOf = (layout: RunLayout, spec: TeammateSpec): string => layout.teammate(spec.short);
const tokenFile = (layout: RunLayout, id: string): string => join(layout.secrets, `${id}.token`);

/** 팀원이 쓰는 Space 주소. 연결 때 link.spaceUrl이 host.baseUrl이므로 제품이 알려 주는 주소와 같다. */
export function spaceUrls(baseUrl: string, participantId: string): { contextUrl: string; postUrl: string } {
  const root = `${baseUrl.replace(/\/+$/, '')}/api/space/participants/${encodeURIComponent(participantId)}`;
  return { postUrl: `${root}/posts`, contextUrl: `${root}/context?format=md` };
}

export function readTeammateToken(layout: RunLayout, id: string): string {
  try {
    return readFileSync(tokenFile(layout, id), 'utf8').trim();
  } catch {
    throw new Error(`팀원 토큰을 읽지 못했습니다(연결 전입니까?): ${tokenFile(layout, id)}`);
  }
}

/**
 * 팀원을 Space에 연결한다. worktree를 만들고 owner 명의로 연결을 요청한 뒤, announceLinkCode로 모은 코드로 확인한다.
 * 토큰은 secrets/<id>.token에만 쓰고 돌려주지 않는다. 같은 팀원을 다시 연결하면 이전 토큰은 무효가 된다.
 */
export async function linkTeammate(
  ctx: Pick<RoleContext, 'host' | 'layout' | 'ledger'>,
  spec: TeammateSpec,
): Promise<{ participantId: string; workspaceRoot: string; contextUrl: string; postUrl: string }> {
  const workspaceRoot = worktreeOf(ctx.layout, spec);
  await ensureWorktree(ctx.layout.targetMain, workspaceRoot, spec.branch);
  const { runtime } = ctx.host;
  const issued = await runtime.requestParticipantLink(
    { participantId: spec.id, displayName: spec.displayName, tool: 'claude', workspaceRoot, spaceUrl: ctx.host.baseUrl },
    'owner',
  );
  const code = ctx.host.takeLinkCode(spec.id);
  if (code === undefined) throw new Error(`연결 확인 코드를 받지 못했습니다: ${spec.id}`);
  const confirmed = await runtime.confirmParticipantLink(issued.linkRequestId, 'owner', code);
  mkdirSync(ctx.layout.secrets, { recursive: true });
  writeFileSync(tokenFile(ctx.layout, spec.id), confirmed.token, { mode: 0o600 });
  const urls = spaceUrls(ctx.host.baseUrl, spec.id);
  await ctx.ledger.record('dogfood_setup_step', { step: 'teammate_linked', participantId: spec.id, workspaceRoot, ...urls }, { key: `teammate-linked:${spec.id}` });
  return { participantId: spec.id, workspaceRoot, ...urls };
}

// ---------------------------------------------------------------- 보고 스키마

export interface TeammateDeliverable {
  taskId: string;
  summary: string;
  /** worktree 기준 상대 경로. */
  files: string[];
}

export interface TeammateReport {
  worked: boolean;
  summary: string;
  backlogItems: string[];
  taskIds: string[];
  branch: string;
  commits: string[];
  filesChanged: string[];
  testsPassed: boolean | null;
  readyToMerge: boolean;
  postedToSpace: boolean;
  deliverables: TeammateDeliverable[];
  inboxAnswered: string[];
  frictions: string[];
}

const STRINGS = { type: 'array', items: { type: 'string' } } as const;

/** claude --json-schema 인자 상한(6000자) 안에 들어야 한다. */
export const TEAMMATE_REPORT_SCHEMA = {
  type: 'object',
  required: ['worked', 'summary', 'backlogItems', 'taskIds', 'branch', 'commits', 'filesChanged', 'testsPassed', 'readyToMerge', 'postedToSpace', 'deliverables', 'inboxAnswered', 'frictions'],
  properties: {
    worked: { type: 'boolean' },
    summary: { type: 'string' },
    backlogItems: STRINGS,
    taskIds: STRINGS,
    branch: { type: 'string' },
    commits: STRINGS,
    filesChanged: STRINGS,
    testsPassed: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    readyToMerge: { type: 'boolean' },
    postedToSpace: { type: 'boolean' },
    deliverables: {
      type: 'array',
      items: {
        type: 'object',
        required: ['taskId', 'summary', 'files'],
        properties: { taskId: { type: 'string' }, summary: { type: 'string' }, files: STRINGS },
      },
    },
    inboxAnswered: STRINGS,
    frictions: STRINGS,
  },
} as const;

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 모델이 낸 값을 보고 모양으로 맞춘다. 모르는 값은 가장 보수적인 쪽(readyToMerge false)으로 둔다. */
export function normalizeReport(raw: unknown, fallbackBranch: string): TeammateReport {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const deliverables = (Array.isArray(r.deliverables) ? r.deliverables : []).flatMap((d): TeammateDeliverable[] => {
    if (!d || typeof d !== 'object') return [];
    const x = d as Record<string, unknown>;
    return typeof x.taskId === 'string' && x.taskId ? [{ taskId: x.taskId, summary: typeof x.summary === 'string' ? x.summary : '', files: strs(x.files) }] : [];
  });
  return {
    worked: r.worked === true,
    summary: typeof r.summary === 'string' ? r.summary : '',
    backlogItems: [...new Set(strs(r.backlogItems))],
    taskIds: [...new Set(strs(r.taskIds))],
    branch: typeof r.branch === 'string' && r.branch ? r.branch : fallbackBranch,
    commits: strs(r.commits),
    filesChanged: strs(r.filesChanged),
    testsPassed: typeof r.testsPassed === 'boolean' ? r.testsPassed : null,
    readyToMerge: r.readyToMerge === true,
    postedToSpace: r.postedToSpace === true,
    deliverables,
    inboxAnswered: strs(r.inboxAnswered),
    frictions: strs(r.frictions),
  };
}

// ---------------------------------------------------------------- 일감 모으기

export type JobKind = 'assigned' | 'owner_code' | 'integrate' | 'solo';

export interface JobInput {
  taskId: string;
  /** worktree 기준 폴더(.dogfood/inputs/<taskId>). 읽기 전용이다. */
  dir: string;
  files: string[];
}

export interface TeammateJob {
  kind: JobKind;
  /** assigned·owner_code는 taskId, integrate·solo는 B-id. */
  ref: string;
  title: string;
  /** assigned·owner_code: 그 작업의 담당 멤버. 결과 제출 명의다. */
  assignee?: 'owner' | 'designer';
  conditions: string[];
  /** 보완 요청(revising)이 지적한 모자란 조건. */
  missing: string[];
  /** 이 일감이 덮는 BACKLOG 항목. */
  backlogItems: string[];
  /** integrate: Agent가 보드에 남긴 결과 첨부. */
  inputs: JobInput[];
}

export interface InboxRequest {
  requestId: string;
  text: string;
  taskId?: string;
}

export interface CollectedJobs {
  jobs: TeammateJob[];
  inbox: InboxRequest[];
}

const MAX_BOARD_JOBS = 2;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const safeName = (name: string) => basename(name).replace(/[^\w.가-힣-]+/g, '_') || 'file';
const docName = (ref: string) => ref.replace(/[^\w.-]+/g, '-');

interface HarnessSubmission {
  taskId: string;
  actor: string;
  cycle: number;
  via: string;
  httpMessageId: string | null;
  key: string | undefined;
}

function submissionsIn(harness: readonly { type: string; payload: unknown; idempotencyKey?: string | undefined }[]): HarnessSubmission[] {
  return harness.flatMap((e) => (e.type === 'dogfood_human_task_submitted'
    ? [{ ...(e.payload as Omit<HarnessSubmission, 'key'>), key: e.idempotencyKey }] : []));
}

/** 결과 첨부(data URI)를 worktree/.dogfood/inputs/<taskId>/<name>으로 풀어 둔다. 풀 수 없는 첨부는 건너뛴다. */
function decodeInputs(events: readonly AnyEvent[], worktree: string, taskId: string): JobInput {
  const result = events.findLast((e) => e.type === 'result_submitted' && e.payload.taskId === taskId);
  const artifactIds = new Set(result?.type === 'result_submitted' ? result.payload.artifactIds : []);
  const folder = docName(taskId);
  const dir = join(worktree, '.dogfood', 'inputs', folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const e of events) {
    if (e.type !== 'attachment_recorded') continue;
    if (e.payload.taskId !== taskId && !artifactIds.has(e.payload.attachmentId)) continue;
    const m = /^data:[^,]*;base64,(.*)$/s.exec(e.payload.uri);
    if (!m) continue;
    let name = safeName(e.payload.name);
    for (let n = 2; files.includes(name); n++) name = `${n}-${safeName(e.payload.name)}`;
    writeFileSync(join(dir, name), Buffer.from(m[1]!, 'base64'));
    files.push(name);
  }
  return { taskId, dir: `.dogfood/inputs/${folder}`, files };
}

/**
 * 이번 사이클에 팀원이 할 일감과 아직 답하지 않은 inbox 요청을 모은다.
 * A(board-first): 최대 2건, 순서는 (a) assigned: designer 담당 (b) owner_code: owner 담당 B-id 작업(R14) (c) integrate: 보드에서만 끝난 항목.
 * B(local-first): BACKLOG에서 solo가 자기 id이고 이번 반복이며 아직 verifiedDone이 아닌 항목 전부.
 * owner_code를 처음 고르면 R14용 owner_code_redirect를 하네스 원장에 남긴다. integrate는 Agent 결과 첨부를 .dogfood/inputs로 풀어 준다.
 */
export async function collectJobs(ctx: RoleContext, spec: TeammateSpec): Promise<CollectedJobs> {
  const events = await ctx.host.events();
  const harness = await ctx.ledger.read();
  const typed = events as readonly AnyEvent[];
  const state = project(events);
  const verified = verifiedDone(harness);
  const known = new Set(ctx.backlog.map((b) => b.id));
  const worktree = worktreeOf(ctx.layout, spec);
  const jobs: TeammateJob[] = [];

  if (spec.persona === 'board-first') {
    const subs = submissionsIn(harness);
    const finalIds = new Set(subs.flatMap((s) => (s.key?.startsWith('human-submit-final:') ? [s.key.slice('human-submit-final:'.length)] : [])));
    const pending = new Set(subs.filter((s) => s.via === 'pending' && s.httpMessageId !== null && !finalIds.has(s.httpMessageId)).map((s) => s.taskId));
    const doneNow = new Set(subs.filter((s) => s.actor === spec.id && s.cycle === ctx.cycle).map((s) => s.taskId));
    const eligible = (assignee: string) => [...state.tasks.values()].filter((t) => t.spec.assignee === assignee
      && (t.status === 'reserved' || t.status === 'revising') && !isParentTask(state, t) && !pending.has(t.spec.id) && !doneNow.has(t.spec.id));
    const taskJob = (t: ReturnType<typeof eligible>[number], kind: 'assigned' | 'owner_code', assignee: 'owner' | 'designer'): TeammateJob => {
      const revision = t.status === 'revising' ? typed.findLast((e) => e.type === 'revision_requested' && e.payload.taskId === t.spec.id) : undefined;
      return {
        kind, ref: t.spec.id, title: t.spec.title, assignee, conditions: [...t.spec.handoffConditions],
        missing: revision?.type === 'revision_requested' ? [...revision.payload.missing] : [],
        backlogItems: backlogIdsIn(t.spec.title).filter((id) => known.has(id)), inputs: [],
      };
    };
    const assigned = eligible(spec.memberId ?? 'designer').map((t) => taskJob(t, 'assigned', 'designer'));
    const ownerCode = eligible('owner').filter((t) => backlogIdsIn(t.spec.title).length > 0).map((t) => taskJob(t, 'owner_code', 'owner'));
    const taken = new Set([...assigned, ...ownerCode].flatMap((j) => j.backlogItems));
    const boardIds = boardDone(events);
    const integrate = ctx.backlog
      .filter((b) => b.iteration === ctx.config.iteration && boardIds.has(b.id) && !verified.has(b.id) && !taken.has(b.id))
      .map((b): TeammateJob => {
        const { title, acceptance } = splitBacklogTitle(b);
        const linked = [...state.tasks.values()].filter((t) => t.status === 'checked' && state.members.get(t.spec.assignee)?.kind === 'agent'
          && backlogIdsIn([t.spec.title, ...t.spec.handoffConditions].join('\n')).includes(b.id));
        const conditions = linked.flatMap((t) => t.spec.handoffConditions);
        return {
          kind: 'integrate', ref: b.id, title: `[${b.id}] ${title}`, conditions: conditions.length > 0 ? conditions : [acceptance ?? title],
          missing: [], backlogItems: [b.id], inputs: linked.map((t) => ({ taskId: t.spec.id, dir: '', files: [] })),
        };
      });
    for (const job of [...assigned, ...ownerCode, ...integrate].slice(0, MAX_BOARD_JOBS)) {
      if (job.kind === 'integrate') job.inputs = job.inputs.map((i) => decodeInputs(typed, worktree, i.taskId));
      if (job.kind === 'owner_code') {
        await ctx.ledger.record('dogfood_proxy_action', {
          role: 'harness', memberId: 'owner', cycle: ctx.cycle, action: { type: 'owner_code_redirect', taskId: job.ref },
          interventionType: 'override', counted: true, ok: true, via: 'rule', harnessNoise: false,
        }, { key: `owner-code-redirect:${job.ref}` });
      }
      jobs.push(job);
    }
  } else {
    for (const b of ctx.backlog) {
      if (b.solo !== spec.id || b.iteration !== ctx.config.iteration || verified.has(b.id)) continue;
      const { title, acceptance } = splitBacklogTitle(b);
      jobs.push({ kind: 'solo', ref: b.id, title: `[${b.id}] ${title}`, conditions: acceptance ? [acceptance] : [], missing: [], backlogItems: [b.id], inputs: [] });
    }
  }

  const inbox = openRequests(participation(events), spec.id).map((r): InboxRequest => ({
    requestId: r.request.requestId, text: clip(r.request.text, 500), ...(r.request.taskId === undefined ? {} : { taskId: r.request.taskId }),
  }));
  return { jobs, inbox };
}

// ---------------------------------------------------------------- 규칙 모드 세션

/** 파일을 add하고 바뀐 것이 있을 때만 커밋한다. 커밋했으면 true. */
async function commitFiles(worktree: string, files: readonly string[], message: string): Promise<boolean> {
  await git(worktree, ['add', '--', ...files]);
  if ((await git(worktree, ['diff', '--cached', '--quiet'], { allowFail: true })).code === 0) return false;
  await git(worktree, ['commit', '-m', message]);
  return true;
}

function writeRepoFile(worktree: string, rel: string, content: string): void {
  const file = join(worktree, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** '# 제목', '## 인계 조건 대응', '### n. 조건' 절. 보완 요청이 지적한 조건을 앞에 둔다. */
function ruleDoc(spec: TeammateSpec, ctx: RoleContext, job: TeammateJob): string {
  const isMissing = (c: string) => job.missing.some((m) => m.includes(c) || c.includes(m));
  const ordered = [...job.conditions.filter(isMissing), ...job.conditions.filter((c) => !isMissing(c))];
  const sections = ordered.map((c, i) => `### ${i + 1}. ${c}\n${c}에 대해 대상 레포에 반영한 내용입니다. 근거는 테스트와 커밋에 있고, 확인하지 못한 부분은 한계로 구분했습니다.`);
  const lines = [`# ${job.title}`, '', `규칙 모드의 ${spec.displayName}(${spec.id})가 합성한 결과입니다.`, '', '## 인계 조건 대응', '', ...sections];
  if (job.missing.length > 0) lines.push('', '## 보완 내역', ...job.missing.map((m) => `- 사이클 ${ctx.cycle}: ${m}를 보완했습니다.`));
  if (job.kind === 'integrate') {
    const files = job.inputs.flatMap((i) => i.files.map((f) => `${i.dir}/${f}`));
    lines.push('', '## 입력', ...(files.length > 0 ? files.map((f) => `- ${f}`) : ['- 보드에 남은 결과 첨부가 없습니다.']));
  }
  return `${lines.join('\n')}\n`;
}

async function ruleReport(ctx: RoleContext, spec: TeammateSpec, jobs: readonly TeammateJob[], worktree: string, branchBefore: string): Promise<TeammateReport> {
  const deliverables: TeammateDeliverable[] = [];
  const files: string[] = [];
  for (const job of jobs) {
    const rel = spec.persona === 'local-first' ? `notes/${docName(job.ref)}.md` : `docs/${docName(job.ref)}.md`;
    const content = spec.persona === 'local-first'
      ? `# ${job.title}\n\n${job.conditions.length > 0 ? `완료 조건: ${job.conditions.join(' / ')}\n\n` : ''}규칙 모드의 ${spec.displayName}가 Ensemble 밖에서 구현하고 남긴 메모입니다.\n`
      : ruleDoc(spec, ctx, job);
    writeRepoFile(worktree, rel, content);
    files.push(rel);
    const label = job.backlogItems[0] ?? job.ref;
    await commitFiles(worktree, [rel], `${label}: ${splitBacklogTitle({ title: job.title.replace(/^\[B-\d+\]\s*/, '') }).title}`);
    if (job.kind === 'assigned' || job.kind === 'owner_code') deliverables.push({ taskId: job.ref, summary: `"${job.title}" 결과를 올립니다.`, files: [rel] });
  }
  const items = [...new Set(jobs.flatMap((j) => j.backlogItems))];
  return {
    worked: true,
    summary: `[${items.length > 0 ? items.join(', ') : jobs.map((j) => j.ref).join(', ')}] 작업을 끝냈습니다.`,
    backlogItems: items,
    taskIds: jobs.filter((j) => j.kind === 'assigned' || j.kind === 'owner_code').map((j) => j.ref),
    branch: spec.branch,
    commits: await commitsBetween(worktree, branchBefore, 'HEAD'),
    filesChanged: files,
    testsPassed: null,
    readyToMerge: true,
    postedToSpace: false,
    deliverables,
    inboxAnswered: [],
    frictions: [],
  };
}

// ---------------------------------------------------------------- 보조

function scrubber(token: string): <T>(value: T) => T {
  return <T>(value: T): T => {
    if (!token) return value;
    const text = JSON.stringify(value);
    if (text === undefined) return value;
    return JSON.parse(text.split(JSON.stringify(token).slice(1, -1)).join('***').split(token).join('***')) as T;
  };
}

const MIME: Record<string, string> = { md: 'text/markdown', json: 'application/json', html: 'text/html', css: 'text/css' };
const MAX_ATTACH_BYTES = 200_000;

/** deliverable의 파일을 worktree 안에서만 읽어 첨부로 만든다. 없으면 요약 파일 하나를 만든다. */
function attachmentsFor(worktree: string, d: TeammateDeliverable, job: TeammateJob, branch: string, commits: readonly string[]): HumanFile[] {
  const out: HumanFile[] = [];
  for (const rel of d.files) {
    const abs = resolve(worktree, rel);
    if (!isInside(abs, worktree) || !existsSync(abs) || !statSync(abs).isFile() || statSync(abs).size > MAX_ATTACH_BYTES) continue;
    let name = safeName(rel);
    for (let n = 2; out.some((f) => f.name === name); n++) name = `${n}-${safeName(rel)}`;
    const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
    out.push({ name, content: readFileSync(abs, 'utf8'), mimeType: MIME[ext] ?? 'text/plain' });
  }
  if (out.length === 0) {
    const text = `# ${job.title}\n\n${d.summary || '결과를 올립니다.'}\n\n- 브랜치: ${branch}\n- 커밋: ${commits.map((c) => c.slice(0, 8)).join(', ') || '(없음)'}\n`;
    out.push({ name: `${docName(job.ref)}-summary.md`, content: text, mimeType: 'text/markdown' });
  }
  return out;
}

function testCommandOf(ctx: RoleContext): string {
  try {
    return parseGoal(readFileSync(join(ctx.layout.targetMain, 'DOGFOOD_GOAL.md'), 'utf8'), ctx.config.iteration).testCommand;
  } catch {
    return 'npm test';
  }
}

/** 이전 세션이 남긴 미커밋 변경을 버린다(커밋하지 않은 것은 주장할 수 없다). .dogfood/는 제외 대상이라 남는다. */
async function cleanWorktree(worktree: string): Promise<void> {
  if ((await git(worktree, ['status', '--porcelain'])).stdout.trim() === '') return;
  await git(worktree, ['reset', '--hard', 'HEAD']);
  await git(worktree, ['clean', '-fd']);
}

/** 팀원이 직접 하지 않은 게시(규칙 모드, 충돌 알림)를 팀원 토큰으로 HTTP 게시한다. 접수되면 true. */
async function postToSpace(ctx: RoleContext, spec: TeammateSpec, token: string, body: { kind: 'result' | 'note' | 'blocked'; text: string; clientPostId: string; inReplyTo?: string }): Promise<boolean> {
  const res = await httpJson(spaceUrls(ctx.host.baseUrl, spec.id).postUrl, { token, body });
  return res.status === 202;
}

const FORBIDDEN_PATH = /^(?:BACKLOG\.md|\.ensemble\/|\.dogfood\/)/;
const BOARD_JOB_KINDS = new Set<JobKind>(['assigned', 'owner_code']);

export interface TeammateRunResult {
  skipped: boolean;
  reason?: string;
  error?: string;
  jobs: number;
  readyToMerge: boolean;
  merged: boolean;
  conflicts: string[];
  /** 통합 테스트 결과. 이번 세션에서 main이 바뀌지 않았으면 null. */
  integrationPassed: boolean | null;
  /** 이번 세션에서 verifiedDone에 올린 항목. */
  progress: string[];
  /** 보드에 결과를 낸 작업 id. */
  submitted: string[];
}

/**
 * 팀원 한 명의 한 사이클. 1) worktree 준비·main 합치기 2) 브리프 3) 세션(live는 claude -p, rule은 결정적 보고)
 * 4) 하네스 머지 5) rule 게시 6) 검증 7) 보드 결과 제출 8) 통합 테스트 9) backlog_progress 10) 세션 기록.
 * 예외는 session.error에 담고 다시 던지지 않는다. 인프라 실패이면 세션을 error로 남기고 머지하지 않는다.
 */
export async function runTeammate(ctx: RoleContext, spec: TeammateSpec): Promise<TeammateRunResult> {
  const out: TeammateRunResult = { skipped: false, jobs: 0, readyToMerge: false, merged: false, conflicts: [], integrationPassed: null, progress: [], submitted: [] };
  const session: Record<string, unknown> = { teammate: spec.id, persona: spec.persona, cycle: ctx.cycle, branch: spec.branch };
  const worktree = worktreeOf(ctx.layout, spec);
  let jobs: TeammateJob[] = [];
  try {
    if (ctx.signal.aborted) {
      out.skipped = true;
      out.reason = 'aborted';
      session.skipped = true;
      session.reason = 'aborted';
      return out;
    }
    await ensureWorktree(ctx.layout.targetMain, worktree, spec.branch);
    await cleanWorktree(worktree);
    mkdirSync(join(worktree, '.dogfood'), { recursive: true });
    const collected = await collectJobs(ctx, spec);
    jobs = collected.jobs;
    out.jobs = jobs.length;
    if (jobs.length === 0) {
      out.skipped = true;
      out.reason = 'no_work';
      session.skipped = true;
      session.reason = 'no_work';
      return out;
    }

    const merge = await mergeMainInto(worktree);
    const mergeConflict = merge.ok ? [] : merge.conflicts;
    const mainBefore = await head(ctx.layout.targetMain);
    const branchBefore = await head(worktree);
    const seqBefore = lastSeq(await ctx.host.events());
    const testCommand = testCommandOf(ctx);
    const token = readTeammateToken(ctx.layout, spec.id);
    const scrub = scrubber(token);
    const urls = spaceUrls(ctx.host.baseUrl, spec.id);
    const live = ctx.config.mode === 'live';
    const brief = {
      teammate: spec.id, persona: spec.persona, ...(spec.memberId === undefined ? {} : { memberId: spec.memberId }), cycle: ctx.cycle, goal: ctx.goal,
      testCommand, branch: spec.branch, mergeConflict,
      space: { contextUrl: urls.contextUrl, postUrl: urls.postUrl, tokenEnv: 'DOGFOOD_SPACE_TOKEN', clientPostIdPrefix: `${spec.id}-c${ctx.cycle}` },
      board: { stateUrl: `${ctx.host.baseUrl}/api/state?me=owner`, taskUrlTemplate: `${ctx.host.baseUrl}/api/tasks/{taskId}` },
      jobs, inbox: collected.inbox,
    };

    // 3) 세션
    let report: TeammateReport;
    if (live) {
      const r = await runClaude({
        role: spec.id, cwd: worktree,
        tools: { allowed: ['Read', 'Edit', 'Write', 'Glob', 'Grep', BASH('git'), BASH('npm'), BASH('node'), BASH('curl')] },
        appendSystemPrompt: loadRolePrompt(spec.id),
        prompt: `당신은 ${spec.displayName}(${spec.id})입니다. 아래 브리프의 일감만 하고, 마지막 출력은 스키마 JSON 하나로만 답하세요.\n${JSON.stringify(brief)}`,
        jsonSchema: TEAMMATE_REPORT_SCHEMA, budgetUsd: ctx.config.teammateBudgetUsd, timeoutMs: ctx.config.sessionTimeoutMinutes * 60_000,
        env: { DOGFOOD_SPACE_TOKEN: token, DOGFOOD_SPACE_URL: ctx.host.baseUrl }, signal: ctx.signal,
        ...(ctx.config.harnessModel ? { model: ctx.config.harnessModel } : {}),
        logFile: join(ctx.layout.logs, `c${ctx.cycle}-${spec.id}.json`), redact: [token],
      });
      const until = await recordHarnessUsage(ctx, spec.id, r);
      if (until !== undefined) {
        session.error = scrub(`인프라 실패로 세션을 건너뜁니다: ${r.error ?? ''}`.trim());
        return out;
      }
      if (!r.ok || r.structured === undefined) {
        session.error = scrub(r.error ?? '구조화된 출력이 없습니다');
        report = normalizeReport(undefined, spec.branch);
      } else {
        report = normalizeReport(r.structured, spec.branch);
      }
    } else {
      report = await ruleReport(ctx, spec, jobs, worktree, branchBefore);
    }
    report = scrub(report);
    out.readyToMerge = report.readyToMerge;

    // 보고(주장)를 일감 범위로 좁힌다.
    const allowedItems = new Set(jobs.flatMap((j) => j.backlogItems));
    const allowedTasks = new Set(jobs.filter((j) => BOARD_JOB_KINDS.has(j.kind)).map((j) => j.ref));
    const items = report.backlogItems.filter((id) => allowedItems.has(id));
    const taskIds = report.taskIds.filter((id) => allowedTasks.has(id));
    const label = (items.length > 0 ? items : taskIds.length > 0 ? taskIds : jobs.map((j) => j.ref)).join(',');

    // 4) 하네스 머지. 아직 main에 없는 커밋(이전 사이클의 것 포함)이 있을 때만 한다.
    const branchAfter = await head(worktree);
    const newCommits = await commitsBetween(worktree, branchBefore, branchAfter);
    const newFiles = newCommits.length > 0 ? await changedFiles(worktree, branchBefore, branchAfter) : [];
    const forbidden = newFiles.filter((f) => FORBIDDEN_PATH.test(f));
    if (forbidden.length > 0) session.violations = forbidden;
    const unmerged = await commitsBetween(worktree, 'main', branchAfter);
    let merged = false;
    let conflicts: string[] = [];
    if (report.readyToMerge && unmerged.length > 0 && forbidden.length === 0 && session.error === undefined) {
      const m = await mergeBranchIntoMain(ctx.layout.targetMain, spec.branch, `${spec.id}: ${label}`);
      merged = m.ok;
      conflicts = m.conflicts;
      if (!m.ok) {
        await postToSpace(ctx, spec, token, { kind: 'blocked', text: `[${label}] main 머지 충돌: ${conflicts.join(', ')}`, clientPostId: `${spec.id}-c${ctx.cycle}-conflict` });
        await ctx.ledger.record('dogfood_manual_integration', {
          by: spec.id, branch: spec.branch, into: 'main', commit: mainBefore, files: [], cycle: ctx.cycle, backlogItems: items, taskIds: [], conflicts,
        }, { key: `manual-integration:${spec.id}:c${ctx.cycle}`, actor: spec.id });
      }
    }
    out.merged = merged;
    out.conflicts = conflicts;

    // 5) rule에서는 머지 성공 뒤 하네스가 게시한다. live에서는 팀원이 직접 게시했다.
    if (!live && merged) {
      if (spec.persona === 'local-first') {
        for (const id of items) {
          await postToSpace(ctx, spec, token, {
            kind: 'result', text: `[${id}] 로컬에서 구현해 main에 머지했습니다. 브랜치 ${spec.branch}, 파일 notes/${docName(id)}.md`, clientPostId: `${spec.id}-c${ctx.cycle}-${id}`,
          });
        }
      } else {
        await postToSpace(ctx, spec, token, {
          kind: 'note', text: `[${label}] ${report.filesChanged.join(', ')}를 main에 머지했고 보드에 결과를 제출합니다.`, clientPostId: `${spec.id}-c${ctx.cycle}-merged`,
        });
      }
    }
    if (!live && report.worked) {
      const answered: string[] = [];
      for (const req of collected.inbox) {
        const ok = await postToSpace(ctx, spec, token, { kind: 'note', text: '요청을 확인했고 이번 사이클 작업에 반영했습니다.', clientPostId: `${spec.id}-c${ctx.cycle}-reply-${req.requestId}`, inReplyTo: req.requestId });
        if (ok) answered.push(req.requestId);
      }
      report.inboxAnswered = answered;
    }

    // 6) 검증
    const afterEvents = await ctx.host.events();
    const fresh = afterEvents.filter((e) => e.seq > seqBefore);
    const postIds = (fresh as readonly AnyEvent[]).flatMap((e) => (e.type === 'space_post_recorded' && e.payload.participantId === spec.id ? [e.payload.postId] : []));
    if (token && JSON.stringify(fresh).includes(token)) {
      await ctx.ledger.record('dogfood_role_note', { role: spec.id, cycle: ctx.cycle, kind: 'info', text: '토큰 문자열이 제품 원장에 나타났습니다. 팀원이 토큰을 출력했을 수 있습니다.' }, { key: `token-leak:${spec.id}:c${ctx.cycle}`, actor: spec.id });
    }

    // 7) 보드 결과 제출. 머지 충돌이나 금지 파일 변경이 있으면 통합되지 않은 일이라 올리지 않는다.
    if (report.readyToMerge && conflicts.length === 0 && forbidden.length === 0 && session.error === undefined) {
      for (const d of report.deliverables) {
        const job = jobs.find((j) => BOARD_JOB_KINDS.has(j.kind) && j.ref === d.taskId);
        if (!job || job.assignee === undefined) continue;
        const first = !submissionsIn(await ctx.ledger.read()).some((s) => s.taskId === job.ref);
        try {
          await submitHumanResult(ctx, {
            memberId: job.assignee, actor: spec.id, taskId: job.ref, text: cleanSummary(d.summary, `"${job.title}" 결과를 올립니다.`),
            files: attachmentsFor(worktree, d, job, spec.branch, newCommits), firstSubmission: first,
          });
          out.submitted.push(job.ref);
        } catch (error) {
          await ctx.ledger.record('dogfood_role_note', {
            role: spec.id, memberId: job.assignee, cycle: ctx.cycle, kind: 'info', text: scrub(`결과를 제출하지 못했습니다(${job.ref}): ${error instanceof Error ? error.message : String(error)}`),
          }, { actor: spec.id });
        }
      }
    }

    // 8) main이 바뀌었으면 통합 기록과 통합 테스트
    const mainAfter = await head(ctx.layout.targetMain);
    let test: TestRun | undefined;
    if (mainAfter !== mainBefore) {
      await ctx.ledger.record('dogfood_manual_integration', {
        by: spec.id, branch: spec.branch, into: 'main', commit: mainAfter, files: await changedFiles(ctx.layout.targetMain, mainBefore, mainAfter),
        cycle: ctx.cycle, backlogItems: items, taskIds: out.submitted,
      }, { key: `manual-integration:${spec.id}:c${ctx.cycle}`, actor: spec.id });
      test = await runTests(ctx.layout.targetMain, testCommand);
      out.integrationPassed = test.passed;
      await ctx.ledger.record('dogfood_integration_test', {
        commit: mainAfter, passed: test.passed, ok: test.passed, code: test.code, timedOut: test.timedOut, tail: test.tail,
        command: testCommand, by: spec.id, cycle: ctx.cycle,
      }, { key: `integration-test:${spec.id}:c${ctx.cycle}`, actor: spec.id });
    }

    // 9) backlog_progress: main에 들어간 팀원 커밋의 항목 중 통합 테스트가 통과한 것
    if (test?.passed === true && merged && (await isAncestor(ctx.layout.targetMain, branchAfter, mainAfter))) {
      for (const itemId of items) {
        await ctx.ledger.record('dogfood_backlog_progress', {
          itemId, status: 'done', by: spec.id, evidence: `main ${mainAfter.slice(0, 8)} 통합 테스트 통과(${spec.branch} 머지)`,
        }, { key: `backlog-progress:${itemId}`, actor: spec.id });
        out.progress.push(itemId);
      }
    }

    Object.assign(session, {
      summary: report.summary, worked: report.worked, backlogItems: items, taskIds,
      commits: newCommits, filesChanged: newFiles, postedToSpace: report.postedToSpace, postIds, testsPassed: report.testsPassed,
      mergeConflict, conflicts, merged, submitted: out.submitted, inboxAnswered: report.inboxAnswered, frictions: report.frictions,
      claimed: { backlogItems: report.backlogItems, taskIds: report.taskIds, commits: report.commits.length, filesChanged: report.filesChanged, postedToSpace: report.postedToSpace },
      verified: { commits: newCommits.length, files: newFiles, postIds: postIds.length, unmerged: unmerged.length, mainAfter, integrationPassed: test?.passed ?? null },
    });
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let token = '';
    try { token = readTeammateToken(ctx.layout, spec.id); } catch { /* 연결 전 */ }
    session.error = scrubber(token)(message);
    out.error = session.error as string;
    return out;
  } finally {
    if (session.error !== undefined && out.error === undefined) out.error = session.error as string;
    await ctx.ledger.record('dogfood_teammate_session', {
      ...session, jobs: jobs.map((j) => ({ kind: j.kind, ref: j.ref })), readyToMerge: out.readyToMerge,
    }, { key: `teammate-session:${spec.id}:c${ctx.cycle}`, actor: spec.id });
  }
}
