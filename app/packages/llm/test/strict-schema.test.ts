import { expect, it } from 'vitest';
import Ajv from 'ajv';
import { project } from '@ensemble/core';
import { interpretationTool } from '../../orchestrator/src/coordination.ts';
import { dropStrictNulls, strictSchema } from '../src/cli.ts';

function untypedLiterals(schema: any, path = '$'): string[] {
  const missing = ('const' in schema || 'enum' in schema) && !schema.type ? [path] : [];
  for (const [key, value] of Object.entries(schema.properties ?? {})) missing.push(...untypedLiterals(value, `${path}.properties.${key}`));
  if (schema.items) missing.push(...untypedLiterals(schema.items, `${path}.items`));
  for (const key of ['oneOf', 'anyOf']) (schema[key] ?? []).forEach((child: any, i: number) => missing.push(...untypedLiterals(child, `${path}.${key}[${i}]`)));
  return missing;
}
it('reproduces the real PM discriminator rejection and types every literal in its transformed schema', () => {
  const state = project([]);
  state.members.set('owner', { memberId: 'owner', kind: 'human', displayName: 'Owner' });
  state.members.set('prototype-agent', { memberId: 'prototype-agent', kind: 'agent', displayName: 'Developer' });
  state.plan = { version: 1, reason: 'test', approvedBy: 'owner', tasks: [{ id: 'reservation', title: 'Booking', assignee: 'prototype-agent', dependsOn: [], handoffConditions: ['Implement booking'] }] };
  state.messages.push({ messageId: 'request', authorId: 'owner', text: 'Implement booking', seq: 1 });
  const original = interpretationTool(state).inputSchema;
  expect(untypedLiterals(original)).toContain('$.properties.ops.items.oneOf[0].properties.type');
  const transformed = strictSchema(original) as any;
  expect(untypedLiterals(transformed)).toEqual([]);
  const operations = transformed.properties.ops.items.anyOf;
  expect(operations[0].properties.type).toEqual({ const: 'set_availability', type: 'string' });
  expect(operations[0].properties.period.type).toBe('string');
  expect(operations.find((op: any) => op.properties.type.const === 'resolve_task').properties.action.type).toBe('string');
  const create = operations.find((op: any) => op.properties.type.const === 'create_task');
  expect(create.properties.priority.type).toBe('string');
  expect(create.properties.routing.properties.executor.type).toBe('string');
  expect(create.properties.routing.properties.reason.type).toBe('string');
  expect(() => new Ajv({ strict: false }).compile(transformed)).not.toThrow();
});

it('preserves exact mixed primitive enum members and explicit declared types', () => {
  const values = ['one', 1, 1.5, true, null];
  const schema = strictSchema({ enum: values });
  expect(schema).toEqual({ enum: values, type: ['string', 'number', 'boolean', 'null'] });
  const validate = new Ajv({ strict: false }).compile(schema);
  for (const value of values) expect(validate(value)).toBe(true);
  for (const value of ['1', 2, false, {}, []]) expect(validate(value)).toBe(false);
  expect(strictSchema({ type: 'integer', enum: [1, 2] })).toEqual({ type: 'integer', enum: [1, 2] });
});

it('makes optional const and mixed enums nullable while retaining required literal nulls', () => {
  const original = { type: 'object', required: ['requiredNull'], properties: {
    optionalConst: { const: 'fixed' }, optionalMixed: { enum: ['one', 1] }, requiredNull: { const: null },
  } };
  const schema = strictSchema(original) as any;
  expect(schema.properties.optionalConst).toEqual({ anyOf: [{ const: 'fixed', type: 'string' }, { type: 'null' }] });
  expect(schema.properties.optionalMixed).toEqual({ anyOf: [{ enum: ['one', 1], type: ['string', 'number'] }, { type: 'null' }] });
  const value = { optionalConst: null, optionalMixed: null, requiredNull: null };
  expect(new Ajv({ strict: false }).compile(schema)(value)).toBe(true);
  expect(dropStrictNulls(value, original)).toEqual({ requiredNull: null });
  expect(dropStrictNulls({ field: null }, { type: 'object', required: ['field'], properties: { field: { type: ['string', 'null'], enum: ['one'] } } })).toEqual({});
});

it.each([{}, [], undefined, Number.NaN, Number.POSITIVE_INFINITY])('rejects unsupported literal %j without inventing a schema', value => {
  expect(() => strictSchema({ const: value })).toThrow('finite JSON primitives');
  expect(() => strictSchema({ enum: [value] })).toThrow('finite JSON primitives');
});
it.each([{ enum: [] }, { type: 'string', enum: [] }, { enum: 'one' }])('rejects malformed or empty enum %j before CLI invocation', schema => {
  expect(() => strictSchema(schema)).toThrow('enum must be a non-empty array');
});
