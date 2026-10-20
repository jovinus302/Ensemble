import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { acquireLock, assertFreshRunDir, assertOutsideRepo, isInside, parseArgs, repoRoot, runLayout, applyProductEnv } from '../dogfood/config.ts';
import { DogfoodLedger, weightedTokens } from '../dogfood/ledger.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dogfood-foundation-'));
}

test('parseArgs 기본값', () => {
  const { command, config, compareRunDir } = parseArgs(['run', '--target', 'seed']);
  assert.equal(command, 'run');
  assert.equal(compareRunDir, undefined);
  assert.equal(config.target, 'seed');
  assert.equal(config.iteration, 1);
  assert.equal(config.mode, 'live');
  assert.equal(config.maxCycles, 120);
  assert.equal(config.cycleMinutes, 20);
  assert.equal(config.maxHours, 48);
  assert.equal(config.budgetTokens, 20_000_000);
  assert.equal(config.teammates, 2);
  assert.equal(config.probeEvery, 3);
  assert.equal(config.port, 0);
  assert.equal(config.pmRuntime, 'claude');
  assert.equal(config.agentRuntime, 'claude');
  assert.equal(config.nextStepAssignee, 'pm');
  assert.equal(config.settleSeconds, 300);
  assert.equal(config.humanResultWaitSeconds, 300);
  assert.equal(config.argvLimit, 30000);
  assert.equal(config.skipLive, false);
  assert.match(config.runDir, /ensemble-dogfood/);
  assert.match(basename(config.runDir), /^\d{8}-\d{4}-iter1$/);
  assert.equal(config.runId, basename(config.runDir));
  assert.ok(config.runDir.startsWith(join(homedir(), 'ensemble-dogfood')));
});

test('parseArgs rule 모드 기본 대기 시간', () => {
  const { config } = parseArgs(['run', '--continue-from', '/x', '--mode', 'rule', '--iteration', '2']);
  assert.equal(config.settleSeconds, 10);
  assert.equal(config.humanResultWaitSeconds, 15);
  assert.equal(config.continueFrom, '/x');
  assert.equal(config.iteration, 2);
});

test('smoke 덮어쓰기와 명시 플래그 우선', () => {
  const smoke = parseArgs(['smoke']);
  try {
    assert.equal(smoke.command, 'smoke');
    assert.equal(smoke.config.mode, 'rule');
    assert.equal(smoke.config.target, 'seed');
    assert.equal(smoke.config.maxCycles, 20);
    assert.equal(smoke.config.cycleMinutes, 0);
    assert.equal(smoke.config.probeEvery, 2);
    assert.equal(smoke.config.settleSeconds, 10);
    assert.equal(smoke.config.humanResultWaitSeconds, 15);
    assert.ok(smoke.config.runDir.startsWith(join(tmpdir(), 'ensemble-dogfood-smoke-')));
    assert.equal(smoke.config.runId, basename(smoke.config.runDir));
  } finally {
    rmSync(smoke.config.runDir, { recursive: true, force: true });
  }
  const dir = join(tmp(), 'r');
  const explicit = parseArgs(['smoke', '--max-cycles', '3', '--probe-every', '5', '--run-dir', dir, '--target', '/repo']);
  assert.equal(explicit.config.maxCycles, 3);
  assert.equal(explicit.config.probeEvery, 5);
  assert.equal(explicit.config.target, '/repo');
  assert.equal(explicit.config.runDir, dir);
});

test('parseArgs 거부: teammates 0, codex PM, 대상 없음, report run-dir 없음', () => {
  assert.throws(() => parseArgs(['run', '--target', 'seed', '--teammates', '0']), /팀원은 1명 이상이어야 합니다/);
  assert.throws(() => parseArgs(['run', '--target', 'seed', '--teammates', '3']), /팀원은 1명 이상이어야 합니다/);
  assert.throws(() => parseArgs(['run', '--target', 'seed', '--pm-runtime', 'codex']), /codex PM을 지원하지 않습니다/);
  assert.throws(() => parseArgs(['run']), /--target 또는 --continue-from/);
  assert.throws(() => parseArgs(['report']), /--run-dir/);
  assert.throws(() => parseArgs(['run', '--target', 'seed', '--nope']));
  assert.throws(() => parseArgs(['bogus']), /명령/);
  const ok = parseArgs(['report', '--run-dir', '/a/b', '--compare', '/a/c']);
  assert.equal(ok.config.runDir.endsWith('b'), true);
  assert.equal(ok.compareRunDir?.endsWith('c'), true);
  assert.equal(parseArgs(['preflight', '--skip-live']).config.skipLive, true);
});

test('runLayout', () => {
  const l = runLayout(join('/r', 'x'));
  assert.equal(l.root, join('/r', 'x'));
  assert.equal(l.data, join('/r', 'x', 'data'));
  assert.equal(l.agents, join('/r', 'x', 'agents'));
  assert.equal(l.targetMain, join('/r', 'x', 'target', 'main'));
  assert.equal(l.teammate('a'), join('/r', 'x', 'target', 'teammate-a'));
  assert.equal(l.secrets, join('/r', 'x', 'secrets'));
  assert.equal(l.ledger, join('/r', 'x', 'dogfood.db'));
  assert.equal(l.logs, join('/r', 'x', 'logs'));
  assert.equal(l.probeCwd, join('/r', 'x', 'probe-cwd'));
  assert.equal(l.report, join('/r', 'x', 'report.md'));
  assert.equal(l.metrics, join('/r', 'x', 'metrics.json'));
  assert.equal(l.runJson, join('/r', 'x', 'run.json'));
  assert.equal(l.envFile, join('/r', 'x', '.env.dogfood'));
  assert.equal(l.lock, join('/r', 'x', '.lock'));
});

test('isInside와 assertOutsideRepo', () => {
  const root = repoRoot();
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(join(root, 'app', 'x'), root), true);
  assert.equal(isInside(join(root, '..', 'other'), root), false);
  assert.throws(() => assertOutsideRepo(join(root, 'app', 'run')), /저장소 밖/);
  assert.doesNotThrow(() => assertOutsideRepo(join(tmpdir(), 'dogfood-outside')));
  if (process.platform === 'win32') {
    assert.equal(isInside('C:\\Repo\\Sub', 'c:\\repo'), true);
    assert.equal(isInside('D:\\Repo\\Sub', 'C:\\Repo'), false);
  }
});

test('assertFreshRunDir', () => {
  const dir = tmp();
  assert.doesNotThrow(() => assertFreshRunDir(dir));
  assert.doesNotThrow(() => assertFreshRunDir(join(dir, 'none')));
  writeFileSync(join(dir, 'f'), '1');
  assert.throws(() => assertFreshRunDir(dir), /재개는 지원하지 않습니다/);
});

test('acquireLock: 두 번째는 실패, 죽은 pid는 덮어씀, release', async () => {
  const layout = runLayout(join(tmp(), 'run'));
  const lock = acquireLock(layout);
  assert.equal(JSON.parse(readFileSync(layout.lock, 'utf8')).pid, process.pid);
  assert.throws(() => acquireLock(layout), /다른 하네스가 이 runDir을 쓰고 있습니다/);
  lock.release();
  assert.equal(existsSync(layout.lock), false);

  const child = spawn(process.execPath, ['-e', '0']);
  const deadPid = child.pid!;
  await new Promise(resolve => child.on('exit', resolve));
  writeFileSync(layout.lock, JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }));
  const again = acquireLock(layout);
  assert.equal(JSON.parse(readFileSync(layout.lock, 'utf8')).pid, process.pid);
  again.release();
});

test('applyProductEnv', () => {
  const keys = ['ENSEMBLE_DATA_DIR', 'ENSEMBLE_AGENT_WORKSPACE_ROOT', 'ENSEMBLE_PM_RUNTIME', 'ENSEMBLE_AGENT_RUNTIME', 'ENSEMBLE_SPACE_LIAISON', 'ENSEMBLE_FAKE_AGENT_DELAY_MS', 'ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES', 'ENSEMBLE_ENV_FILE', 'SLACK_BOT_TOKEN'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    delete process.env.ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES;
    process.env.SLACK_BOT_TOKEN = 'x';
    const dir = join(tmp(), 'run');
    const { config } = parseArgs(['run', '--target', 'seed', '--mode', 'rule', '--run-dir', dir]);
    const layout = runLayout(dir);
    applyProductEnv(config, layout);
    assert.equal(process.env.ENSEMBLE_DATA_DIR, layout.data);
    assert.equal(process.env.ENSEMBLE_AGENT_WORKSPACE_ROOT, layout.agents);
    assert.equal(process.env.ENSEMBLE_PM_RUNTIME, 'fake');
    assert.equal(process.env.ENSEMBLE_AGENT_RUNTIME, 'fake');
    assert.equal(process.env.ENSEMBLE_SPACE_LIAISON, 'on');
    assert.equal(process.env.ENSEMBLE_FAKE_AGENT_DELAY_MS, '50');
    assert.equal(process.env.ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES, '20');
    assert.equal(process.env.ENSEMBLE_ENV_FILE, layout.envFile);
    assert.equal(process.env.SLACK_BOT_TOKEN, undefined);
    assert.equal(existsSync(layout.envFile), true);
    assert.equal(JSON.parse(readFileSync(layout.runJson, 'utf8')).config.runId, config.runId);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('applyProductEnv: --env-file의 SLACK_* 줄은 .env.dogfood에 복사되지 않는다', () => {
  const keys = ['ENSEMBLE_DATA_DIR', 'ENSEMBLE_AGENT_WORKSPACE_ROOT', 'ENSEMBLE_PM_RUNTIME', 'ENSEMBLE_AGENT_RUNTIME', 'ENSEMBLE_SPACE_LIAISON', 'ENSEMBLE_FAKE_AGENT_DELAY_MS', 'ENSEMBLE_AGENT_TURN_TIMEOUT_MINUTES', 'ENSEMBLE_ENV_FILE', 'SLACK_BOT_TOKEN'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    const base = tmp();
    const src = join(base, 'src.env');
    writeFileSync(src, ['ANTHROPIC_API_KEY=k', 'SLACK_BOT_TOKEN=xoxb-1', 'export SLACK_SIGNING_SECRET = s', '  SLACK_CHANNEL_ID=C1', 'NOT_SLACK=1', ''].join('\n'));
    const dir = join(base, 'run');
    const { config } = parseArgs(['run', '--target', 'seed', '--mode', 'rule', '--run-dir', dir, '--env-file', src]);
    const layout = runLayout(dir);
    applyProductEnv(config, layout);
    const copied = readFileSync(layout.envFile, 'utf8');
    assert.equal(/SLACK_/.test(copied), false);
    assert.match(copied, /ANTHROPIC_API_KEY=k/);
    assert.match(copied, /NOT_SLACK=1/);
    const run = JSON.parse(readFileSync(layout.runJson, 'utf8')) as { strippedSlackKeys: string[] };
    assert.deepEqual([...run.strippedSlackKeys].sort(), ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'SLACK_SIGNING_SECRET']);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('DogfoodLedger 멱등성', async () => {
  const dir = tmp();
  mkdirSync(dir, { recursive: true });
  const ledger = new DogfoodLedger(join(dir, 'dogfood.db'), 'run-1');
  try {
    const a = await ledger.record('dogfood_cycle_started', { cycle: 1 }, { key: 'cycle:1' });
    const b = await ledger.record('dogfood_cycle_started', { cycle: 1 }, { key: 'cycle:1' });
    assert.equal(a.seq, b.seq);
    await ledger.record('dogfood_cycle_started', { cycle: 2 }, { key: 'cycle:2', actor: 'tester' });
    await ledger.record('dogfood_cycle_started', { cycle: 3 });
    const events = await ledger.read();
    assert.equal(events.length, 3);
    assert.equal(events[0]!.projectId, 'run-1');
    assert.equal(events[0]!.targetProductId, 'dogfood');
    assert.deepEqual(events[0]!.actor, { kind: 'system', id: 'dogfood-harness' });
    assert.equal(events[1]!.actor.id, 'tester');
  } finally {
    ledger.close();
  }
});

test('weightedTokens', () => {
  const u = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 400, cacheCreationTokens: 200 };
  assert.equal(weightedTokens(u, 'pm'), 1100);
  assert.equal(weightedTokens(u, 'ensemble-agent'), 400 + 100 + 40 + 250);
  assert.equal(weightedTokens({ inputTokens: 10, outputTokens: 5, cacheReadTokens: null, cacheCreationTokens: null }, 'harness'), 15);
});
