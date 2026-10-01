import type { Report } from './harness.ts';
import { BASE_SHA, plan, RUBRIC_HASH } from './protocol.ts';

/** Resume unattempted cells only. Failed cells are completed observations, never retries. */
export function pendingCells(reports: Report[], starterHash: string, config: Record<string, { model: string; effort: string }>) {
  const ids = new Set<string>();
  for (const report of reports) {
    const expected = plan().find(cell => cell.id === report.cell?.id);
    if (!expected || ids.has(expected.id) || report.mode !== 'live' || report.baseSha !== BASE_SHA || report.rubricHash !== RUBRIC_HASH
      || report.starterHash !== starterHash || report.cell.task !== expected.task || report.cell.provider !== expected.provider
      || report.cell.ensemble !== expected.ensemble || report.model !== config[expected.provider]?.model || report.effort !== config[expected.provider]?.effort
      || !['passed', 'failed', 'timeout', 'call_limit', 'checkpoint_failed', 'interrupted'].includes(report.status)) {
      throw new Error('Resume report does not match the frozen live experiment');
    }
    ids.add(expected.id);
  }
  return plan().filter(cell => !ids.has(cell.id));
}
