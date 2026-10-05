#!/usr/bin/env node
// 김상성의 개인 Coding Agent 흉내: Ensemble 밖(IDE)에서 끝낸 작업 결과를 팀 작업 상태로 보낸다.
// 실제 IDE 연동은 없다. 이 스크립트가 그 자리에서 `POST /api/tasks/:id/result`(W1 계약)를 부른다.
//
//   node scripts/personal-agent-submit.mjs --task T-1 --member kim-sangsung \
//     --pr https://github.com/example/ensemble/pull/1 --summary "로그인 API 구현" [--dry-run]
//
// 옵션: --base (기본 ENSEMBLE_URL 또는 http://localhost:3000), --token (기본 ENSEMBLE_TOKEN 또는 dev-token),
//       --agent (기본 "김상성의 Coding Agent"), --channel (ide|slack|knox|cli|ensemble, 기본 ide),
//       --condition (여러 번 가능: 결과 보고서에 확인할 인계 조건. 없으면 서버의 작업 상세에서 읽고, 못 읽으면 T-1 기본값),
//       --no-report (결과 보고서 파일 없이 PR 링크만 보낸다), --dry-run (보내지 않고 요청 본문만 출력).
import { pathToFileURL } from 'node:url';

/** 서버에서 조건을 읽지 못할 때 쓰는 T-1(로그인 API 구현)의 인계 조건. apps/web/lib/fake-connector.ts의 계획과 같다. */
export const DEFAULT_CONDITIONS = ['로그인 API PR 링크와 변경 요약', '로그인 API 테스트 결과'];
const CHANNELS = ['ide', 'slack', 'knox', 'cli', 'ensemble'];

export function parseArgs(argv) {
  const options = { conditions: [], report: true, dryRun: false, channel: 'ide', agent: '김상성의 Coding Agent',
    base: process.env.ENSEMBLE_URL ?? 'http://localhost:3000', token: process.env.ENSEMBLE_TOKEN ?? 'dev-token' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${flag} 값이 없습니다.`); return v; };
    switch (flag) {
      case '--task': options.task = value(); break;
      case '--member': options.member = value(); break;
      case '--pr': options.pr = value(); break;
      case '--summary': options.summary = value(); break;
      case '--base': options.base = value(); break;
      case '--token': options.token = value(); break;
      case '--agent': options.agent = value(); break;
      case '--channel': options.channel = value(); break;
      case '--condition': options.conditions.push(value()); break;
      case '--no-report': options.report = false; break;
      case '--dry-run': options.dryRun = true; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`알 수 없는 옵션: ${flag}`);
    }
  }
  if (options.help) return options;
  for (const key of ['task', 'member', 'summary']) if (!options[key]?.trim()) throw new Error(`--${key}가 필요합니다.`);
  if (options.pr !== undefined && !/^https?:\/\//i.test(options.pr)) throw new Error('--pr은 http(s) 주소여야 합니다.');
  if (!CHANNELS.includes(options.channel)) throw new Error(`--channel은 ${CHANNELS.join('|')} 중 하나여야 합니다.`);
  return options;
}

/** 개인 Agent가 남기는 결과 보고서: 인계 조건마다 한 절("### n. 조건")을 두어 PM의 인계 판단이 근거를 인용할 수 있게 한다. */
export function resultReport({ task, summary, pr, agent, conditions }) {
  return [
    `# ${task} 결과 보고 — ${agent}`,
    'Ensemble 밖(IDE)에서 개인 Coding Agent와 함께 끝낸 작업입니다. 시연용 가상 자료입니다.',
    '',
    '## 인계 조건 확인',
    ...conditions.flatMap((c, i) => [`### ${i + 1}. ${c}`,
      ...(i === 0 && pr ? [`- PR: ${pr}`] : []),
      ...(i === 0 ? [`- 변경 요약: ${summary}`] : []),
      ...(/테스트/.test(c) ? ['- 로그인 API 테스트 결과: 단위 테스트 12개 통과, 실패 0개(시연용 가상 결과)'] : [])]),
    '',
  ].join('\n');
}

/** `POST /api/tasks/:id/result` 본문(W1 계약). */
export function buildRequest(options, conditions = options.conditions.length ? options.conditions : DEFAULT_CONDITIONS) {
  const artifacts = [];
  if (options.pr) artifacts.push({ kind: 'url', name: 'Pull Request', uri: options.pr });
  if (options.report) {
    const text = resultReport({ task: options.task, summary: options.summary, pr: options.pr, agent: options.agent, conditions });
    artifacts.push({ kind: 'file', name: `${options.task} 결과 보고.md`, mimeType: 'text/markdown', contentBase64: Buffer.from(text, 'utf8').toString('base64') });
  }
  return {
    url: `${options.base.replace(/\/+$/, '')}/api/tasks/${encodeURIComponent(options.task)}/result`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
    body: { memberId: options.member, summary: options.summary, ...(artifacts.length ? { artifacts } : {}), via: { channel: options.channel, agent: options.agent } },
  };
}

/** 개인 Agent가 하듯 Ensemble에서 작업의 인계 조건을 먼저 읽는다. 실패하면 undefined(기본 조건으로 보낸다). */
async function fetchConditions(options) {
  try {
    const res = await fetch(`${options.base.replace(/\/+$/, '')}/api/tasks/${encodeURIComponent(options.task)}?me=${encodeURIComponent(options.member)}`, { headers: { Authorization: `Bearer ${options.token}` } });
    if (!res.ok) return undefined;
    const conditions = (await res.json())?.item?.handoffConditions;
    return Array.isArray(conditions) && conditions.length ? conditions.filter(c => typeof c === 'string') : undefined;
  } catch { return undefined; }
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; return; }
  if (options.help) { console.log('사용법: node scripts/personal-agent-submit.mjs --task T-1 --member kim-sangsung --pr <url> --summary "..." [--dry-run]'); return; }
  const conditions = options.conditions.length ? options.conditions : options.dryRun ? DEFAULT_CONDITIONS : await fetchConditions(options) ?? DEFAULT_CONDITIONS;
  const request = buildRequest(options, conditions);
  if (options.dryRun) {
    console.log(`POST ${request.url}`);
    console.log(JSON.stringify(request.body, null, 2));
    return;
  }
  console.log(`[${options.agent}] ${options.task} 결과를 보냅니다 → ${request.url}`);
  const res = await fetch(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body) });
  const text = await res.text();
  if (!res.ok) { console.error(`실패 (${res.status}): ${text}`); process.exitCode = 1; return; }
  console.log(`접수됨: ${text}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
