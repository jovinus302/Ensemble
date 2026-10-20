// 도그푸딩 하네스 CLI: preflight | smoke | run | report. 사용법은 app/dogfood/README.md.
//   cd app && npm run dogfood -- <명령> [플래그]
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASH, claudeVersion, parseClaudeOutput, resolveClaudeExecutable, runClaude } from './claude.ts';
import { assertFreshRunDir, isInside, parseArgs, repoRoot, runLayout, type DogfoodConfig } from './config.ts';
import { git, productState } from './git.ts';
import { runIteration } from './loop.ts';
import type { DogfoodMetrics } from './metrics.ts';
import { compressSchema, estimateArgvChars } from './pm-adapter.ts';
import { loadMetrics, loadRunLedgers, writeReport } from './report.ts';

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------- preflight

type Level = 'ok' | 'fail' | 'info';

interface Row {
  level: Level;
  item: string;
  detail: string;
}

const MARK: Record<Level, string> = { ok: 'OK', fail: '실패', info: '안내' };

/** 한글·전각 문자는 터미널에서 두 칸을 차지한다. */
const cells = (text: string): number => [...text].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1), 0);
const pad = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - cells(text)));

function printTable(rows: readonly Row[]): void {
  const width = Math.max(...rows.map((r) => cells(r.item)));
  for (const r of rows) console.log(`[${pad(MARK[r.level], 4)}] ${pad(r.item, width)}  ${r.detail}`);
}

/** 합성 사람 메시지 60개·작업 30개 상태의 PM 해석 스키마와 시스템 프롬프트(argv 추정과 $ref 점검용). */
async function syntheticInterpretation() {
  const [{ project }, { MemoryLedgerStore }, { interpretationTool }, { PM_SYSTEM_PROMPT }] = await Promise.all([
    import('@ensemble/core'),
    import('@ensemble/store'),
    import('../packages/orchestrator/src/coordination.ts'),
    import('../packages/orchestrator/src/pm-prompt.ts'),
  ]);
  const store = new MemoryLedgerStore();
  try {
    const context = { projectId: 'preflight', targetProductId: 'product' };
    const owner = { kind: 'human' as const, id: 'owner' };
    await store.append([
      { ...context, actor: owner, type: 'member_joined', payload: { memberId: 'owner', kind: 'human', displayName: '사용자' } },
      { ...context, actor: owner, type: 'member_joined', payload: { memberId: 'research-agent', kind: 'agent', displayName: '조사 Agent' } },
      { ...context, actor: owner, type: 'goal_set', payload: { text: '회의록 검색 도구', decider: 'owner', delegation: { pmMayApply: [] } } },
      {
        ...context, actor: owner, type: 'plan_committed',
        payload: {
          version: 1, basedOn: null, reason: 'ok', approvedBy: 'owner', sourceMessageIds: [],
          tasks: Array.from({ length: 30 }, (_, i) => ({ id: `task-${randomUUID()}`, title: `작업 ${i}`, assignee: 'research-agent', dependsOn: [], handoffConditions: [`조건 ${i}`] })),
        },
      },
      ...Array.from({ length: 60 }, (_, i) => ({
        ...context, actor: owner, type: 'message_recorded' as const,
        payload: { messageId: `msg-${randomUUID()}`, authorId: 'owner', text: `메시지 ${i}`, attachmentIds: [] },
      })),
    ] as never);
    const tool = interpretationTool(project(await store.read({ projectId: context.projectId })));
    return { tool, system: PM_SYSTEM_PROMPT };
  } finally {
    store.close();
  }
}

/** claude에 큰 스키마를 직접 넘겨 본다. runClaude는 인자 하나를 6,000자로 제한하므로 PM 요청 크기의 스키마는 여기서 직접 호출한다. */
function schemaCall(schema: object, cwd: string): Promise<{ ok: boolean; structured: boolean; error?: string }> {
  return new Promise((resolvePromise) => {
    let exe: string;
    try {
      exe = resolveClaudeExecutable().exe;
    } catch (error) {
      resolvePromise({ ok: false, structured: false, error: errorText(error) });
      return;
    }
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '', '--tools', '', '--json-schema', JSON.stringify(schema)];
    let out = '';
    let err = '';
    let done = false;
    const finish = (value: { ok: boolean; structured: boolean; error?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolvePromise(value);
    };
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, structured: false, error: '180초 안에 끝나지 않았습니다' });
    }, 180_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => { out += c; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => { err = (err + c).slice(-1000); });
    child.once('error', (e) => finish({ ok: false, structured: false, error: e.message }));
    child.once('close', () => {
      const parsed = parseClaudeOutput(out);
      finish({ ok: parsed.ok, structured: parsed.structured !== undefined, ...(parsed.ok ? {} : { error: (parsed.error ?? err).slice(0, 300) }) });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end('스키마에 맞는 가장 짧은 JSON 하나를 출력하라. 값은 아무거나 괜찮다.');
  });
}

async function preflight(config: DogfoodConfig): Promise<number> {
  const rows: Row[] = [];
  const add = (level: Level, item: string, detail: string) => rows.push({ level, item, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 20 ? 'ok' : 'fail', 'Node', `${process.version}${major >= 20 ? '' : ' (20 이상이 필요합니다)'}`);

  try {
    add('ok', 'git', (await git(process.cwd(), ['--version'], { timeoutMs: 10_000 })).stdout.trim());
  } catch (error) {
    add('fail', 'git', errorText(error));
  }

  try {
    const claude = resolveClaudeExecutable();
    const version = claudeVersion(claude.exe);
    add(version === null ? 'fail' : 'ok', 'claude', `${claude.source} ${claude.exe}${version === null ? ' (버전을 읽지 못했습니다)' : ` ${version}`}`);
  } catch (error) {
    add('fail', 'claude', errorText(error));
  }

  if (process.platform === 'win32') {
    const bash = process.env.CLAUDE_CODE_GIT_BASH_PATH ?? 'C:\\Program Files\\Git\\bin\\bash.exe';
    add(existsSync(bash) ? 'ok' : 'fail', 'Git Bash', `${bash}${existsSync(bash) ? '' : ' (없음. 설치하거나 CLAUDE_CODE_GIT_BASH_PATH를 설정하세요)'}`);
  } else {
    add('ok', 'Git Bash', '해당 없음(Windows 전용 항목)');
  }

  if (isInside(config.runDir, repoRoot())) add('fail', 'runDir', `Ensemble 저장소 안입니다: ${config.runDir}`);
  else {
    try {
      assertFreshRunDir(config.runDir);
      add('ok', 'runDir', `저장소 밖이고 비어 있습니다: ${config.runDir}`);
    } catch (error) {
      add('fail', 'runDir', errorText(error));
    }
  }

  try {
    const state = await productState(repoRoot());
    add('info', 'productState', `${state.commit.slice(0, 8)} ${state.dirty ? '제품 코드(app/packages, app/apps)에 변경이 있습니다. Iter 1 기준선이 아닙니다' : '제품 코드가 깨끗합니다'}`);
  } catch (error) {
    add('fail', 'productState', errorText(error));
  }

  if (!config.skipLive) {
    const scratch = mkdtempSync(join(tmpdir(), 'dogfood-preflight-'));
    try {
      const login = await runClaude({ role: 'preflight-login', prompt: 'OK라고만 답하라.', cwd: scratch, tools: 'none', timeoutMs: 120_000 });
      add(login.ok ? 'ok' : 'fail', '로그인', login.ok ? `응답 ${JSON.stringify(login.text.trim().slice(0, 20))}` : (login.error ?? '실패'));

      const allowed = await runClaude({
        role: 'preflight-allowed-tools', prompt: 'node -e "console.log(42)"를 실행하고 출력만 답하라', cwd: scratch, tools: { allowed: [BASH('node')] }, timeoutMs: 180_000,
      });
      add(allowed.ok && allowed.text.includes('42') ? 'ok' : 'fail', 'allowedTools 패턴', allowed.ok && allowed.text.includes('42') ? 'Bash(node *)가 허용됐습니다' : `42가 나오지 않았습니다: ${(allowed.error ?? allowed.text).slice(0, 200)}`);

      const { tool, system } = await syntheticInterpretation();
      const compressed = compressSchema(tool.inputSchema);
      const ref = await schemaCall(compressed.schema, scratch);
      add(ref.ok && ref.structured ? 'ok' : 'fail', '$ref 스키마', ref.ok && ref.structured ? `압축 스키마(${JSON.stringify(compressed.schema).length}자, $defs ${compressed.defs}개)로 구조화 출력을 받았습니다` : `구조화 출력을 받지 못했습니다: ${ref.error ?? '출력 없음'}`);

      const request = { model: 'pm', system, forceTool: tool.name, tools: [tool], messages: [{ role: 'user' as const, content: '{}' }] };
      const before = estimateArgvChars(request);
      const after = estimateArgvChars({ ...request, tools: [{ ...tool, inputSchema: compressed.schema }] });
      const over = process.platform === 'win32' && config.pmRuntime === 'claude' && after > config.argvLimit;
      add(over ? 'fail' : 'info', 'argv 추정', `합성 상태(사람 메시지 60, 작업 30)에서 압축 전 ${before}자, 압축 뒤 ${after}자, 한도 ${config.argvLimit}자${over ? '. 한도를 넘습니다. --pm-runtime api나 WSL을 쓰세요' : ''}`);
    } catch (error) {
      add('fail', 'live 점검', errorText(error));
    } finally {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
    }
  } else {
    add('info', 'live 점검', '--skip-live라서 로그인·allowedTools·$ref 스키마·argv 점검을 건너뜁니다');
  }

  add('info', 'CLAUDE_CODE_OAUTH_TOKEN', process.env.CLAUDE_CODE_OAUTH_TOKEN ? '설정됨' : '설정되지 않음. 장시간 실행에는 claude setup-token으로 만든 토큰을 권장합니다');
  add('info', '절전', `실행 중 절전·화면 잠금 절전에 들어가면 멈춥니다. 전원 설정에서 절전을 끄세요`);

  printTable(rows);
  const failed = rows.filter((r) => r.level === 'fail').length;
  console.log(failed === 0 ? '\n점검 통과' : `\n실패 ${failed}건. 고친 뒤 다시 실행하세요`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- 실행 명령

function readMetrics(file: string): DogfoodMetrics | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DogfoodMetrics | null;
  } catch {
    return null;
  }
}

/** 정상 정지 0, 오류 1, 점검이 필요한 정지(stalled·infra·argv_limit·interrupted) 2. */
function exitCodeOf(reason: string): number {
  if (reason === 'error') return 1;
  if (['stalled', 'infra', 'argv_limit', 'interrupted'].includes(reason)) return 2;
  return 0;
}

async function smoke(config: DogfoodConfig): Promise<number> {
  const result = await runIteration(config);
  const layout = runLayout(config.runDir);
  const m = readMetrics(layout.metrics);
  const checks: [string, boolean][] = [
    ['계획 확정(workflow.planCommitted)', m?.workflow.planCommitted === true],
    ['대상 레포 main 반영 4건(integration.verifiedDone)', m?.integration.verifiedDone === 4],
    ['계획 밖 요청 1건 이상(coordination.beyondPlan)', (m?.coordination.beyondPlan ?? 0) >= 1],
  ];
  for (const [label, ok] of checks) console.log(`[${ok ? 'OK' : '실패'}] ${label}`);
  console.log(`정지: ${result.reason}${result.detail === undefined ? '' : `(${result.detail})`}, 사이클 ${result.cycles}`);
  console.log(`리포트: ${layout.report}`);
  const ok = checks.every(([, passed]) => passed);
  console.log(ok ? '스모크 통과' : '스모크 실패');
  return ok ? 0 : 1;
}

async function run(config: DogfoodConfig): Promise<number> {
  const result = await runIteration(config);
  console.log(`정지: ${result.reason}${result.detail === undefined ? '' : `(${result.detail})`}, 사이클 ${result.cycles}`);
  console.log(`리포트: ${runLayout(config.runDir).report}`);
  return exitCodeOf(result.reason);
}

async function report(config: DogfoodConfig, compareRunDir: string | undefined): Promise<number> {
  const ledgers = await loadRunLedgers(config.runDir);
  const compare = compareRunDir === undefined ? undefined : await loadMetrics(compareRunDir);
  const layout = runLayout(config.runDir);
  const { metrics } = await writeReport(layout, ledgers, compare === undefined ? {} : { compare });
  if (metrics === null) console.log('원장이 비어 있어 지표가 없습니다.');
  console.log(`리포트: ${layout.report}`);
  console.log(`지표: ${layout.metrics}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { command, config, compareRunDir } = parseArgs(argv);
  switch (command) {
    case 'preflight': return preflight(config);
    case 'smoke': return smoke(config);
    case 'run': return run(config);
    case 'report': return report(config, compareRunDir);
  }
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`오류: ${errorText(error).split(/\r?\n/)[0]}`);
      process.exit(1);
    },
  );
}
