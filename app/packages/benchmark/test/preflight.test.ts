import { expect, it } from 'vitest';
import { assertCodexSchemaReady, inspectCodexSchema, interpretationSchema, untypedLiterals } from '../src/preflight.ts';

it('negative control reproduces the original untyped production schema without model calls', async () => {
  const original = await interpretationSchema();
  const paths = untypedLiterals(original);
  expect(paths).toContain('$.properties.ops.items.oneOf[0].properties.type');
  expect(paths.some(path => path.endsWith('.properties.period'))).toBe(true);
});

it('positive control accepts the actual PM schema after the strict-output repair without model calls', async () => {
  const result = await inspectCodexSchema();
  expect(result.modelCalls).toBe(0);
  expect(result.schemaReady).toBe(true);
  expect(result.paths).toEqual([]);
  await expect(assertCodexSchemaReady()).resolves.toBeUndefined();
});

it('checks schema branches, not literal payloads, and accepts explicit types', () => {
  expect(untypedLiterals({ type: 'object', properties: { typed: { type: 'string', enum: ['a'] },
    literal: { type: 'object', const: { enum: ['payload'] } }, union: { anyOf: [{ const: 'x' }, { type: 'null' }] } } }))
    .toEqual(['$.properties.union.anyOf[0]']);
});
