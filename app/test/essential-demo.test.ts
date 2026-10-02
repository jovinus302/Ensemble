import assert from 'node:assert/strict';
import test from 'node:test';
import { AGREE, CHANGE, DISCUSS, demoReducer as reduce, initialDemo, type DemoState } from '../apps/web/lib/fixed-demo.ts';

// Scripted presentation contracts only: these do not exercise real PM execution,
// rendered artifacts, providers, or external integrations.
const send = (state: DemoState, text: string) => reduce(state, { type: 'send', phase: state.phase, text });
const finish = (state: DemoState) => ({ type: 'finish' as const, phase: state.phase, run: state.run });

test('scripted demo waits for both human gates and rejects duplicate/stale input', () => {
  let state = reduce(initialDemo(), { type: 'start' });
  state = send(state, ' ');
  state = send(state, 'I disagree; keep discussing.');
  const count = state.messages.length;
  state = send(state, 'I disagree; keep discussing.');
  assert.equal(state.messages.length, count, 'duplicate opinion must not append another exchange');
  assert.equal(state.phase, 'discussion');
  assert.equal(state.revision, 0);
  assert.strictEqual(reduce(state, finish(state)), state, 'timer cannot answer a human gate');

  state = send(state, AGREE); // A premature future response must not poison its eventual gate.
  assert.equal(state.phase, 'discussion');
  state = send(state, DISCUSS);
  assert.equal(state.phase, 'agreement');
  assert.equal(state.revision, 0, 'proposal alone must not deliver an artifact');
  assert.strictEqual(reduce(state, { type: 'send', phase: 'discussion', text: DISCUSS }), state);
  assert.strictEqual(reduce(state, finish(state)), state);
  state = send(state, AGREE);
  assert.equal(state.phase, 'executing', 'human confirmation resumes scripted work without another command');
  assert.strictEqual(reduce(state, { type: 'send', phase: 'agreement', text: AGREE }), state);
});

test('scripted handoff preserves scoped revision narration and invalidates interrupted callbacks', () => {
  let state = reduce(initialDemo(), { type: 'start' });
  state = send(state, CHANGE); // Early change text must remain usable after first delivery.
  state = send(send(state, DISCUSS), AGREE);
  const oldFinish = finish(state);
  const reset = reduce(state, { type: 'reset' });
  assert.equal(reset.phase, 'intro');
  assert.equal(reset.revision, 0);
  assert.strictEqual(reduce(reset, oldFinish), reset);
  state = reduce(state, { type: 'back' });
  assert.equal(state.phase, 'agreement');
  state = send(state, AGREE);
  assert.strictEqual(reduce(state, oldFinish), state, 'old completion cannot finish a replayed execution');
  const beforeDelivery = state.messages.length;
  state = reduce(state, finish(state));
  assert.equal(state.phase, 'delivered');
  assert.equal(state.revision, 1);
  assert.deepEqual(state.messages.slice(beforeDelivery, beforeDelivery + 3).map(m => m.speaker), ['Story', 'UI', 'PM']);
  state = send(state, 'Revise everything.');
  assert.equal(state.phase, 'delivered', 'unrecognized scope cannot silently launch the fixed revision');
  state = send(state, CHANGE);
  assert.equal(state.phase, 'revising');
  assert.equal(state.revision, 1, 'first artifact stays current while scripted revision is pending');
  const scope = state.messages.at(-1)!;
  assert.equal(scope.speaker, 'PM');
  assert.match(scope.text, /Story.*노래 템플릿만/);
  assert.match(scope.text, /UI.*안내·선택 영역만/);
  assert.match(scope.text, /D1과 나머지 포맷은 유지/);
  state = reduce(state, finish(state));
  assert.equal(state.phase, 'complete');
  assert.equal(state.revision, 2);
  assert.deepEqual(state.messages.slice(-3).map(m => m.speaker), ['Story', 'UI', 'PM']);
  assert.match(state.messages.at(-1)!.text, /fiction 안내 있음.*노래 없음.*가명화·3단계 유지/);
  assert.strictEqual(reduce(state, finish(state)), state, 'duplicate completion is inert');
});
