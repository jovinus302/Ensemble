import { describe, expect, it } from 'vitest';
import { project, workContextFacts, WORK_CONTEXT_TOOL, type LedgerEvent } from '@ensemble/core';
import { pagesV25Ledger } from '@ensemble/scenarios';
import { workContextTool, workContextUserMessage } from '../src/index.ts';

describe('update_work_context (foundation)', () => {
  it('names the shared tool and carries the facts of a Pages checkpoint as JSON', () => {
    expect(workContextTool().name).toBe(WORK_CONTEXT_TOOL);
    const golden = pagesV25Ledger({ projectId: 'p', targetProductId: 'p' });
    const events = golden.events.slice(0, golden.checkpoints.s04_aligned).map((e, i): LedgerEvent => ({ ...e, id: `e${i}`, seq: i + 1, at: e.at ?? '' }));
    const facts = workContextFacts(project(events), { kind: 'message', messageId: 'pv25:m:6' })!;
    const body = JSON.parse(workContextUserMessage(facts)) as { facts: typeof facts };
    expect(body.facts.branches.map(b => b.itemId)).toEqual(['d2-fiction']);
    expect(body.facts.pool.candidates).toHaveLength(4);
    expect(body.facts.tools.map(t => t.toolId)).toEqual(['figma', 'prompt-studio', 'dev-tools']);
  });
});
