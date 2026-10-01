import { expect, it } from 'vitest';
import { BASE_SHA, RUBRIC_HASH, VALIDATION_CRITERIA_HASH, validationApproval, validationPlan } from '../src/protocol.ts';
const hashes = { starterHash: 'starter', evaluatorHash: 'oracle', implementationHash: 'implementation' };
const approved = { ...hashes, liveValidationRuns: 1, previousConservativeAttempts: 7, totalAuthorizedSlots: 8, reruns: false,
  model: 'gpt-6-astra', effort: 'low', provider: 'codex', task: 'A', ensemble: true, baseSha: BASE_SHA, rubricHash: RUBRIC_HASH, criteriaHash: VALIDATION_CRITERIA_HASH,
  source: 'TEST ONLY explicit authorization fixture', approvedBy: 'test owner', toolsMatched: true };
it('selects exactly the reserved Ensemble Task A slot and checks its frozen authorization', () => {
  expect(validationPlan()).toEqual([{ id: 'validation-08', ordinal: 8, task: 'A', provider: 'codex', ensemble: true }]);
  expect(() => validationApproval(approved, hashes)).not.toThrow();
});
it('rejects old approvals, expanded scope, stale criteria and replays', () => {
  for (const patch of [{ liveEightRuns: true }, { livePairedRuns: 2 }, { liveValidationRuns: 2 }, { previousConservativeAttempts: 8 },
    { model: 'other' }, { effort: 'high' }, { totalAuthorizedSlots: 9 }, { reruns: true }, { ensemble: false }, { provider: 'claude' }, { task: 'B' },
    { criteriaHash: 'other' }, { implementationHash: 'old' }, { toolsMatched: false }, { source: '' }, { baseSha: 'old' }]) {
    expect(() => validationApproval({ ...approved, ...patch }, hashes)).toThrow('Exactly one');
  }
});
