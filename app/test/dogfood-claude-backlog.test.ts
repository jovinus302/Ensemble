import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { LedgerEvent } from '@ensemble/core';
import {
  BASH, buildClaudeArgs, childPids, classifyCliFailure, ensureClaudeOnPath, parseClaudeOutput, resolveClaudeExecutable, runClaude,
} from '../dogfood/claude.ts';
import { backlogIdsIn, boardDone, parseBacklog, parseGoal, verifiedDone } from '../dogfood/backlog.ts';

const WIN = { platform: 'win32' as const, home: 'C:\\Users\\me' };

test('resolve: DOGFOOD_CLAUDE_EXE가 있고 파일이 있으면 env', () => {
  const r = resolveClaudeExecutable({ ...WIN, env: { DOGFOOD_CLAUDE_EXE: 'D:\\x\\claude.exe' }, exists: (p) => p === 'D:\\x\\claude.exe' });
  assert.deepEqual(r, { exe: 'D:\\x\\claude.exe', source: 'env' });
});

test('resolve: DOGFOOD_CLAUDE_EXE 파일이 없으면 PATH를 보지 않고 throw', () => {
  assert.throws(
    () => resolveClaudeExecutable({ ...WIN, env: { DOGFOOD_CLAUDE_EXE: 'D:\\no\\claude.exe', PATH: 'C:\\bin' }, exists: (p) => p === 'C:\\bin\\claude.exe' }),
    /DOGFOOD_CLAUDE_EXE 경로에 파일이 없습니다: D:\\no\\claude\.exe/,
  );
});

test('resolve: DOGFOOD_FORBID_CLAUDE=1이면 다른 설정이 있어도 throw', () => {
  assert.throws(() => resolveClaudeExecutable({ ...WIN, env: { DOGFOOD_FORBID_CLAUDE: '1', DOGFOOD_CLAUDE_EXE: 'a' }, exists: () => true }), /DOGFOOD_FORBID_CLAUDE/);
});

test('resolve: win32가 아니면 posix', () => {
  assert.deepEqual(resolveClaudeExecutable({ env: {}, platform: 'linux', exists: () => false }), { exe: 'claude', source: 'posix' });
});

test('resolve: PATH의 claude.exe, npm shim 옆 claude.exe, ~/.local/bin 순서', () => {
  const pathExe = resolveClaudeExecutable({ ...WIN, env: { Path: 'C:\\a;C:\\b' }, exists: (p) => p === 'C:\\b\\claude.exe' });
  assert.deepEqual(pathExe, { exe: 'C:\\b\\claude.exe', source: 'path-exe' });

  const shimExe = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
  const shim = resolveClaudeExecutable({ ...WIN, env: { PATH: 'C:\\a;C:\\npm' }, exists: (p) => p === 'C:\\npm\\claude.cmd' || p === shimExe });
  assert.deepEqual(shim, { exe: shimExe, source: 'npm-shim' });

  const local = resolveClaudeExecutable({ ...WIN, env: { PATH: 'C:\\a' }, exists: (p) => p === 'C:\\Users\\me\\.local\\bin\\claude.exe' });
  assert.equal(local.source, 'local-bin');
});

test('resolve: 아무것도 없으면 한국어 오류', () => {
  assert.throws(() => resolveClaudeExecutable({ ...WIN, env: { PATH: 'C:\\a' }, exists: () => false }), /claude\.exe를 찾지 못했습니다/);
});

test('ensureClaudeOnPath는 win32에서 없을 때만 앞에 붙이고 멱등이다', () => {
  const env: NodeJS.ProcessEnv = { Path: 'C:\\a;C:\\b' };
  assert.equal(ensureClaudeOnPath('C:\\tools\\claude.exe', env, 'win32'), true);
  assert.equal(env.Path, 'C:\\tools;C:\\a;C:\\b');
  assert.equal(ensureClaudeOnPath('C:\\tools\\claude.exe', env, 'win32'), false);
  assert.equal(ensureClaudeOnPath('c:\\TOOLS\\claude.exe', env, 'win32'), false);
  assert.equal(env.Path, 'C:\\tools;C:\\a;C:\\b');
  const posix: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
  assert.equal(ensureClaudeOnPath('/opt/claude', posix, 'linux'), false);
  assert.equal(posix.PATH, '/usr/bin');
});

test('parseClaudeOutput: modelUsage 합산과 캐시 포함 입력, structured_output', () => {
  const out = JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: '완료', session_id: 's1', total_cost_usd: 0.5, duration_ms: 1200,
    structured_output: { a: 1 },
    modelUsage: {
      'claude-x': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 20, costUSD: 0.3 },
      'claude-y': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 0.2 },
    },
  });
  const p = parseClaudeOutput(out);
  assert.equal(p.ok, true);
  assert.deepEqual(p.usage, { inputTokens: 11 + 103 + 24, outputTokens: 7, cacheReadTokens: 103, cacheCreationTokens: 24 });
  assert.deepEqual(p.structured, { a: 1 });
  assert.equal(p.costUsd, 0.5);
  assert.equal(p.model, 'claude-x');
  assert.equal(p.sessionId, 's1');
});

test('parseClaudeOutput: 펜스 JSON, usage 폴백, 이벤트 배열', () => {
  const fenced = parseClaudeOutput(JSON.stringify([
    { type: 'system' },
    { type: 'result', subtype: 'success', result: '```json\n{"ok":true}\n```', usage: { input_tokens: 4, output_tokens: 1, cache_read_input_tokens: 6 } },
  ]));
  assert.deepEqual(fenced.structured, { ok: true });
  assert.equal(fenced.usage.inputTokens, 10);
  assert.equal(fenced.usage.cacheReadTokens, 6);
  const plain = parseClaudeOutput(JSON.stringify({ type: 'result', subtype: 'success', result: '그냥 글' }));
  assert.equal(plain.structured, undefined);
});

test('parseClaudeOutput: is_error와 결과 없음', () => {
  const err = parseClaudeOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1700000000' }));
  assert.equal(err.ok, false);
  assert.match(err.error ?? '', /usage limit/);
  const sub = parseClaudeOutput(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd' }));
  assert.equal(sub.ok, false);
  for (const s of ['', '   ', 'not json', JSON.stringify({ type: 'system' })]) {
    const none = parseClaudeOutput(s);
    assert.equal(none.ok, false);
    assert.equal(none.error, '결과 없음');
  }
});

test('classifyCliFailure 표', () => {
  const table: [string, 'infra' | 'other'][] = [
    ['Claude AI usage limit reached|resets 5pm', 'infra'],
    ['OAuth token has expired', 'infra'],
    ['HTTP 429 Too Many Requests', 'infra'],
    ['Not logged in · Please run /login', 'infra'],
    ['Credit balance is too low', 'infra'],
    ['API Error: Overloaded', 'infra'],
    ['invalid_input', 'other'],
    ['제한 시간을 넘겨 중단했습니다', 'other'],
    ['', 'other'],
  ];
  for (const [text, kind] of table) assert.equal(classifyCliFailure(text), kind, text);
});

test('buildClaudeArgs: 도구 없음/허용 목록, 금지 도구, 상한', () => {
  const base = { role: 'r', prompt: 'p', cwd: '.', timeoutMs: 1000 };
  const none = buildClaudeArgs({ ...base, tools: 'none' });
  assert.deepEqual(none.slice(0, 7), ['-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '']);
  assert.deepEqual(none.slice(7), ['--tools', '']);
  const some = buildClaudeArgs({
    ...base, tools: { allowed: ['Read', BASH('git')], disallowed: ['Bash(rm *)'] }, budgetUsd: 3, model: 'm', effort: 'low',
    systemPrompt: 'S', appendSystemPrompt: 'A', jsonSchema: { type: 'object' },
  });
  assert.equal(BASH('git'), 'Bash(git *)');
  assert.deepEqual(some.slice(7), [
    '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Bash(git *)',
    '--disallowedTools', 'Bash(rm *),Agent,Task,WebFetch,WebSearch',
    '--max-budget-usd', '3', '--model', 'm', '--effort', 'low',
    '--system-prompt', 'S', '--append-system-prompt', 'A', '--json-schema', '{"type":"object"}',
  ]);
  assert.ok(!some.includes('--max-turns') && !some.includes('--bare'));
  assert.throws(() => buildClaudeArgs({ ...base, tools: 'none', systemPrompt: 'x'.repeat(6001) }), /6000자/);
  assert.throws(() => buildClaudeArgs({ ...base, tools: 'none', jsonSchema: { d: 'x'.repeat(6001) } }), /6000자/);
});

test('runClaude: DOGFOOD_FORBID_CLAUDE=1이면 throw', async () => {
  await assert.rejects(
    runClaude({ role: 'r', prompt: 'p', cwd: tmpdir(), tools: 'none', timeoutMs: 1000, env: { DOGFOOD_FORBID_CLAUDE: '1' } }),
    /DOGFOOD_FORBID_CLAUDE/,
  );
});

test('runClaude: 실행 파일이 실패해도 reject하지 않고 로그에서 값을 가린다', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-claude-'));
  try {
    const logFile = join(dir, 'logs', 'c1-test.json');
    // node에 claude 인자를 넘기면 즉시 실패한다. 실제 claude 호출은 없다.
    const r = await runClaude({
      role: 'test', prompt: '비밀 프롬프트', cwd: dir, tools: 'none', timeoutMs: 15_000, systemPrompt: '비밀 시스템',
      env: { DOGFOOD_CLAUDE_EXE: process.execPath }, logFile, redact: [process.execPath],
    });
    assert.equal(r.ok, false);
    assert.equal(r.failureKind, 'other');
    assert.equal(r.timedOut, false);
    assert.equal(r.aborted, false);
    assert.notEqual(r.exitCode, 0);
    assert.equal(childPids.size, 0);
    const log = readFileSync(logFile, 'utf8');
    assert.ok(!log.includes('비밀 프롬프트') && !log.includes('비밀 시스템'));
    assert.ok(log.includes('<생략>') && log.includes('***'));
    assert.ok(!log.includes(JSON.stringify(process.execPath).slice(1, -1)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runClaude: 미리 abort된 신호는 aborted로 끝난다', { timeout: 20_000 }, async () => {
  const ac = new AbortController();
  ac.abort();
  const r = await runClaude({
    role: 'test', prompt: 'p', cwd: tmpdir(), tools: 'none', timeoutMs: 15_000, signal: ac.signal,
    env: { DOGFOOD_CLAUDE_EXE: process.execPath },
  });
  assert.equal(r.ok, false);
  assert.equal(r.aborted, true);
  assert.equal(childPids.size, 0);
});

const BACKLOG = [
  '# 백로그',
  '## E1 회의록 파싱 [iter:1]',
  '- [ ] B-01 결정 줄 파싱 — "결정:"으로 시작하는 줄을 반환 (area: be)',
  '- [x] B-02 액션아이템 파싱 (area: be)',
  '## E2 검색과 출력 [iter:1]',
  '- [ ] B-03 키워드 검색 함수 (area: be) [solo:teammate-b]',
  '- [ ] B-04 결과 HTML 목록 (area: fe)',
  '## E3 필터와 CLI [iter:2]',
  '- [ ] B-05 담당자별 필터 (area: be) [solo:teammate-b]',
  '- [ ] B-06 CLI 진입점',
  '## E4 기본값',
  '- [ ] B-07 태그 없는 에픽',
].join('\n');

test('parseBacklog: solo, area, iter 기본값', () => {
  const items = parseBacklog(BACKLOG);
  assert.deepEqual(items.map((i) => i.id), ['B-01', 'B-02', 'B-03', 'B-04', 'B-05', 'B-06', 'B-07']);
  assert.deepEqual(items.filter((i) => i.solo).map((i) => [i.id, i.solo]), [['B-03', 'teammate-b'], ['B-05', 'teammate-b']]);
  assert.deepEqual(items.map((i) => i.iteration), [1, 1, 1, 1, 2, 2, 1]);
  assert.equal(items[0]!.area, 'be');
  assert.equal(items[0]!.title, '결정 줄 파싱 — "결정:"으로 시작하는 줄을 반환');
  assert.equal(items[3]!.area, 'fe');
  assert.equal(items[5]!.area, undefined);
  assert.equal(items[2]!.title, '키워드 검색 함수');
  assert.equal(items[2]!.epicId, 'E2');
  assert.equal(items[2]!.epicTitle, '검색과 출력');
  assert.deepEqual(items.map((i) => i.checked), [false, true, false, false, false, false, false]);
});

test('parseBacklog: CRLF도 같다', () => {
  assert.deepEqual(parseBacklog(BACKLOG.replace(/\n/g, '\r\n')), parseBacklog(BACKLOG));
});

test('backlogIdsIn은 중복 없이 B-id만 모은다', () => {
  assert.deepEqual(backlogIdsIn('B-03 구현 (B-04 포함) B-03 다시, AB-9 제외 x'), ['B-03', 'B-04']);
  assert.deepEqual(backlogIdsIn('없음'), []);
});

const GOAL = [
  '# 목표',
  '## Iter 1',
  '회의록에서 결정을 뽑는다.',
  '이번 반복은 E1과 E2다.',
  '',
  '테스트: npm test',
  '## Iter 2',
  '담당자 필터를 더한다.',
  '',
  '테스트: npm run check',
].join('\r\n');

test('parseGoal', () => {
  assert.deepEqual(parseGoal(GOAL, 1), { goal: '회의록에서 결정을 뽑는다.\n이번 반복은 E1과 E2다.', testCommand: 'npm test' });
  assert.deepEqual(parseGoal(GOAL, 2), { goal: '담당자 필터를 더한다.', testCommand: 'npm run check' });
  assert.equal(parseGoal('## Iter 1\n목표만\n', 1).testCommand, 'npm test');
  assert.throws(() => parseGoal(GOAL, 3), /Iter 3/);
  assert.equal(parseGoal(GOAL, 1).deadline, undefined, '기한 줄이 없으면 deadline도 없다');
});

test('parseGoal: 기한 줄은 deadline으로 읽고 목표 본문에서 뺀다', () => {
  const colon = parseGoal('## Iter 1\n회의록에서 결정을 뽑는다.\n기한: 2026-11-30\n테스트: npm test\n', 1);
  assert.deepEqual(colon, { goal: '회의록에서 결정을 뽑는다.', testCommand: 'npm test', deadline: '2026-11-30' });
  const sentence = parseGoal('## Iter 1\n기한은 2026-12-15까지다.\n목표 문단이다.\n', 1);
  assert.equal(sentence.deadline, '2026-12-15');
  assert.equal(sentence.goal, '목표 문단이다.');
  // 형식이 다르면 deadline으로 읽지 않고 본문에 둔다.
  const loose = parseGoal('## Iter 1\n기한 없이 진행한다.\n', 1);
  assert.equal(loose.deadline, undefined);
  assert.equal(loose.goal, '기한 없이 진행한다.');
});

let seq = 0;
function ev(type: string, payload: unknown): LedgerEvent {
  seq += 1;
  return { id: `e${seq}`, seq, type, projectId: 'p', targetProductId: 'dogfood', actor: { kind: 'system', id: 't' }, at: '2026-10-19T00:00:00.000Z', payload };
}

test('boardDone은 취소되지 않은 checked 작업의 B-id, verifiedDone은 backlog_progress', () => {
  const spec = (id: string, title: string, cond: string[] = []) => ({ id, title, assignee: 'designer', dependsOn: [], handoffConditions: cond });
  const submit = (taskId: string) => ev('result_submitted', { taskId, resultId: `r-${taskId}`, planVersion: 1, summary: 's', artifactIds: [] });
  const check = (taskId: string) => ev('task_checked', { taskId, resultId: `r-${taskId}`, reason: 'ok' });
  const product = [
    ev('member_joined', { memberId: 'designer', kind: 'human', displayName: 'D' }),
    ev('goal_set', { text: 'g', decider: 'owner', delegation: { pmMayApply: [] } }),
    ev('plan_committed', {
      version: 1, basedOn: null, reason: 'r', approvedBy: 'owner', sourceMessageIds: [],
      tasks: [spec('t1', 'B-01 파싱'), spec('t2', '화면', ['B-04 목록이 보인다', 'B-02 포함']), spec('t3', 'B-03 검색'), spec('t4', 'B-05 필터')],
    }),
    submit('t1'), check('t1'),
    submit('t2'), check('t2'),
    submit('t3'),
    // t4는 이후 계획에서 빠져 취소된다
    submit('t4'), check('t4'),
    ev('plan_committed', {
      version: 2, basedOn: 1, reason: 'r2', approvedBy: 'owner', sourceMessageIds: [],
      tasks: [spec('t1', 'B-01 파싱'), spec('t2', '화면', ['B-04 목록이 보인다', 'B-02 포함']), spec('t3', 'B-03 검색')],
    }),
  ];
  assert.deepEqual([...boardDone(product)].sort(), ['B-01', 'B-02', 'B-04']);
  assert.deepEqual([...boardDone([])], []);

  const harness = [
    ev('dogfood_backlog_progress', { itemId: 'B-01', status: 'done', by: 'teammate-a', evidence: 'abc' }),
    ev('dogfood_backlog_progress', { itemId: 'B-03', status: 'done', by: 'teammate-b', evidence: 'def' }),
    ev('dogfood_backlog_progress', { itemId: 'B-03', status: 'done', by: 'teammate-b', evidence: 'def' }),
    ev('dogfood_cycle_started', { cycle: 1 }),
  ];
  assert.deepEqual([...verifiedDone(harness)].sort(), ['B-01', 'B-03']);
});
