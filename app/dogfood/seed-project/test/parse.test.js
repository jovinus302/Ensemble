import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDecisions } from '../src/parse.js';

test('빈 입력은 빈 배열을 돌려준다', () => {
  assert.deepEqual(parseDecisions(''), []);
});
