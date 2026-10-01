import { expect, it } from 'vitest';
import { pendingCells } from '../src/resume.ts';
import { BASE_SHA, plan, RUBRIC_HASH } from '../src/protocol.ts';
import type { Report } from '../src/harness.ts';
const config = { codex: { model: 'fixed', effort: 'low' }, claude: { model: 'fixed-c', effort: 'xhigh' } };
const report = (index: number) => ({ cell: plan()[index]!, mode: 'live', baseSha: BASE_SHA, rubricHash: RUBRIC_HASH,
  starterHash: 'same', model: 'fixed', effort: 'low', status: 'failed' } as Report);
it('retains the first two failed observations and selects exactly the six unrun cells', () => {
  expect(pendingCells([report(0), report(1)], 'same', config).map(c => c.id)).toEqual(plan().slice(2).map(c => c.id));
});
it('rejects changed controls, fixture observations and duplicate cells instead of retrying', () => {
  for (const reports of [[report(0), report(0)], [{ ...report(0), mode: 'fixture' }], [{ ...report(0), model: 'other' }], [{ ...report(0), starterHash: 'other' }]]) {
    expect(() => pendingCells(reports as Report[], 'same', config)).toThrow('frozen');
  }
});
