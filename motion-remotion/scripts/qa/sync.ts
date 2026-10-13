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
];
const N = 700;
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
