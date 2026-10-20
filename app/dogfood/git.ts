// 도그푸딩 하네스 git 헬퍼: 대상 레포 준비, 팀원 worktree, 머지, 통합 테스트 실행.
// 제품 코드는 건드리지 않는다. git은 항상 -c core.longpaths=true로 부른다(Windows 긴 경로).
import { spawn, type SpawnOptions } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DogfoodConfig, RunLayout } from './config.ts';
import type { DogfoodLedger } from './ledger.ts';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  timeoutMs?: number;
  /** true면 종료 코드가 0이 아니어도 던지지 않고 결과를 돌려준다. */
  allowFail?: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** git을 실행한다. 기본은 실패하면 던진다. */
export function git(cwd: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-c', 'core.longpaths=true', ...args], { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`git ${args.join(' ')} 시간 초과(${timeoutMs}ms)`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error.code === 'ENOENT' ? new Error('git을 찾을 수 없습니다. git을 설치하고 PATH에 추가하세요.') : error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = { code: code ?? -1, stdout, stderr };
      if (result.code !== 0 && opts.allowFail !== true) {
        reject(new Error(`git ${args.join(' ')} 실패(종료 ${result.code}): ${(stderr || stdout).trim()}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

/** git 실행 파일이 있는지. */
export async function gitAvailable(): Promise<boolean> {
  try {
    await git(process.cwd(), ['--version'], { timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Ensemble 제품 코드의 현재 커밋과 변경 여부. dirty는 app/packages·app/apps만 본다. */
export async function productState(root: string): Promise<{ commit: string; dirty: boolean }> {
  const commit = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const status = (await git(root, ['status', '--porcelain', '--', 'app/packages', 'app/apps'])).stdout.trim();
  return { commit, dirty: status !== '' };
}

export async function head(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
}

function seedDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), 'seed-project');
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

async function configureRepo(dir: string): Promise<void> {
  await git(dir, ['config', 'user.name', 'Dogfood Teammate']);
  await git(dir, ['config', 'user.email', 'teammate@localhost']);
  await git(dir, ['config', 'core.autocrlf', 'false']);
}

/** 대상 레포를 runDir/target/main에 준비한다. 재개는 지원하지 않는다. */
export async function bootstrapTarget(config: DogfoodConfig, layout: RunLayout, ledger: DogfoodLedger): Promise<void> {
  const dest = layout.targetMain;
  if (existsSync(dest)) throw new Error(`target/main이 이미 있습니다(재개 미지원): ${dest}`);
  const source = config.continueFrom !== undefined ? join(config.continueFrom, 'target', 'main') : config.target;
  if (source === undefined) throw new Error('대상 레포가 없습니다: --target 또는 --continue-from이 필요합니다');
  mkdirSync(dirname(dest), { recursive: true });

  if (source === 'seed') {
    cpSync(seedDir(), dest, { recursive: true });
    await git(dest, ['init', '-b', 'main']);
    // 사용자 설정이 없는 환경에서도 seed 커밋이 되도록 커밋 전에 설정한다.
    await configureRepo(dest);
    await git(dest, ['add', '-A']);
    await git(dest, ['commit', '-m', 'seed']);
  } else {
    if (!existsSync(source)) throw new Error(`대상 레포 경로가 없습니다: ${source}`);
    await git(dirname(dest), ['clone', '--no-hardlinks', source, dest]);
    await git(dest, ['checkout', '-B', 'main']);
    await configureRepo(dest);
  }

  // info/exclude는 worktree와 공유된다. 팀원 worktree의 .ensemble/·.dogfood/도 status에서 빠진다.
  const exclude = join(dest, '.git', 'info', 'exclude');
  mkdirSync(dirname(exclude), { recursive: true });
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  const missing = ['.ensemble/', '.dogfood/'].filter((p) => !lines(current).includes(p));
  if (missing.length > 0) appendFileSync(exclude, (current === '' || current.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n');

  await ledger.record('dogfood_setup_step', { step: 'target_ready', head: await head(dest), source });
}

/** 팀원 worktree를 만든다. 이미 있으면 그대로 둔다. 브랜치가 없으면 main에서 만든다. */
export async function ensureWorktree(targetMain: string, worktree: string, branch: string): Promise<void> {
  if (existsSync(worktree)) return;
  mkdirSync(dirname(worktree), { recursive: true });
  const exists = (await git(targetMain, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true })).code === 0;
  await git(targetMain, exists ? ['worktree', 'add', worktree, branch] : ['worktree', 'add', '-b', branch, worktree, 'main']);
}

/** base 이후 ref(기본 HEAD)에서 바뀐 파일. */
export async function changedFiles(cwd: string, base: string, ref = 'HEAD'): Promise<string[]> {
  return lines((await git(cwd, ['diff', '--name-only', base, ref])).stdout);
}

/** from 이후 to까지의 커밋(오래된 것부터). */
export async function commitsBetween(cwd: string, from: string, to: string): Promise<string[]> {
  return lines((await git(cwd, ['rev-list', '--reverse', `${from}..${to}`])).stdout);
}

export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFail: true })).code === 0;
}

export interface MergeResult {
  ok: boolean;
  conflicts: string[];
}

async function mergeOrAbort(cwd: string, args: string[]): Promise<MergeResult> {
  const result = await git(cwd, ['merge', ...args], { allowFail: true });
  if (result.code === 0) return { ok: true, conflicts: [] };
  const conflicts = lines((await git(cwd, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).stdout);
  await git(cwd, ['merge', '--abort'], { allowFail: true });
  if (conflicts.length === 0) throw new Error(`git merge 실패: ${(result.stderr || result.stdout).trim()}`);
  return { ok: false, conflicts };
}

/** 팀원 worktree에 main을 머지한다. 충돌이면 abort하고 충돌 파일을 돌려준다. */
export function mergeMainInto(worktree: string): Promise<MergeResult> {
  return mergeOrAbort(worktree, ['--no-edit', 'main']);
}

/** 팀원 브랜치를 main에 머지한다(--no-ff). 충돌이면 abort하여 main을 깨끗하게 둔다. */
export function mergeBranchIntoMain(targetMain: string, branch: string, message: string): Promise<MergeResult> {
  return mergeOrAbort(targetMain, ['--no-ff', '-m', message, branch]);
}

/**
 * 테스트 자식 프로세스용 환경. app의 node --test 자식에서 상속되면
 * 중첩된 node --test가 'run() is being called recursively'만 출력하고 exit 0으로 끝난다.
 */
export function cleanTestEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_') || key.startsWith('TSX_')) delete env[key];
  }
  return env;
}

export interface TestRun {
  passed: boolean;
  code: number | null;
  timedOut: boolean;
  tail: string;
}

/** 대상 레포에서 테스트 명령을 실행한다. 시간을 넘기면 프로세스 트리를 끝낸다. */
export function runTests(cwd: string, command: string, timeoutMs = 300_000): Promise<TestRun> {
  return new Promise((resolvePromise) => {
    const options: SpawnOptions = { cwd, shell: true, windowsHide: true, env: cleanTestEnv() };
    const child = spawn(command, options);
    let out = '';
    let timedOut = false;
    const collect = (d: Buffer) => {
      out += d.toString('utf8');
      if (out.length > 200_000) out = out.slice(-100_000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    const finish = (code: number | null, extra = '') => {
      clearTimeout(timer);
      let passed = code === 0 && !timedOut;
      let tail = (extra + out).slice(-2000);
      if (out.includes('recursively within a test file')) {
        passed = false;
        tail = ('[하네스] 중첩 테스트 감지\n' + tail).slice(-2000);
      }
      resolvePromise({ passed, code, timedOut, tail });
    };
    child.on('error', (error) => finish(-1, `${error.message}\n`));
    child.on('close', (code) => finish(code));
  });
}
