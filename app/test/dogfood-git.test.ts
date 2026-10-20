import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs, repoRoot, runLayout } from '../dogfood/config.ts';
import { bootstrapTarget, cleanTestEnv, ensureWorktree, git, gitAvailable, head, mergeBranchIntoMain, productState, runTests } from '../dogfood/git.ts';
import { DogfoodLedger } from '../dogfood/ledger.ts';

const hasGit = await gitAvailable();

test('cleanTestEnv는 중첩 테스트를 막는 변수를 지운다', () => {
  const env = cleanTestEnv({ NODE_TEST_CONTEXT: 'x', NODE_OPTIONS: '--a', npm_config_x: '1', TSX_TSCONFIG_PATH: 'p', PATH: 'keep' });
  assert.deepEqual(env, { PATH: 'keep' });
});

test('시드 bootstrap, runTests 양성·음성, worktree, 충돌 머지, continueFrom', { skip: !hasGit, timeout: 60_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'dogfood-git-'));
  const ledgers: DogfoodLedger[] = [];
  try {
    const dirA = join(base, 'a');
    const layoutA = runLayout(dirA);
    const { config: configA } = parseArgs(['run', '--target', 'seed', '--run-dir', dirA]);
    mkdirSync(dirA, { recursive: true });
    const ledgerA = new DogfoodLedger(join(base, 'a.db'), configA.runId);
    ledgers.push(ledgerA);
    await bootstrapTarget(configA, layoutA, ledgerA);
    const main = layoutA.targetMain;

    const events = await ledgerA.read();
    assert.ok(events.some((e) => e.type === 'dogfood_setup_step'));

    // 양성: 시드 테스트 통과
    const ok = await runTests(main, 'npm test', 45_000);
    assert.equal(ok.passed, true, ok.tail);

    // 음성: 실패하는 테스트는 app의 npm test 안에서 돌아도 passed=false
    writeFileSync(join(main, 'test', 'fail.test.js'), "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('실패', () => assert.equal(1, 2));\n");
    await git(main, ['add', '-A']);
    await git(main, ['commit', '-m', 'fail']);
    const bad = await runTests(main, 'npm test', 45_000);
    assert.equal(bad.passed, false, bad.tail);
    await git(main, ['reset', '--hard', 'HEAD~1']);

    // worktree: .ensemble/x는 status에 나오지 않는다
    const wt = layoutA.teammate('a');
    await ensureWorktree(main, wt, 'dogfood/teammate-a');
    mkdirSync(join(wt, '.ensemble'), { recursive: true });
    writeFileSync(join(wt, '.ensemble', 'x'), 'x');
    assert.equal((await git(wt, ['status', '--porcelain'])).stdout.trim(), '');

    // 충돌 머지는 ok:false, abort 뒤 main이 깨끗하다
    const wtB = layoutA.teammate('b');
    await ensureWorktree(main, wtB, 'dogfood/teammate-b');
    for (const [dir, text] of [
      [wt, 'A'],
      [wtB, 'B'],
    ] as const) {
      writeFileSync(join(dir, 'README.md'), `${text}\n`);
      await git(dir, ['commit', '-am', text]);
    }
    assert.equal((await mergeBranchIntoMain(main, 'dogfood/teammate-a', 'a')).ok, true);
    const conflict = await mergeBranchIntoMain(main, 'dogfood/teammate-b', 'b');
    assert.equal(conflict.ok, false);
    assert.deepEqual(conflict.conflicts, ['README.md']);
    assert.equal((await git(main, ['status', '--porcelain'])).stdout.trim(), '');

    // productState
    const state = await productState(repoRoot());
    assert.equal(state.commit.length, 40);

    // continueFrom: 첫 runDir의 main에서 clone한다
    writeFileSync(join(main, 'NOTE.md'), 'n\n');
    await git(main, ['add', '-A']);
    await git(main, ['commit', '-m', 'note']);
    const expected = await head(main);
    const dirB = join(base, 'b');
    const layoutB = runLayout(dirB);
    const { config: configB } = parseArgs(['run', '--continue-from', dirA, '--run-dir', dirB]);
    const ledgerB = new DogfoodLedger(join(base, 'b.db'), configB.runId);
    ledgers.push(ledgerB);
    await bootstrapTarget(configB, layoutB, ledgerB);
    assert.equal(await head(layoutB.targetMain), expected);
    assert.ok(existsSync(join(layoutB.targetMain, 'NOTE.md')));

    // 이미 있는 targetMain이면 throw
    await assert.rejects(() => bootstrapTarget(configB, layoutB, ledgerB), /재개 미지원/);
  } finally {
    for (const l of ledgers) l.close();
    rmSync(base, { recursive: true, force: true, maxRetries: 3 });
  }
});
