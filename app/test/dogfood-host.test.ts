import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs, runLayout } from '../dogfood/config.ts';
import type { ClaudeRunResult } from '../dogfood/claude.ts';
import { httpJson, startHost } from '../dogfood/host.ts';
import { DogfoodLedger } from '../dogfood/ledger.ts';
import { lastSeq, pauseUntil, progressSignature, recordHarnessUsage, settle, type RoleContext } from '../dogfood/role-context.ts';

const globalRuntime = globalThis as typeof globalThis & { ensembleRuntime?: unknown };

/** Host 헤더를 마음대로 정해 GET을 보낸다(httpJson은 Host를 바꾸지 않는다). */
function getWithHost(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

test('호스트: state 200, Host 위조 403, 연결 뒤 Space 게시 202, 원장 기록, close 뒤 global 없음', { timeout: 60_000 }, async () => {
  const envBefore = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-host-'));
  const folder = join(dir, 'teammate-folder');
  mkdirSync(folder);
  const { config } = parseArgs(['smoke', '--run-dir', join(dir, 'run')]);
  const layout = runLayout(config.runDir);
  mkdirSync(layout.root, { recursive: true });
  const ledger = new DogfoodLedger(layout.ledger, config.runId);
  const host = await startHost(config, layout, ledger);
  try {
    assert.equal(config.mode, 'rule');
    assert.ok(host.port > 0);
    assert.equal(host.baseUrl, `http://127.0.0.1:${host.port}`);
    assert.deepEqual(host.adapters, { pathPrepend: false, pmSchemaRef: false });
    assert.equal(host.argvOverflow(), undefined);
    assert.equal(globalRuntime.ensembleRuntime, host.runtime);

    const state = await httpJson(`${host.baseUrl}/api/state`);
    assert.equal(state.status, 200);
    assert.equal((state.json as { project: { id: string } }).project.id, host.projectId());

    // 위조한 Host 헤더, /api/ 밖의 경로, 허용하지 않는 메서드.
    assert.equal(await getWithHost(host.port, '/api/state', 'evil.example'), 403);
    assert.equal(await getWithHost(host.port, '/api/state', `127.0.0.1:${host.port + 1}`), 403);
    assert.equal((await httpJson(`${host.baseUrl}/other`)).status, 404);
    assert.equal((await httpJson(`${host.baseUrl}/api/nope`)).status, 404);

    // 연결: 요청(202) -> 코드 수집 -> 확인(201, 토큰) -> 게시(202).
    const link = await httpJson(`${host.baseUrl}/api/space/participants`, {
      body: { me: 'owner', participantId: 'teammate-a', displayName: '팀원 A', tool: 'claude', workspaceRoot: folder },
    });
    assert.equal(link.status, 202);
    const code = host.takeLinkCode('teammate-a');
    assert.match(code ?? '', /\S+/);
    assert.equal(host.takeLinkCode('teammate-a'), undefined, '코드는 한 번만 꺼낼 수 있다');
    const linkRequestId = (link.json as { linkRequestId: string }).linkRequestId;
    const confirmed = await httpJson(`${host.baseUrl}/api/space/links/${linkRequestId}/confirm`, { body: { me: 'owner', code } });
    assert.equal(confirmed.status, 201);
    const token = (confirmed.json as { token: string }).token;
    const posted = await httpJson(`${host.baseUrl}/api/space/participants/teammate-a/posts`, {
      token, body: { kind: 'note', text: '호스트 테스트 게시', clientPostId: 'host-test-1' },
    });
    assert.equal(posted.status, 202);
    const unauthorized = await httpJson(`${host.baseUrl}/api/space/participants/teammate-a/posts`, {
      token: 'wrong', body: { kind: 'note', text: '거절돼야 함', clientPostId: 'host-test-2' },
    });
    assert.notEqual(unauthorized.status, 202);

    const settled = await settle(host, 20_000);
    assert.equal(settled.settled, true);
    const events = await host.events();
    assert.ok(events.some((e) => e.type === 'space_post_recorded'), 'space_post_recorded가 제품 원장에 남는다');
    assert.equal(lastSeq(events), settled.lastSeq);
    assert.match(progressSignature(events, await ledger.read()), /^plan=\d+\|tasks=.*\|checked=0\|decisions=\d+\|pending=\d+\|posts=1\|verified=0$/);
  } finally {
    await host.close();
    ledger.close();
  }
  assert.equal(globalRuntime.ensembleRuntime, undefined, 'close 뒤에는 global이 없다');
  await host.close(); // 두 번 불러도 안전하다
  for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
  Object.assign(process.env, envBefore);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

test('recordHarnessUsage: 사용량을 남기고, 인프라 실패이면 대기 구간을 기록한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-usage-'));
  const { config } = parseArgs(['smoke', '--run-dir', join(dir, 'run')]);
  const layout = runLayout(config.runDir);
  mkdirSync(layout.root, { recursive: true });
  const ledger = new DogfoodLedger(layout.ledger, config.runId);
  try {
    const ctx = { ledger, cycle: 3 } as unknown as RoleContext;
    const base: ClaudeRunResult = {
      ok: true, text: '', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheCreationTokens: 10 },
      model: 'm', costUsd: 0.01, sessionId: 's', durationMs: 5, exitCode: 0, timedOut: false, aborted: false, failureKind: null, stderrTail: '',
    };
    assert.equal(await recordHarnessUsage(ctx, 'decision-proxy', base), undefined);
    const failed: ClaudeRunResult = { ...base, ok: false, error: 'Claude AI usage limit reached|resets 5pm', failureKind: 'infra' };
    const until = await recordHarnessUsage(ctx, 'teammate-a', failed);
    assert.ok(until);
    assert.equal(ctx.infraPausedUntil, until);
    const events = await ledger.read();
    assert.deepEqual(events.map((e) => e.type), ['dogfood_usage_recorded', 'dogfood_usage_recorded', 'dogfood_infra_pause']);
    const pause = events[2]!.payload as { from: string; until: string; source: string };
    assert.equal(pause.source, 'teammate-a');
    assert.ok(Date.parse(pause.until) > Date.parse(pause.from));
    const usage = events[0]!.payload as { source: string; role: string; cycle: number; cacheReadTokens: number };
    assert.deepEqual([usage.source, usage.role, usage.cycle, usage.cacheReadTokens], ['harness', 'decision-proxy', 3, 60]);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('pauseUntil: resets <시각>을 KST로 해석하고, 지난 시각이면 다음 날, 없으면 60분', () => {
  // 2026-10-19T00:00Z = KST 09:00
  const now = new Date('2026-10-19T00:00:00.000Z');
  assert.equal(pauseUntil('usage limit | resets 5pm', now).toISOString(), '2026-10-19T08:00:00.000Z');
  assert.equal(pauseUntil('resets at 5:30 PM', now).toISOString(), '2026-10-19T08:30:00.000Z');
  assert.equal(pauseUntil('resets 8am', now).toISOString(), '2026-10-19T23:00:00.000Z');
  assert.equal(pauseUntil('OAuth token has expired', now).toISOString(), '2026-10-19T01:00:00.000Z');
});
