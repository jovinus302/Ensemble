// QA step (d): sync check. Runs the pure film animation functions (src/v5/filmAnim.ts) and
// reports, for each event, the frame it actually becomes visible vs the timing.json /
// storyboard target (+-1f) and the grid it sits on (bar / beat). Also lists SFX frames.
import {probes} from '../../src/v5/filmAnim';
import {SFX_EVENTS} from '../../src/v5/timeline';
import {DOWNBEATS, isBeat} from '../../src/v5/timing';

type Mode = 'start' | 'settle' | 'peak';
const THR = {start: 0.03, settle: 0.98, spring: 0.995}; // first-visible-motion / eased curve landed / spring landed
// label, probe, mode, storyboard target (absolute frame, §3 as re-aligned to timing.json), tolerance
const ROWS: {label: string; probe: string; mode: Mode; target: number; tol?: number; thr?: number}[] = [
  {label: 'B1 headline settle', probe: 'B1 headline settle', mode: 'settle', target: 45},
  {label: 'B1 headline exit starts', probe: 'B1 headline exit', mode: 'start', target: 150},
  {label: 'B2 chip 1 pops', probe: 'B2 chip 1', mode: 'start', target: 180},
  {label: 'B2 capsule forms', probe: 'B2 capsule forms', mode: 'start', target: 210},
  {label: 'B2 amber ring D', probe: 'B2 ring D', mode: 'start', target: 270},
  {label: 'B2 amber ring S', probe: 'B2 ring S', mode: 'start', target: 278},
  {label: 'B2 amber ring P', probe: 'B2 ring P', mode: 'start', target: 285},
  {label: 'B2 headline settle', probe: 'B2 headline settle', mode: 'settle', target: 300},
  {label: 'B3 PM tile lights', probe: 'B3 PM tile lights', mode: 'start', target: 360},
  {label: 'B3 headline settle', probe: 'B3 headline settle', mode: 'settle', target: 390},
  {label: 'B3 thread M->D lands', probe: 'B3 thread M->D ends', mode: 'settle', target: 420, thr: THR.spring},
  {label: 'B3 D pin opens', probe: 'B3 pin opens', mode: 'start', target: 420},
  {label: 'B3 headline exit starts', probe: 'B3 headline exit', mode: 'start', target: 450},
  {label: 'B3 S reply + 전달됨', probe: 'B3 reply 전달됨', mode: 'start', target: 495},
  {label: 'B3 brief arrives in A', probe: 'B3 brief arrives', mode: 'start', target: 540},
  {label: 'B3 glow pulse peak', probe: 'B3 pulse peak', mode: 'peak', target: 600},
  {label: 'B4 scan thread lands on P', probe: 'B4 scan thread lands', mode: 'settle', target: 690, thr: THR.spring},
  {label: 'B4 decision card rises', probe: 'B4 card rises', mode: 'start', target: 705},
  {label: 'B4 headline settle', probe: 'B4 headline settle', mode: 'settle', target: 735},
  {label: 'B4 headline exit starts', probe: 'B4 headline exit', mode: 'start', target: 792},
  {label: 'B4 click (music accent)', probe: 'B4 click press', mode: 'peak', target: 810},
  {label: 'B4 chip 제안 -> 확정', probe: 'B4 chip -> 확정', mode: 'start', target: 818},
  {label: 'B5 thread -> A lands', probe: 'B5 thread -> A lands', mode: 'settle', target: 945, thr: THR.spring},
  {label: 'B5 반영됨 chip (A)', probe: 'B5 반영됨 chip (A)', mode: 'start', target: 960},
  {label: 'B5 banner number roll', probe: 'B5 banner roll', mode: 'start', target: 975},
  {label: 'B5 D chip 전달됨 -> 반영됨', probe: 'B5 D chip 반영됨', mode: 'start', target: 1000},
  {label: 'B5 P chip', probe: 'B5 P chip', mode: 'start', target: 1005},
  {label: 'B5 PM memo', probe: 'B5 memo', mode: 'start', target: 1020},
  {label: 'B5 headline settle', probe: 'B5 headline settle', mode: 'settle', target: 1020},
  {label: 'B5 headline exit starts', probe: 'B5 headline exit', mode: 'start', target: 1068},
  {label: 'B6 capsule date flip starts', probe: 'B6 date flip', mode: 'start', target: 1080},
  {label: 'B6 rack focus starts', probe: 'B6 rack focus', mode: 'start', target: 1080},
  {label: 'B6 민호 question', probe: 'B6 minho', mode: 'start', target: 1125},
  {label: 'B6 PM answer', probe: 'B6 answer', mode: 'start', target: 1155},
  {label: 'B6 reverse thread lands on M', probe: 'B6 reverse thread lands', mode: 'settle', target: 1200, thr: THR.spring},
  {label: 'B6 headline settle', probe: 'B6 headline settle', mode: 'settle', target: 1230},
  {label: 'B6 headline exit starts', probe: 'B6 headline exit', mode: 'start', target: 1290},
  {label: 'B7 capsule becomes V decision row', probe: 'B7 capsule -> V row', mode: 'start', target: 1356},
  {label: 'B7 V rows unfold (first)', probe: 'B7 V row 目標', mode: 'start', target: 1365},
  {label: 'B7 headline settle', probe: 'B7 headline settle', mode: 'settle', target: 1410},
  {label: 'B7 headline exit starts', probe: 'B7 headline exit', mode: 'start', target: 1455},
  {label: 'C headline settle', probe: 'C headline settle', mode: 'settle', target: 1480},
  {label: 'C headline morph starts', probe: 'C headline morph starts', mode: 'start', target: 1536},
  {label: 'C wordmark lands (final hit)', probe: 'C wordmark lands', mode: 'settle', target: 1560, thr: THR.spring},
];
const N = 1700;
const series: Record<string, number[]> = {};
for (let f = 0; f < N; f++) for (const [k, v] of Object.entries(probes(f))) (series[k] ??= []).push(v);
const first = (arr: number[], thr: number) => arr.findIndex((v) => v >= thr);
const grid = (f: number) => (DOWNBEATS.includes(f) ? 'bar' : isBeat(f) ? 'beat' : 'off-grid');
const out: string[] = [];
out.push('| 이벤트 | 목표 f | 실제 f(보임) | Δ | 목표 격자 | 판정 |', '|---|---|---|---|---|---|');
let bad = 0;
for (const r of ROWS) {
  const arr = series[r.probe];
  const actual = r.mode === 'start' ? first(arr, r.thr ?? THR.start) : r.mode === 'settle' ? first(arr, r.thr ?? THR.settle) : arr.indexOf(Math.max(...arr));
  const d = actual - r.target;
  const ok = Math.abs(d) <= (r.tol ?? 1);
  if (!ok) bad++;
  out.push(`| ${r.label} | ${r.target} | ${actual} | ${d >= 0 ? '+' : ''}${d} | ${grid(r.target)} | ${ok ? 'OK' : 'CHECK'} |`);
}
out.push('', '| SFX | 프레임 | 격자 |', '|---|---|---|');
for (const e of SFX_EVENTS) out.push(`| ${e.name} (${e.label}) | ${e.frame} | ${grid(e.frame)} |`);
out.push('', `rows outside +-1f: ${bad}`);
console.log(out.join('\n'));
