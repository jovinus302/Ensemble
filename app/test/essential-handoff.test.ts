import assert from 'node:assert/strict';
import test from 'node:test';
import { handoffReducer as reduce, initialHandoff, type State, type Action } from '../apps/web/lib/team-handoff.ts';
const act = (s: State, type: Action['type'], version = s.version) => reduce(s, { type, version, run: s.run });
const review = (s = initialHandoff()) => ['work', 'finish', 'share', 'checked'].reduce((s, type) => act(s, type as Action['type']), s);

test('personal output stays private until shared; current review gates handoff and repeated actions apply once', () => {
  let s = act(act(initialHandoff(), 'work'), 'finish');
  assert.equal(s.shared, 0);
  assert.equal(s.messages.length, 2);
  assert.strictEqual(act(s, 'approve'), s);
  s = act(s, 'share');
  assert.equal(s.phase, 'checking');
  assert.strictEqual(act(s, 'share'), s);
  assert.strictEqual(act(s, 'approve'), s);
  s = act(s, 'checked');
  s = act(s, 'approve');
  assert.equal(s.phase, 'handed');
  assert.strictEqual(act(s, 'approve'), s);
  assert.equal(s.messages.filter(m => m.speaker === 'UX').length, 1);
});
test('rejection keeps successor blocked; old shared output and old approval cannot finish the revised task', () => {
  let s = act(review(), 'reject');
  assert.equal(s.phase, 'changes');
  assert.equal(s.version, 2);
  assert.equal(s.shared, 1);
  s = act(s, 'approve', 1);
  assert.equal(s.phase, 'changes');
  s = act(act(s, 'work'), 'finish');
  s = act(s, 'share', 1);
  assert.equal(s.phase, 'draft');
  s = act(act(s, 'share'), 'checked');
  s = act(s, 'approve', 1);
  assert.equal(s.phase, 'review');
  s = act(s, 'approve');
  assert.equal(s.shared, 2);
  assert.equal(s.phase, 'handed');
});
test('cancel/reset invalidate asynchronous callbacks even after restarting the same phase; reshare is idempotent', () => {
  for (const phase of ['working', 'checking']) {
    let s = act(initialHandoff(), 'work');
    if (phase === 'checking') s = act(act(s, 'finish'), 'share');
    const late: Action = { type: phase === 'working' ? 'finish' : 'checked', run: s.run, version: s.version };
    for (const interruption of ['cancel', 'reset'] as const) {
      let next = act(s, interruption);
      next = phase === 'working' || interruption === 'reset' ? act(next, 'work') : act(next, 'share');
      assert.strictEqual(reduce(next, late), next);
      if (phase === 'checking' && interruption === 'cancel') assert.equal(next.messages.filter(m => m.speaker === '나').length, 2);
    }
  }
});
