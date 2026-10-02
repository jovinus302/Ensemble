import { describe, expect, it } from 'vitest';
import { AGREE, CHANGE, DISCUSS, demoReducer as reduce, initialDemo } from '../lib/fixed-demo';
const start = () => reduce(initialDemo(), { type: 'start' });
const agree = () => reduce(reduce(start(), { type: 'send', phase: 'discussion', text: DISCUSS }), { type: 'send', phase: 'agreement', text: AGREE });
describe('scripted human-owned demo', () => {
  it('cannot advance on empty input, disagreement, or a timer at a human gate', () => {
    let s = start();
    s = reduce(s, { type: 'send', phase: 'discussion', text: ' ' });
    s = reduce(s, { type: 'send', phase: 'discussion', text: '반대합니다. 실명을 유지합시다.' });
    s = reduce(s, { type: 'finish', phase: 'discussion', run: s.run });
    expect(s.phase).toBe('discussion'); expect(s.revision).toBe(0);
  });
  it('requires both human turns and ignores stale double submissions', () => {
    const s = reduce(start(), { type: 'send', phase: 'discussion', text: DISCUSS });
    expect(s.phase).toBe('agreement'); expect(s.revision).toBe(0);
    expect(reduce(s, { type: 'send', phase: 'discussion', text: DISCUSS })).toBe(s);
    expect(reduce(s, { type: 'send', phase: 'agreement', text: DISCUSS }).phase).toBe('agreement');
    expect(agree().phase).toBe('executing');
  });
  it('completes only the scripted revision request after first delivery', () => {
    let s = agree(); s = reduce(s, { type: 'finish', phase: s.phase, run: s.run });
    expect(s.revision).toBe(1);
    s = reduce(s, { type: 'send', phase: 'delivered', text: CHANGE });
    expect(s.phase).toBe('revising'); expect(s.revision).toBe(1);
    s = reduce(s, { type: 'finish', phase: s.phase, run: s.run });
    expect(s.revision).toBe(2); expect(s.phase).toBe('complete');
  });
  it('invalidates in-flight callbacks on reset and back', () => {
    const s = agree(); const callback = { type: 'finish' as const, phase: s.phase, run: s.run };
    const reset = reduce(s, { type: 'reset' }); expect(reduce(reset, callback)).toBe(reset);
    const back = reduce(s, { type: 'back' }); expect(back.phase).toBe('agreement'); expect(reduce(back, callback)).toBe(back);
    const restarted = reduce(back, { type: 'send', phase: 'agreement', text: AGREE });
    expect(reduce(restarted, callback)).toBe(restarted);
  });
  it('does not let an early future answer poison its later required gate', () => {
    let s = start();
    s = reduce(s, { type: 'send', phase: 'discussion', text: AGREE });
    s = reduce(s, { type: 'send', phase: 'discussion', text: CHANGE });
    expect(s.phase).toBe('discussion');
    s = reduce(s, { type: 'send', phase: 'discussion', text: DISCUSS });
    s = reduce(s, { type: 'send', phase: 'agreement', text: AGREE });
    expect(s.phase).toBe('executing');
    s = reduce(s, { type: 'finish', phase: s.phase, run: s.run });
    s = reduce(s, { type: 'send', phase: 'delivered', text: CHANGE });
    expect(s.phase).toBe('revising');
  });
});
