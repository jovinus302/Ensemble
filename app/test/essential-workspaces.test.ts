import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextReducer as reduce, initialContext, pendingWork, revision, codeExample, ERROR_COPY, companion, type Workspace } from '../demo/workspaces/context.ts';

function connectAll(order: Workspace[]) {
  return order.reduce((state, source) => reduce(state, { type: 'connect', source }), initialContext());
}

test('development and design connect independently in either order without claiming review completion', () => {
  for (const order of [['dev', 'design'], ['design', 'dev']] as Workspace[][]) {
    let state = reduce(initialContext(), { type: 'connect', source: order[0]! });
    assert.equal(state.connected[order[0]!], true);
    assert.equal(state.connected[order[1]!], false);
    assert.deepEqual(state.revised, { dev: false, design: false });
    state = reduce(state, { type: 'connect', source: order[1]! });
    assert.match(companion(state, 'dev'), /같은 목표/);
    assert.deepEqual(pendingWork(state), []);
    assert.equal(revision(state, 'design'), 1);
  }
});

test('a meeting decision can arrive first but cannot silently revise unshared work', () => {
  let state = reduce(initialContext(), { type: 'connect', source: 'meeting' });
  assert.deepEqual(pendingWork(state), ['dev', 'design']);
  assert.deepEqual(reduce(state, { type: 'revise', source: 'dev' }), state);
  state = reduce(state, { type: 'connect', source: 'dev' });
  assert.equal(revision(state, 'dev'), 1);
  state = reduce(state, { type: 'revise', source: 'dev' });
  assert.equal(revision(state, 'dev'), 2);
  assert.equal(revision(state, 'design'), 1);
  assert.deepEqual(pendingWork(state), ['design']);
  assert.match(companion(state, 'dev'), /다른 작업의 반영은 아직/);
});

test('decisions preserve source links, independent revisions and the outstanding joint review', () => {
  let state = connectAll(['design', 'slack', 'dev', 'meeting']);
  assert.deepEqual(pendingWork(state), ['dev', 'design']);
  state = reduce(state, { type: 'revise', source: 'design' });
  assert.deepEqual(pendingWork(state), ['dev']);
  state = reduce(state, { type: 'revise', source: 'dev' });
  assert.deepEqual(state.connected, { dev: true, design: true, slack: true, meeting: true });
  assert.deepEqual(pendingWork(state), []);
  assert.match(companion(state, 'dev'), /최종 검토 완료는 구분/);
  assert.match(codeExample(false), /resetForm/);
  assert.doesNotMatch(codeExample(true), /resetForm/);
  assert.ok(codeExample(true).includes(ERROR_COPY));
});

test('duplicate events are idempotent and reset removes earlier decisions and revisions', () => {
  let state = connectAll(['dev', 'design', 'meeting', 'slack']);
  state = reduce(state, { type: 'revise', source: 'dev' });
  assert.strictEqual(reduce(state, { type: 'revise', source: 'dev' }), state);
  assert.strictEqual(reduce(state, { type: 'connect', source: 'dev' }), state);
  const reset = reduce(state, { type: 'reset' });
  assert.deepEqual(reset, initialContext());
  assert.strictEqual(reduce(reset, { type: 'revise', source: 'dev' }), reset);
  const shared = reduce(reset, { type: 'connect', source: 'dev' });
  assert.strictEqual(reduce(shared, { type: 'revise', source: 'dev' }), shared);
});
