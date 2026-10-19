// QA (d) for the teaser: when each event becomes visible in TEASER frames (source frame = teaserSource(tf))
// vs the teaser accents of public/audio/timing.json (lift f120, drive f240, resolve f420) and the §6 table.
import {probes} from '../../src/v5/filmAnim';
import {TEASER_SFX, TV, teaserSource} from '../../src/v5/teaser';
import timing from '../../public/audio/timing.json';

type Mode = 'start' | 'settle' | 'peak';
const THR = {start: 0.03, settle: 0.98, spring: 0.995};
const ROWS: {label: string; probe: string; mode: Mode; target: number; thr?: number}[] = [
  {label: 'B2 headline settle (table f60)', probe: 'B2 headline settle', mode: 'settle', target: 60},
  {label: 'B2 headline exit starts (table f116)', probe: 'B2 headline exit', mode: 'start', target: 116},
  {label: 'LIFT accent: PM tile lights + word swap', probe: 'B3 PM tile lights', mode: 'start', target: TV.lift},
  {label: 'B3 headline settle (table f150)', probe: 'B3 headline settle', mode: 'settle', target: 150},
  {label: 'B3 headline exit starts (table f210)', probe: 'B3 headline exit', mode: 'start', target: 210},
  {label: 'DRIVE accent: click press', probe: 'B4 click press', mode: 'peak', target: TV.drive},
  {label: 'chip 제안 -> 확정', probe: 'B4 chip -> 확정', mode: 'start', target: TV.drive + 8},
  {label: 'number roll starts (table f270)', probe: 'B5 banner roll', mode: 'start', target: TV.drive + 30},
  {label: 'capsule -> V decision row', probe: 'B7 capsule -> V row', mode: 'start', target: TV.drive + 66},
  {label: 'C headline settle (table f340)', probe: 'C headline settle', mode: 'settle', target: 340},
  {label: 'C headline morph starts (table f396)', probe: 'C headline morph starts', mode: 'start', target: 396},
  {label: 'RESOLVE accent: wordmark lands', probe: 'C wordmark lands', mode: 'settle', target: TV.resolve, thr: THR.spring},
];
const N = TV.total;
const series: Record<string, number[]> = {};
for (let tf = 0; tf < N; tf++) for (const [k, v] of Object.entries(probes(teaserSource(tf)))) (series[k] ??= []).push(v);
const first = (a: number[], t: number) => a.findIndex((v) => v >= t);
const out: string[] = ['| 이벤트 | 목표 f | 실제 f | Δ | 판정 |', '|---|---|---|---|---|'];
let bad = 0;
for (const r of ROWS) {
  const a = series[r.probe];
  const actual = r.mode === 'start' ? first(a, r.thr ?? THR.start) : r.mode === 'settle' ? first(a, r.thr ?? THR.settle) : a.indexOf(Math.max(...a));
  const d = actual - r.target;
  const ok = Math.abs(d) <= 1;
  if (!ok) bad++;
  out.push(`| ${r.label} | ${r.target} | ${actual} | ${d >= 0 ? '+' : ''}${d} | ${ok ? 'OK' : 'CHECK'} |`);
}
out.push('', `teaser accents (timing.json): ${timing.teaser.accents.map((a) => `${a.label}=${a.plannedFrame}`).join(', ')}`, '', '| SFX | 프레임 |', '|---|---|');
for (const e of [...TEASER_SFX].sort((a, b) => a.frame - b.frame)) out.push(`| ${e.name} (${e.label}) | ${e.frame} |`);
out.push('', `rows outside +-1f: ${bad}`);
console.log(out.join('\n'));
