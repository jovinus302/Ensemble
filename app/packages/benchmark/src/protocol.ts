import { createHash } from 'node:crypto';

export const HISTORICAL_BASE_SHA = 'a6bfc345bde634422421c500fad264419bc04ec9';
export const BASE_SHA = 'b34b00888b6fc79f5d349a5de195cf942c42f4e2';
/** New neutral-role experiment; never pool with legacy prototype-role pilot observations. */
export const PROTOCOL_REVISION = 'development-brief-v2';
export const LIMITS: Readonly<{ totalMs: number; calls: number }> = Object.freeze({ totalMs: 20 * 60_000, calls: 24 });
export type Provider = 'codex' | 'claude';
export type Task = 'A' | 'B';
export type Role = 'pm' | 'worker' | 'judge';
export type Mode = 'fixture' | 'live';
export interface Condition { provider: Provider; ensemble: boolean }
export interface Cell extends Condition { task: Task; ordinal: number; id: string }
export const RUBRIC = Object.freeze({
  version: 1, widths: [390, 1440],
  common: ['selection', 'sold-out', 'server-error', 'confirmation', 'reload', 'console', 'layout'],
  changed: ['clear-early-time-with-reason', 'eight-after-18', 'reject-nine', 'edit-save-reload'],
  checkpoint: ['build', 'actual-date-time-guests-selection'],
  interpretation: 'n=1 exploratory only; compare within provider; never infer superiority',
});
export const RUBRIC_HASH = createHash('sha256').update(JSON.stringify(RUBRIC)).digest('hex');
export const PROMPT_A = `Complete this React restaurant booking starter. Date/time/1–6 guests, fixed sold-out and server-error fixtures, visible helpful errors, confirmation, saved booking surviving refresh, and usable unclipped 390/1440px layout. Use the existing local POST /api/reservations fixture. Preserve data-testid contract date,time,guests,submit,confirmation,edit,message. Date 2030-06-15 time 19:00 is sold out; 2030-06-16 time 18:00 returns an error. Offer 17:00,18:00,19:00,20:00. Do not replace build.mjs/server.mjs, change fixtures, install dependencies, access network, change permissions/authentication or incur new payments. The external harness runs node build.mjs and browser acceptance; provide buildable React source. Do not request extra shell permissions or claim an external build was already run. Work only in this starter. Report files and limitations when finished.`;
export const PROMPT_B_INITIAL = `${PROMPT_A}\nThis task has a staged requirement change. First implement real working date/time/guest controls in buildable source. STOP this turn at that checkpoint, report the source files, and await the next instruction before implementing the rest. The external harness must independently build and exercise the controls before sending the next instruction. Do not invent the later change.`;
export const PROMPT_CHANGE = `Requirement change: maximum 8 guests. Parties of 7 or 8 may book only at or after 18:00. When guest count makes the chosen time invalid, clear that time and show the reason. Permit editing after confirmation; save and reload must show the edited values. Reject 9 guests. Complete all original requirements under this change and build successfully.`;

/** A reverses both within-provider orders in B; the provider blocks also cross over. */
export function plan(): Cell[] {
  return [
    ['A', 'codex', true], ['A', 'codex', false], ['A', 'claude', false], ['A', 'claude', true],
    ['B', 'claude', true], ['B', 'claude', false], ['B', 'codex', false], ['B', 'codex', true],
  ].map(([task, provider, ensemble], i) => ({ task: task as Task, provider: provider as Provider,
    ensemble: ensemble as boolean, ordinal: i + 1, id: `pilot-${String(i + 1).padStart(2, '0')}` }));
}
/** The only newly authorized live subset: exactly two original-order Task A cells. */
export function pairedPlan(provider: string): Cell[] {
  if (provider !== 'codex' && provider !== 'claude') throw new Error('--pair must be codex or claude');
  return plan().filter(cell => cell.task === 'A' && cell.provider === provider);
}
export function approval(value: unknown, hashes?: { starterHash: string; evaluatorHash: string; implementationHash: string }, provider?: string): void {
  const a = value as Record<string, unknown> | null;
  if (!provider) throw new Error('Full eight-cell live execution is not authorized; an explicitly approved --pair is required');
  const cells = pairedPlan(provider);
  if (!a || a.livePairedRuns !== 2 || a.liveEightRuns !== undefined || a.provider !== provider || a.task !== 'A'
    || a.previousConservativeAttempts !== 5 || a.totalAuthorizedSlots !== 8 || a.reruns !== false
    || Number(a.previousConservativeAttempts) + cells.length > Number(a.totalAuthorizedSlots)
    || a.baseSha !== BASE_SHA || a.rubricHash !== RUBRIC_HASH
    || typeof a.approvedBy !== 'string' || !a.approvedBy.trim() || typeof a.source !== 'string' || !a.source.trim()) {
    throw new Error('Live execution requires explicit approval provenance matching this base and rubric; never generate approval automatically');
  }
  if (hashes && (a.toolsMatched !== true || Object.entries(hashes).some(([key, value]) => a[key] !== value))) {
    throw new Error('Approval must match starter/evaluator/implementation hashes and attest toolsMatched after per-provider preflight');
  }
}
export interface Call { role: Role; startMs: number; endMs: number | null; status: 'running' | 'completed' | 'failed' }
export class Budget {
  readonly started: number;
  readonly calls: Call[] = [];
  constructor(readonly signal: AbortSignal, readonly now = () => performance.now(), readonly limits = LIMITS) { this.started = now(); }
  check() {
    this.signal.throwIfAborted();
    if (this.now() - this.started >= this.limits.totalMs) throw new Error('timeout');
  }
  async meter<T>(role: Role, operation: () => Promise<T>): Promise<T> {
    this.check();
    if (this.calls.length >= this.limits.calls) throw new Error('call_limit');
    const row: Call = { role, startMs: this.now() - this.started, endMs: null, status: 'running' };
    this.calls.push(row); // Reserve before awaiting: concurrent calls cannot bypass the cap.
    try { const result = await operation(); this.check(); row.status = 'completed'; return result; }
    catch (error) { row.status = 'failed'; throw error; }
    finally { row.endMs = this.now() - this.started; }
  }
}
