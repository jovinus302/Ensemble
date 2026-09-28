// motion-remotion/에서 node review/v4-pm/render-check.mjs [final|debug|regression] [스틸 ID]
// 파일 props로 CLI를 호출하고 실제 종료 코드·브라우저 관찰값을 남긴다.
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const mode = process.argv[2] ?? 'final';
assert(['final', 'debug', 'regression'].includes(mode));
const dir = 'review/v4-pm';
await mkdir(`${dir}/evidence`, {recursive: true});
await mkdir(`${dir}/props`, {recursive: true});
const allJobs = mode === 'regression'
  ? ['SF1a', 'SF1b', 'SF2', 'SF3'].map(still => ({id: `v4-${still}`, still, composition: 'StyleFrameV4', rise: 1, debug: false}))
  : mode === 'debug'
  ? ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].flatMap(still => [0, 1].map(rise => ({id: `${still}-rise${rise}`, still, composition: 'StyleFrameV4PM', rise, debug: true})))
  : ['O1', 'OH', 'O2', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'].map(still => ({id: still, still, composition: 'StyleFrameV4PM', rise: 1, debug: false}));
const selected = process.argv[3];
const jobs = selected ? allJobs.filter(job => job.id === selected) : allJobs;
assert(jobs.length > 0, '알 수 없는 스틸 ID');
const results = selected ? JSON.parse(await readFile(`${dir}/evidence/${mode}.json`, 'utf8')).filter(result => result.id !== selected) : [];
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
for (const job of jobs) {
  const props = `${dir}/props/${job.id}.json`;
  const output = mode === 'final' ? `${dir}/${job.id}.png` : `${dir}/evidence/${job.id}.png`;
  await writeFile(props, JSON.stringify({still: job.still, heroRise: job.rise, debugProjection: job.debug, measure: mode !== 'regression'}));
  const args = ['node_modules/@remotion/cli/remotion-cli.js', 'still', 'src/index.ts', job.composition, output, `--props=${props}`, '--log=verbose'];
  let log = '';
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout.on('data', data => {log += data.toString();});
    child.stderr.on('data', data => {log += data.toString();});
    child.on('error', reject);
    child.on('close', resolve);
  });
  await writeFile(`${dir}/evidence/${job.id}-render.log`, log);
  assert.equal(exitCode, 0, `${job.id} 렌더 실패: 로그 확인`);
  const measurementLine = log.split('\n').find(line => line.includes('V4PMMEASURE '));
  const measurement = measurementLine ? JSON.parse(measurementLine.slice(measurementLine.indexOf('V4PMMEASURE ') + 'V4PMMEASURE '.length).match(/\{.*\}/)[0]) : null;
  if (mode !== 'regression') assert(measurement, `${job.id} 측정 누락`);
  if (mode === 'debug') assert(measurement.anchorError !== null && measurement.anchorError <= 1);
  const result = {id: job.id, exitCode, sha256: await hash(output), measurement};
  if (mode === 'regression') {
    result.referenceSha256 = await hash(`review/v4/${job.still}.png`);
    result.identical = result.sha256 === result.referenceSha256;
  }
  results.push(result);
  await writeFile(`${dir}/evidence/${mode}.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({id: job.id, exitCode, identical: result.identical, minBody: measurement?.minBody, minSecondary: measurement?.minSecondary, heroChipHeight: measurement?.heroChipHeight, anchorError: measurement?.anchorError}));
}
if (mode === 'regression') assert(results.every(r => r.identical), 'v4 해시 불일치: 원인 조사 필요');
