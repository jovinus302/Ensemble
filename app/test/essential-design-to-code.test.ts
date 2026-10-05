import assert from 'node:assert/strict';
import test from 'node:test';
import { handoffReducer as reduce, initialHandoff, type State, type Action, type Choice } from '../demo/scripted/design-to-code/design-to-code.ts';
const event = (s: State, type: Action['type'], extra: Partial<Action> = {}): Action => ({ type, phase: s.phase, run: s.run, version: s.version, ...extra });
const act = (s: State, type: Action['type'], extra: Partial<Action> = {}) => reduce(s, event(s, type, extra));
const ready = (choice: Choice = 'resend') => act(act(act(initialHandoff(), 'propose', { choice }), 'agree-ux'), 'agree-dev');
const draft = (s: State) => act(act(s, 'start'), 'finish');
const codeReady = (s = ready()) => act(draft(s), 'share');
const checked = (s = codeReady(), focus = true) => act(act(act(act(draft(s), 'focus', { focus }), 'share'), 'start'), 'finish');

test('both humans agree before work; objection and added constraint revoke pending consent; choices propagate to artifacts', () => {
  for (const choice of ['login', 'resend'] as const) {
    let s = act(initialHandoff(), 'propose', { choice });
    assert.equal(act(s, 'start'), s); assert.equal(s.agreed, false);
    const staleAgree = event(s, 'agree-ux');
    s = act(s, 'privacy'); assert.strictEqual(reduce(s, staleAgree), s);
    s = act(s, 'agree-ux'); assert.equal(s.agreed, false);
    s = act(s, 'agree-dev'); assert.equal(s.agreed, true);
    const privateDraft = draft(s); assert.equal(privateDraft.shared, null);
    s = act(privateDraft, 'share');
    assert.equal(s.design?.choice, choice); assert.equal(s.design?.privacy, true);
  }
  let s = act(ready(), 'back'); s = act(s, 'object');
  assert.equal(s.phase, 'discussion'); assert.equal(s.agreed, false); assert.equal(s.shared, null);
});
test('UX share unlocks implementation; QA failure requests scoped repair and final human approval gates handoff', () => {
  let s = codeReady(); const design = s.design;
  s = checked(s, false); assert.equal(s.phase, 'changes'); assert.equal(s.evidence?.passed, false);
  assert.strictEqual(act(s, 'approve'), s);
  s = act(s, 'revise'); assert.equal(s.version, 2); assert.strictEqual(s.design, design);
  s = checked(s); assert.equal(s.phase, 'review'); assert.equal(s.shared?.focus, true);
  assert.equal(s.entries.some(e => e.kind === 'handoff'), false);
  s = act(s, 'approve'); assert.equal(s.phase, 'handed');
  assert.equal(s.entries.filter(e => e.kind === 'handoff').length, 1);
  for (const e of s.entries) for (const id of e.refs ?? []) assert.ok(s.entries.some(x => x.id === id && x.id < e.id));
});
test('human revision changes only requested copy; stale versions and duplicate share/approval never advance', () => {
  let s = draft(codeReady()); const share = event(s, 'share');
  s = reduce(s, share); assert.strictEqual(reduce(s, share), s);
  s = checked(codeReady()); s = act(s, 'reject'); assert.equal(s.version, 2);
  assert.equal(s.refined, true); assert.equal(s.shared?.refined, false);
  s = act(s, 'approve', { version: 1 }); assert.equal(s.phase, 'code-ready');
  s = draft(s); s = act(s, 'share', { version: 1 }); assert.equal(s.phase, 'code-draft');
  s = act(s, 'share'); s = act(act(s, 'start'), 'finish');
  assert.equal(s.shared?.refined, true); assert.equal(s.shared?.choice, 'resend');
  const approve = event(s, 'approve'); s = reduce(s, approve); assert.strictEqual(reduce(s, approve), s);
});
test('cancel/reset/history invalidate every pending callback; history restores coherent evidence and stops runs', () => {
  const seeds = [ready(), codeReady(), act(draft(codeReady()), 'share')];
  for (const seed of seeds) {
    const running = act(seed, 'start'), late = event(running, 'finish');
    for (const type of ['cancel', 'reset', 'back'] as const) {
      const stopped = act(running, type); assert.strictEqual(reduce(stopped, late), stopped);
      assert.equal(stopped.phase.endsWith('-running'), false);
      const restarted = act(stopped, 'start'); assert.strictEqual(reduce(restarted, late), restarted);
    }
  }
  let s = checked(); const accepted = act(s, 'approve');
  s = act(accepted, 'back'); assert.equal(s.phase, 'review');
  s = act(s, 'forward'); assert.equal(s.phase, 'handed'); assert.deepEqual(s.shared, accepted.shared);
});
