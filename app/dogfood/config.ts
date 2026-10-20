// 도그푸딩 하네스 설정: 인자 파싱, runDir 배치, 잠금, 제품 환경 변수 주입.
// 제품 코드는 건드리지 않는다. 제품은 환경 변수로만 설정한다.
import { parseArgs as nodeParseArgs } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DogfoodMode = 'live' | 'rule';
export type Command = 'run' | 'smoke' | 'report' | 'preflight';

export interface DogfoodConfig {
  runId: string;
  runDir: string;
  iteration: 1 | 2 | 3;
  mode: DogfoodMode;
  target?: string;
  continueFrom?: string;
  maxCycles: number;
  cycleMinutes: number;
  maxHours: number;
  budgetTokens: number;
  teammates: 1 | 2;
  probeEvery: number;
  port: number;
  pmRuntime: 'claude' | 'api';
  agentRuntime: 'claude' | 'codex';
  nextStepAssignee: 'pm' | 'designer';
  harnessModel?: string;
  sessionTimeoutMinutes: number;
  teammateBudgetUsd: number;
  proxyBudgetUsd: number;
  settleSeconds: number;
  humanResultWaitSeconds: number;
  argvLimit: number;
  envFile?: string;
  skipLive: boolean;
}

export interface ParsedArgs {
  command: Command;
  config: DogfoodConfig;
  compareRunDir?: string;
}

const COMMANDS: readonly Command[] = ['run', 'smoke', 'report', 'preflight'];

/** app/ 디렉터리 절대 경로. */
export function appDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** Ensemble 저장소 루트(app/의 부모). */
export function repoRoot(): string {
  return resolve(appDir(), '..');
}

/** child가 parent 안(같은 경로 포함)에 있는지. win32는 대소문자를 구분하지 않고, 다른 드라이브는 밖으로 본다. */
export function isInside(child: string, parent: string): boolean {
  let c = resolve(child);
  let p = resolve(parent);
  if (process.platform === 'win32') {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  const rel = relative(p, c);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertOutsideRepo(runDir: string): void {
  if (isInside(runDir, repoRoot())) {
    throw new Error(`runDir은 Ensemble 저장소 밖이어야 합니다: ${runDir}`);
  }
}

export function assertFreshRunDir(runDir: string): void {
  if (existsSync(runDir) && readdirSync(runDir).length > 0) {
    throw new Error(`재개는 지원하지 않습니다. 새 --run-dir을 쓰거나 report로 부분 결과를 보세요: ${runDir}`);
  }
}

export interface RunLayout {
  root: string;
  data: string;
  agents: string;
  targetMain: string;
  teammate(id: string): string;
  secrets: string;
  ledger: string;
  logs: string;
  probeCwd: string;
  report: string;
  metrics: string;
  runJson: string;
  envFile: string;
  lock: string;
}

export function runLayout(runDir: string): RunLayout {
  return {
    root: runDir,
    data: join(runDir, 'data'),
    agents: join(runDir, 'agents'),
    targetMain: join(runDir, 'target', 'main'),
    teammate: (id: string) => join(runDir, 'target', `teammate-${id}`),
    secrets: join(runDir, 'secrets'),
    ledger: join(runDir, 'dogfood.db'),
    logs: join(runDir, 'logs'),
    probeCwd: join(runDir, 'probe-cwd'),
    report: join(runDir, 'report.md'),
    metrics: join(runDir, 'metrics.json'),
    runJson: join(runDir, 'run.json'),
    envFile: join(runDir, '.env.dogfood'),
    lock: join(runDir, '.lock'),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function defaultRunDir(iteration: number, now: Date): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return join(homedir(), 'ensemble-dogfood', `${stamp}-iter${iteration}`);
}

function intFlag(name: string, raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name}은 ${min} 이상의 정수여야 합니다: ${raw}`);
  return n;
}

function numFlag(name: string, raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) throw new Error(`--${name}은 ${min} 이상의 숫자여야 합니다: ${raw}`);
  return n;
}

function choice<T extends string>(name: string, raw: string | undefined, allowed: readonly T[], fallback: T): T {
  if (raw === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) throw new Error(`--${name}은 ${allowed.join('|')} 중 하나여야 합니다: ${raw}`);
  return raw as T;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      target: { type: 'string' },
      'continue-from': { type: 'string' },
      'run-dir': { type: 'string' },
      iteration: { type: 'string' },
      mode: { type: 'string' },
      'max-cycles': { type: 'string' },
      'cycle-minutes': { type: 'string' },
      'max-hours': { type: 'string' },
      'budget-tokens': { type: 'string' },
      teammates: { type: 'string' },
      'probe-every': { type: 'string' },
      port: { type: 'string' },
      'pm-runtime': { type: 'string' },
      'agent-runtime': { type: 'string' },
      'next-step-assignee': { type: 'string' },
      'harness-model': { type: 'string' },
      'session-timeout-minutes': { type: 'string' },
      'teammate-budget-usd': { type: 'string' },
      'proxy-budget-usd': { type: 'string' },
      'settle-seconds': { type: 'string' },
      'human-result-wait-seconds': { type: 'string' },
      'argv-limit': { type: 'string' },
      'env-file': { type: 'string' },
      compare: { type: 'string' },
      'skip-live': { type: 'boolean' },
    },
  });

  const command = positionals[0] as Command | undefined;
  if (command === undefined || !COMMANDS.includes(command)) {
    throw new Error(`명령은 ${COMMANDS.join('|')} 중 하나여야 합니다: ${command ?? '(없음)'}`);
  }
  if (positionals.length > 1) throw new Error(`알 수 없는 인자입니다: ${positionals.slice(1).join(' ')}`);

  const smoke = command === 'smoke';
  const mode = choice<DogfoodMode>('mode', values.mode, ['live', 'rule'], smoke ? 'rule' : 'live');
  const quick = mode === 'rule';

  let teammates: 1 | 2 = 2;
  if (values.teammates !== undefined) {
    if (values.teammates !== '1' && values.teammates !== '2') {
      throw new Error(`팀원은 1명 이상이어야 합니다: 템플릿 flow는 designer 담당 (받은 값: ${values.teammates}, 허용: 1|2)`);
    }
    teammates = Number(values.teammates) as 1 | 2;
  }

  if (values['pm-runtime'] === 'codex') {
    throw new Error('이 하네스는 codex PM을 지원하지 않습니다(제품 기본 codex PM과 계량 래퍼가 다름)');
  }
  const pmRuntime = choice<'claude' | 'api'>('pm-runtime', values['pm-runtime'], ['claude', 'api'], 'claude');
  const agentRuntime = choice<'claude' | 'codex'>('agent-runtime', values['agent-runtime'], ['claude', 'codex'], 'claude');
  const nextStepAssignee = choice<'pm' | 'designer'>('next-step-assignee', values['next-step-assignee'], ['pm', 'designer'], 'pm');
  const iteration = Number(choice<'1' | '2' | '3'>('iteration', values.iteration, ['1', '2', '3'], '1')) as 1 | 2 | 3;

  const target = smoke ? (values.target ?? 'seed') : values.target;
  const continueFrom = values['continue-from'];

  if (command === 'run' && target === undefined && continueFrom === undefined) {
    throw new Error('run에는 --target 또는 --continue-from이 필요합니다');
  }
  if (command === 'report' && values['run-dir'] === undefined) {
    throw new Error('report에는 --run-dir이 필요합니다');
  }

  const runDir = resolve(
    values['run-dir'] ?? (smoke ? mkdtempSync(join(tmpdir(), 'ensemble-dogfood-smoke-')) : defaultRunDir(iteration, new Date())),
  );

  const config: DogfoodConfig = {
    runId: basename(runDir),
    runDir,
    iteration,
    mode,
    maxCycles: intFlag('max-cycles', values['max-cycles'], smoke ? 20 : 120, 1),
    cycleMinutes: numFlag('cycle-minutes', values['cycle-minutes'], smoke ? 0 : 20, 0),
    maxHours: numFlag('max-hours', values['max-hours'], 48, 0),
    budgetTokens: numFlag('budget-tokens', values['budget-tokens'], 20_000_000, 0),
    teammates,
    probeEvery: intFlag('probe-every', values['probe-every'], smoke ? 2 : 3, 1),
    port: intFlag('port', values.port, 0, 0),
    pmRuntime,
    agentRuntime,
    nextStepAssignee,
    sessionTimeoutMinutes: numFlag('session-timeout-minutes', values['session-timeout-minutes'], 25, 1),
    teammateBudgetUsd: numFlag('teammate-budget-usd', values['teammate-budget-usd'], 3, 0),
    proxyBudgetUsd: numFlag('proxy-budget-usd', values['proxy-budget-usd'], 0.5, 0),
    settleSeconds: numFlag('settle-seconds', values['settle-seconds'], quick ? 10 : 300, 0),
    humanResultWaitSeconds: numFlag('human-result-wait-seconds', values['human-result-wait-seconds'], quick ? 15 : 300, 0),
    argvLimit: intFlag('argv-limit', values['argv-limit'], 30000, 1),
    skipLive: values['skip-live'] === true,
  };
  if (target !== undefined) config.target = target;
  if (continueFrom !== undefined) config.continueFrom = continueFrom;
  if (values['harness-model'] !== undefined) config.harnessModel = values['harness-model'];
  if (values['env-file'] !== undefined) config.envFile = resolve(values['env-file']);

  const parsed: ParsedArgs = { command, config };
  if (values.compare !== undefined) parsed.compareRunDir = resolve(values.compare);
  return parsed;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM은 프로세스는 있으나 권한이 없다는 뜻이라 살아 있는 것으로 본다.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** runDir 잠금. 같은 runDir을 두 하네스가 동시에 쓰지 못하게 한다. */
export function acquireLock(layout: RunLayout): { release(): void } {
  mkdirSync(layout.root, { recursive: true });
  const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  let created = true;
  try {
    writeFileSync(layout.lock, body, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    created = false;
  }
  if (!created) {
    let pid = -1;
    try {
      pid = Number((JSON.parse(readFileSync(layout.lock, 'utf8')) as { pid?: unknown }).pid);
    } catch {
      // 깨진 잠금 파일은 죽은 하네스의 것으로 본다.
    }
    if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) {
      throw new Error(`다른 하네스가 이 runDir을 쓰고 있습니다(pid ${pid}): ${layout.root}`);
    }
    writeFileSync(layout.lock, body);
  }
  return {
    release() {
      rmSync(layout.lock, { force: true });
    },
  };
}

const SLACK_ENV_LINE = /^\s*(?:export\s+)?(SLACK_[A-Za-z0-9_]*)\s*=/;

/** 제품이 읽는 환경 변수를 runDir 기준으로 설정하고 run.json을 남긴다. */
export function applyProductEnv(config: DogfoodConfig, layout: RunLayout): void {
  mkdirSync(layout.root, { recursive: true });
  mkdirSync(layout.data, { recursive: true });
  mkdirSync(layout.agents, { recursive: true });
  const rule = config.mode === 'rule';
  process.env.ENSEMBLE_DATA_DIR = layout.data;
  process.env.ENSEMBLE_AGENT_WORKSPACE_ROOT = layout.agents;
  process.env.ENSEMBLE_PM_RUNTIME = rule ? 'fake' : config.pmRuntime;
  process.env.ENSEMBLE_AGENT_RUNTIME = rule ? 'fake' : config.agentRuntime;
  process.env.ENSEMBLE_SPACE_LIAISON = 'on';
  if (rule) process.env.ENSEMBLE_FAKE_AGENT_DELAY_MS = '50';
  if (process.env.ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES === undefined) process.env.ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES = '20';

  // 제품의 loadEnv()는 ENSEMBLE_ENV_FILE을 다시 읽으므로, 파일 안의 SLACK_* 줄까지 걸러서 복사한다.
  const strippedSlackKeys: string[] = [];
  let envBody = '';
  if (config.envFile !== undefined && existsSync(config.envFile)) {
    const kept: string[] = [];
    for (const line of readFileSync(config.envFile, 'utf8').split(/\r?\n/)) {
      const m = SLACK_ENV_LINE.exec(line);
      if (m) strippedSlackKeys.push(m[1] as string);
      else kept.push(line);
    }
    envBody = kept.join('\n');
  }
  writeFileSync(layout.envFile, envBody);
  process.env.ENSEMBLE_ENV_FILE = layout.envFile;

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SLACK_')) {
      strippedSlackKeys.push(key);
      delete process.env[key];
    }
  }
  writeFileSync(
    layout.runJson,
    JSON.stringify({ config, startedAt: new Date().toISOString(), strippedSlackKeys: [...new Set(strippedSlackKeys)] }, null, 2) + '\n',
  );
}
