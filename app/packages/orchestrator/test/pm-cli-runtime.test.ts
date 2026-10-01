import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCliProvider, CodexCliProvider } from '@ensemble/llm';
import { proposePlan, PlanDraftingError } from '../src/planning.ts';

// The PM's own validation and retry path, unchanged, behind the CLI runtimes (fake CLIs, no real calls).
const fixture = (name: string) => fileURLToPath(new URL(`../../llm/test/fixtures/${name}`, import.meta.url));
const members = [
  { memberId: 'owner', kind: 'human' as const, displayName: 'Owner', weeklyHours: 10 },
  { memberId: 'designer', kind: 'human' as const, displayName: 'Designer' },
  { memberId: 'research-agent', kind: 'agent' as const, displayName: 'Research', role: 'research' },
  { memberId: 'prototype-agent', kind: 'agent' as const, displayName: 'Builder', role: 'build' },
];
const draft = { tasks: ['research', 'interview', 'flow', 'prototype'].map(templateKey => ({
  templateKey, title: `${templateKey} 작업`, handoffConditions: ['구체적인 산출물'], hours: { min: 2, max: 4 } })) };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function provider(kind: 'codex' | 'claude', modes: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ensemble-pm-plan-'));
  dirs.push(dir);
  const record = join(dir, 'record.jsonl');
  const env = { ...process.env, FAKE_CLI_MODES: modes, FAKE_CLI_STATE: join(dir, 'state'), FAKE_CLI_RECORD: record, FAKE_CLI_OUTPUTS: JSON.stringify([draft]) };
  const options = { executable: process.execPath, executableArgs: [fixture(kind === 'codex' ? 'fake-codex-exec.mjs' : 'fake-claude-print.mjs')], env, cwd: dir, timeoutMs: 10_000 };
  return { llm: kind === 'codex' ? new CodexCliProvider(options) : new ClaudeCliProvider(options), calls: () => readFileSync(record, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { input: string }) };
}

describe.each(['codex', 'claude'] as const)('PM planning on the %s CLI runtime', kind => {
  it('drafts the plan from structured output', async () => {
    const f = provider(kind, 'normal');
    const plan = await proposePlan({ goal: '예약 서비스', members, decider: 'owner', llm: f.llm, model: 'pm' });
    expect(plan.tasks.map(t => t.title)).toEqual(draft.tasks.map(t => t.title));
  });

  it('retries invalid output through the existing validation path', async () => {
    const f = provider(kind, 'invalid,normal');
    const plan = await proposePlan({ goal: '예약 서비스', members, decider: 'owner', llm: f.llm, model: 'pm' });
    expect(plan.tasks).toHaveLength(4);
    expect(f.calls()).toHaveLength(2);
  });

  it('reports a failing CLI as a drafting failure', async () => {
    const f = provider(kind, 'fail');
    await expect(proposePlan({ goal: '예약 서비스', members, decider: 'owner', llm: f.llm, model: 'pm' })).rejects.toBeInstanceOf(PlanDraftingError);
    expect(f.calls()).toHaveLength(2);
  });
});
