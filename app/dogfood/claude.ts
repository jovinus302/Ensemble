// claude 실행기: 실행 파일 해석, PATH 보정, headless claude -p 실행·파싱·중단, 인프라 실패 분류.
// 제품의 셸 없는 spawn('claude')(connector.ts:159, llm/src/cli.ts:42)는 Windows에서 claude.cmd를
// 실행하지 못한다. 하네스는 claude.exe를 직접 찾아서 쓰고, 제품에는 PATH 앞붙임으로만 알린다.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, win32 } from 'node:path';
import type { UsageRecord } from './ledger.ts';

export type ClaudeSource = 'env' | 'posix' | 'path-exe' | 'npm-shim' | 'local-bin';

export interface ClaudeResolution {
  exe: string;
  source: ClaudeSource;
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  home?: string;
}

/** 허용 도구 패턴. 팀원과 프로브가 이 상수를 쓴다. 예: BASH('git') -> 'Bash(git *)'. */
export const BASH = (cmd: string): string => `Bash(${cmd} *)`;

/** 실행 중인 claude 자식 프로세스 pid. 정리 단계가 남은 것을 끝낸다. */
export const childPids = new Set<number>();

/** 인자 하나(시스템 프롬프트·스키마)의 상한. Windows 명령줄 길이를 지키기 위해서다. */
export const ARG_LIMIT_CHARS = 6000;

export function resolveClaudeExecutable(o: ResolveOptions = {}): ClaudeResolution {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const exists = o.exists ?? existsSync;
  const home = o.home ?? homedir();
  if (env.DOGFOOD_FORBID_CLAUDE === '1') throw new Error('이 실행에서는 claude 호출이 금지돼 있습니다(DOGFOOD_FORBID_CLAUDE)');
  const forced = env.DOGFOOD_CLAUDE_EXE;
  if (forced) {
    if (!exists(forced)) throw new Error(`DOGFOOD_CLAUDE_EXE 경로에 파일이 없습니다: ${forced}`);
    return { exe: forced, source: 'env' };
  }
  if (platform !== 'win32') return { exe: 'claude', source: 'posix' };
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  for (const dir of dirs) {
    const exe = win32.join(dir, 'claude.exe');
    if (exists(exe)) return { exe, source: 'path-exe' };
  }
  for (const dir of dirs) {
    if (!exists(win32.join(dir, 'claude.cmd'))) continue;
    const exe = win32.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (exists(exe)) return { exe, source: 'npm-shim' };
  }
  const local = win32.join(home, '.local', 'bin', 'claude.exe');
  if (exists(local)) return { exe: local, source: 'local-bin' };
  throw new Error('claude.exe를 찾지 못했습니다. PATH, npm 전역 설치(claude.cmd 옆 node_modules), ~/.local/bin을 확인하거나 DOGFOOD_CLAUDE_EXE를 설정하세요');
}

/** win32이고 exe의 디렉터리가 PATH에 없을 때만 앞에 붙이고 true를 돌려준다. env를 직접 고친다. */
export function ensureClaudeOnPath(exe: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  const dir = win32.dirname(exe);
  if (dir === '.' || dir === exe) return false;
  const key = 'PATH' in env ? 'PATH' : 'Path' in env ? 'Path' : 'PATH';
  const parts = (env[key] ?? '').split(';').filter(Boolean);
  const norm = (p: string) => win32.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
  if (parts.some((p) => norm(p) === norm(dir))) return false;
  env[key] = [dir, ...parts].join(';');
  return true;
}

export function claudeVersion(exe: string): string | null {
  try {
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    if (r.status !== 0) return null;
    return r.stdout.trim().split(/\r?\n/)[0] ?? null;
  } catch {
    return null;
  }
}

export interface ParsedClaudeOutput {
  ok: boolean;
  text: string;
  structured?: unknown;
  usage: UsageRecord;
  model: string;
  costUsd: number | null;
  sessionId: string;
  durationMs: number | null;
  error?: string;
}

function zeroUsage(): UsageRecord {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: null, cacheCreationTokens: null };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function resultObject(stdout: string): Record<string, unknown> | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  const candidates: unknown[] = [];
  try {
    const value = JSON.parse(trimmed) as unknown;
    candidates.push(...(Array.isArray(value) ? value : [value]));
  } catch {
    for (const line of trimmed.split(/\r?\n/)) {
      try { candidates.push(JSON.parse(line)); } catch { /* 잡음 */ }
    }
  }
  return candidates.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'result').at(-1);
}

/** 코드 펜스로 감싼 JSON 객체 하나를 읽는다. 아니면 undefined. */
function fencedJson(text: string): unknown {
  const t = text.trim();
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(t);
  try {
    const v = JSON.parse(m ? m[1]! : t) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** claude -p --output-format json 출력을 해석한다. modelUsage를 합산하고 입력에는 캐시 토큰을 포함한다. */
export function parseClaudeOutput(stdout: string): ParsedClaudeOutput {
  const r = resultObject(stdout);
  if (!r) return { ok: false, text: '', usage: zeroUsage(), model: '', costUsd: null, sessionId: '', durationMs: null, error: '결과 없음' };
  const modelUsage = (r.modelUsage && typeof r.modelUsage === 'object' ? r.modelUsage : {}) as Record<string, Record<string, unknown>>;
  const models = Object.keys(modelUsage);
  let usage: UsageRecord;
  let costUsd: number | null = null;
  if (models.length > 0) {
    let input = 0, output = 0, read = 0, creation = 0, cost = 0;
    for (const m of models) {
      const u = modelUsage[m] ?? {};
      read += num(u.cacheReadInputTokens);
      creation += num(u.cacheCreationInputTokens);
      input += num(u.inputTokens);
      output += num(u.outputTokens);
      cost += num(u.costUSD);
    }
    usage = { inputTokens: input + read + creation, outputTokens: output, cacheReadTokens: read, cacheCreationTokens: creation };
    costUsd = typeof r.total_cost_usd === 'number' ? r.total_cost_usd : cost;
  } else {
    const u = (r.usage && typeof r.usage === 'object' ? r.usage : {}) as Record<string, unknown>;
    const read = num(u.cache_read_input_tokens);
    const creation = num(u.cache_creation_input_tokens);
    usage = { inputTokens: num(u.input_tokens) + read + creation, outputTokens: num(u.output_tokens), cacheReadTokens: read, cacheCreationTokens: creation };
    if (typeof r.total_cost_usd === 'number') costUsd = r.total_cost_usd;
  }
  const text = typeof r.result === 'string' ? r.result : '';
  const structured = r.structured_output && typeof r.structured_output === 'object' ? r.structured_output : fencedJson(text);
  const base = {
    text,
    ...(structured === undefined ? {} : { structured }),
    usage,
    model: models[0] ?? '',
    costUsd,
    sessionId: typeof r.session_id === 'string' ? r.session_id : '',
    durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : null,
  };
  if (r.is_error === true || (typeof r.subtype === 'string' && r.subtype !== 'success')) {
    return { ok: false, ...base, error: text || String(r.subtype ?? 'is_error') };
  }
  return { ok: true, ...base };
}

const INFRA = /usage limit|rate limit|\b429\b|overloaded|resets? at|Invalid API key|OAuth|not logged in|log ?in|\b401\b|credit balance/i;

/** 사용량 한도·로그인·과부하처럼 하네스 밖의 사정이면 'infra'. 그 밖은 'other'. */
export function classifyCliFailure(text: string): 'infra' | 'other' {
  return INFRA.test(text) ? 'infra' : 'other';
}

export type ClaudeTools = 'none' | { allowed: string[]; disallowed?: string[] };

export interface ClaudeRunInput {
  role: string;
  prompt: string;
  cwd: string;
  tools: ClaudeTools;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  jsonSchema?: object;
  model?: string;
  effort?: string;
  budgetUsd?: number;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  logFile?: string;
  redact?: string[];
  signal?: AbortSignal;
}

export interface ClaudeRunResult extends ParsedClaudeOutput {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  failureKind: 'infra' | 'other' | null;
  stderrTail: string;
}

const ALWAYS_DISALLOWED = ['Agent', 'Task', 'WebFetch', 'WebSearch'];
const SECRET_FLAGS = new Set(['--system-prompt', '--append-system-prompt', '--json-schema']);

function limited(name: string, value: string): string {
  if (value.length > ARG_LIMIT_CHARS) throw new Error(`${name}가 ${ARG_LIMIT_CHARS}자를 넘습니다(${value.length}자)`);
  return value;
}

/** claude 인자 목록. --max-turns와 --bare는 쓰지 않는다. */
export function buildClaudeArgs(input: ClaudeRunInput): string[] {
  const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', ''];
  if (input.tools === 'none') {
    args.push('--tools', '');
  } else {
    const disallowed = [...new Set([...(input.tools.disallowed ?? []), ...ALWAYS_DISALLOWED])];
    args.push('--permission-mode', 'acceptEdits', '--allowedTools', input.tools.allowed.join(','), '--disallowedTools', disallowed.join(','));
  }
  if (input.budgetUsd !== undefined) args.push('--max-budget-usd', String(input.budgetUsd));
  if (input.model) args.push('--model', input.model);
  if (input.effort) args.push('--effort', input.effort);
  if (input.systemPrompt) args.push('--system-prompt', limited('systemPrompt', input.systemPrompt));
  if (input.appendSystemPrompt) args.push('--append-system-prompt', limited('appendSystemPrompt', input.appendSystemPrompt));
  if (input.jsonSchema) args.push('--json-schema', limited('jsonSchema', JSON.stringify(input.jsonSchema)));
  return args;
}

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined);
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch { /* 이미 끝난 프로세스 */ }
}

function writeLog(input: ClaudeRunInput, exe: string, args: string[], result: ClaudeRunResult, stdout: string): void {
  if (!input.logFile) return;
  const shown = args.map((a, i) => (SECRET_FLAGS.has(args[i - 1] ?? '') ? '<생략>' : a));
  let text = JSON.stringify({
    role: input.role, exe, cwd: input.cwd, args: shown, prompt: '<생략>',
    ok: result.ok, exitCode: result.exitCode, timedOut: result.timedOut, aborted: result.aborted,
    failureKind: result.failureKind, error: result.error ?? null, usage: result.usage, model: result.model, costUsd: result.costUsd,
    result: result.text.slice(0, 4000), stderrTail: result.stderrTail, stdoutTail: result.ok ? undefined : stdout.slice(-2000),
  }, null, 2);
  for (const s of input.redact ?? []) {
    if (!s) continue;
    text = text.split(JSON.stringify(s).slice(1, -1)).join('***').split(s).join('***');
  }
  mkdirSync(dirname(input.logFile), { recursive: true });
  writeFileSync(input.logFile, text);
}

interface RawRun {
  out: string;
  err: string;
  code: number | null;
  timedOut: boolean;
  aborted: boolean;
  spawnError?: string;
}

/** claude -p 한 번을 돌린다. 실패해도 reject하지 않고 ok:false로 돌려준다(금지·인자 상한 위반만 throw). */
export async function runClaude(input: ClaudeRunInput): Promise<ClaudeRunResult> {
  const env = { ...process.env, ...input.env };
  const { exe } = resolveClaudeExecutable({ env });
  const args = buildClaudeArgs(input);
  const started = Date.now();
  const raw = await new Promise<RawRun>((resolve) => {
    let out = '';
    let err = '';
    let timedOut = false;
    let aborted = false;
    let done = false;
    let grace: NodeJS.Timeout | undefined;
    let child;
    try {
      child = spawn(exe, args, { cwd: input.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ out, err, code: null, timedOut, aborted, spawnError: (e as Error).message });
      return;
    }
    const pid = child.pid;
    if (pid !== undefined) childPids.add(pid);
    const finish = (code: number | null, spawnError?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      input.signal?.removeEventListener('abort', onAbort);
      if (pid !== undefined) childPids.delete(pid);
      resolve({ out, err, code, timedOut, aborted, ...(spawnError ? { spawnError } : {}) });
    };
    const stop = () => {
      if (pid !== undefined) killTree(pid);
      // 종료 이벤트가 오지 않아도 하네스가 멈추지 않도록 상한을 둔다.
      grace = setTimeout(() => finish(null), 10_000);
      grace.unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, input.timeoutMs);
    const onAbort = () => { aborted = true; stop(); };
    if (input.signal?.aborted) onAbort();
    else input.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { out += c; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => { err = (err + c).slice(-4000); });
    child.once('error', (e) => finish(null, e.message));
    child.once('close', (code) => finish(code));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input.prompt);
  });
  const parsed = parseClaudeOutput(raw.out);
  const stderrTail = raw.err.trim().slice(-2000);
  let error = parsed.error;
  let ok = parsed.ok;
  if (raw.spawnError) { ok = false; error = `claude를 실행하지 못했습니다: ${raw.spawnError}`; }
  else if (raw.timedOut) { ok = false; error = `제한 시간(${Math.round(input.timeoutMs / 1000)}초)을 넘겨 중단했습니다`; }
  else if (raw.aborted) { ok = false; error = '중단 신호로 끝냈습니다'; }
  else if (ok && raw.code !== 0) { ok = false; error = `claude가 비정상 종료했습니다(code ${raw.code})`; }
  else if (!ok && !error) error = `종료 코드 ${raw.code}`;
  const result: ClaudeRunResult = {
    ...parsed,
    ok,
    ...(error === undefined ? {} : { error }),
    durationMs: parsed.durationMs ?? Date.now() - started,
    exitCode: raw.code,
    timedOut: raw.timedOut,
    aborted: raw.aborted,
    failureKind: ok ? null : classifyCliFailure(`${error ?? ''}\n${stderrTail}`),
    stderrTail,
  };
  writeLog(input, exe, args, result, raw.out);
  return result;
}
