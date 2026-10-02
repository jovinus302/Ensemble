import { createHash } from 'node:crypto';

export const HISTORICAL_BASE_SHA = 'a6bfc345bde634422421c500fad264419bc04ec9';
// Frozen production validation baseline: 788 offline tests, typecheck, build and browser controls passed.
export const BASE_SHA = '7cd8de808caf046e0bcc3894a27054dca133d987';
/** New neutral-role experiment; never pool with legacy prototype-role pilot observations. */
export const PROTOCOL_REVISION = 'paired-validation-v4';
export const LIMITS: Readonly<{ totalMs: number; calls: number }> = Object.freeze({ totalMs: 20 * 60_000, calls: 24 });
export type Provider = 'codex' | 'claude';
export type Task = 'A' | 'B';
export type Role = 'pm' | 'worker' | 'judge';
export type Mode = 'fixture' | 'live';
export interface Condition { provider: Provider; ensemble: boolean }
export interface Cell extends Condition { task: Task; ordinal: number; id: string }
export const RUBRIC = Object.freeze({
  version: 2, widths: [390, 1440],
  common: ['selection', 'sold-out', 'server-error', 'confirmation', 'reload', 'console', 'layout'],
  changed: ['clear-early-time-with-reason', 'eight-after-18', 'reject-nine', 'edit-save-reload'],
  checkpoint: ['build', 'actual-date-time-guests-selection'],
  interpretation: 'n=1 exploratory only; compare within provider; never infer superiority',
});
export const RUBRIC_HASH = createHash('sha256').update(JSON.stringify(RUBRIC)).digest('hex');
// Slot 8 was consumed by the preregistered observation; no additional live run is authorized.
export const LIVE_RUNS_REMAINING = 0;
export function assertLiveCapacity(): void {
  if (LIVE_RUNS_REMAINING === 0) throw new Error('All eight authorized slots are consumed; no additional live run or retry is authorized');
}
export const VALIDATION_MODEL = Object.freeze({ model: 'gpt-6-astra', effort: 'low' });
export const PAIRED_MODELS = Object.freeze({ codex: VALIDATION_MODEL, claude: Object.freeze({ model: 'claude-opus-4-8', effort: 'xhigh' }) });
export const PAIRED_APPROVAL_SOURCE = 'Sentinel_44444b08f3fc8191bf1bf2dc740c6247';
export const NEW_BATCH_SLOTS = 8;
export type ProviderConfig = Record<Provider, { model: string; effort: string }>;
export interface ProtocolHashes { starterHash: string; evaluatorHash: string; implementationHash: string }
export function pairedPlan(): Cell[] { return plan().map(cell => ({ ...cell, id: `v4-${String(cell.ordinal).padStart(2, '0')}` })); }
export function pairedApproval(value: unknown, hashes: ProtocolHashes, config: unknown): asserts config is ProviderConfig {
  const a = value as Record<string, unknown> | null;
  const matchesModels = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const entries = candidate as Record<string, { model?: unknown; effort?: unknown }>;
    return Object.keys(entries).length === 2 && Object.entries(PAIRED_MODELS).every(([provider, expected]) =>
      entries[provider]?.model === expected.model && entries[provider]?.effort === expected.effort
      && Object.keys(entries[provider]!).length === 2);
  };
  if (!a || a.protocolRevision !== PROTOCOL_REVISION || a.livePairedRuns !== NEW_BATCH_SLOTS || a.liveEightRuns !== undefined
    || a.liveValidationRuns !== undefined || a.previousConservativeAttempts !== 8 || a.totalAuthorizedSlots !== 16 || a.reruns !== false
    || a.source !== PAIRED_APPROVAL_SOURCE || typeof a.approvedBy !== 'string' || !a.approvedBy.trim() || a.toolsMatched !== true
    || a.baseSha !== BASE_SHA || a.rubricHash !== RUBRIC_HASH || Object.entries(hashes).some(([key, expected]) => a[key] !== expected)
    || !matchesModels(config) || !matchesModels(a.config)) throw new Error('New v4 eight-cell approval with exact frozen models, provenance and hashes is required; old approvals and retries are forbidden');
}
export const VALIDATION_CRITERIA = ['trusted-current-revision-pass', 'worker-limitations-preserved', 'judge-after-validation', 'checked-handoff-same-artifact', 'semantic-browser-pass'] as const;
export const VALIDATION_CRITERIA_HASH = createHash('sha256').update(JSON.stringify(VALIDATION_CRITERIA)).digest('hex');
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
/** The one remaining authorized slot verifies the new path, not a paired performance comparison. */
export function validationPlan(): Cell[] {
  return [{ task: 'A', provider: 'codex', ensemble: true, ordinal: 8, id: 'validation-08' }];
}
export function validationApproval(value: unknown, hashes: { starterHash: string; evaluatorHash: string; implementationHash: string }): void {
  const a = value as Record<string, unknown> | null;
  if (!a || a.liveValidationRuns !== 1 || a.liveEightRuns !== undefined || a.livePairedRuns !== undefined
    || a.previousConservativeAttempts !== 7 || a.totalAuthorizedSlots !== 8 || a.reruns !== false
    || a.provider !== 'codex' || a.task !== 'A' || a.ensemble !== true
    || a.model !== VALIDATION_MODEL.model || a.effort !== VALIDATION_MODEL.effort
    || a.baseSha !== BASE_SHA || a.rubricHash !== RUBRIC_HASH || a.criteriaHash !== VALIDATION_CRITERIA_HASH
    || typeof a.source !== 'string' || !a.source.trim() || typeof a.approvedBy !== 'string' || !a.approvedBy.trim()
    || a.toolsMatched !== true || Object.entries(hashes).some(([key, expected]) => a[key] !== expected)) {
    throw new Error('Exactly one explicitly approved current-revision Ensemble validation run is required; prior approvals and retries are forbidden');
  }
}
export function approval(value: unknown, hashes?: { starterHash: string; evaluatorHash: string; implementationHash: string }): void {
  const a = value as Record<string, unknown> | null;
  if (!a || a.liveEightRuns !== true || a.baseSha !== BASE_SHA || a.rubricHash !== RUBRIC_HASH
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
