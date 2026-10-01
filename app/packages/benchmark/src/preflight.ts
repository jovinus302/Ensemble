import { project, type EventPayloads, type EventType } from '@ensemble/core';
import { MemoryLedgerStore } from '@ensemble/store';
import { interpretationTool } from '../../orchestrator/src/coordination.ts';
import { strictSchema } from '../../llm/src/cli.ts';
import { PROMPT_A } from './protocol.ts';

/** Targeted check for the concrete Codex rejection seen in pilot-01, not a general schema validator. */
export function untypedLiterals(schema: Record<string, unknown>, path = '$'): string[] {
  const failures: string[] = [];
  if (('const' in schema || 'enum' in schema) && !schema.type) failures.push(path);
  for (const [name, child] of Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>)) {
    failures.push(...untypedLiterals(child, `${path}.properties.${name}`));
  }
  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    failures.push(...untypedLiterals(schema.items as Record<string, unknown>, `${path}.items`));
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[keyword])) (schema[keyword] as Record<string, unknown>[]).forEach((child, i) => {
      failures.push(...untypedLiterals(child, `${path}.${keyword}[${i}]`));
    });
  }
  return failures;
}

export async function interpretationSchema() {
  // Match the pilot's populated PM state, avoiding meaningless empty ID enums.
  const store = new MemoryLedgerStore();
  const add = async <K extends EventType>(type: K, payload: EventPayloads[K]) => store.append([{
    projectId: 'schema-preflight', targetProductId: 'reservation', actor: { kind: 'human', id: 'owner' }, type, payload,
  }]);
  try {
    await add('member_joined', { memberId: 'owner', kind: 'human', displayName: 'Benchmark owner' });
    await add('member_joined', { memberId: 'prototype-agent', kind: 'agent', displayName: 'Prototype agent' });
    await add('goal_set', { text: PROMPT_A, decider: 'owner', delegation: { pmMayApply: ['scope_add', 'scope_reduce', 'goal_change'] } });
    await add('plan_committed', { version: 1, basedOn: null, tasks: [{ id: 'reservation', title: 'Reservation application',
      assignee: 'prototype-agent', dependsOn: [], handoffConditions: [PROMPT_A], exclusions: [], limits: [] }],
      reason: 'Preregistered single-task benchmark', approvedBy: 'owner', sourceMessageIds: [] });
    await add('message_recorded', { messageId: 'initial-brief', authorId: 'owner', text: PROMPT_A, attachmentIds: [] });
    return interpretationTool(project(await store.read())).inputSchema;
  } finally { store.close(); }
}

export async function inspectCodexSchema() {
  // No providers, processes, credentials or network: the actual production transformation.
  const original = await interpretationSchema();
  const schema = strictSchema(original);
  const paths = untypedLiterals(schema);
  return { modelCalls: 0, schemaReady: paths.length === 0, check: 'Codex structured-output explicit type for const/enum',
    scope: 'Targeted known-failure check; passing does not prove provider acceptance or complete preflight readiness',
    negativeControlPaths: untypedLiterals(original), paths };
}

export async function assertCodexSchemaReady(): Promise<void> {
  const result = await inspectCodexSchema();
  if (!result.schemaReady) throw new Error(`Codex schema preflight blocked before model calls: missing explicit type at ${result.paths.join(', ')}.`);
}
