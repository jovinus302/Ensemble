import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import type { LlmProvider } from '@ensemble/llm';
import { project, type AnyEvent } from '@ensemble/core';
import { WebRuntime } from '../../../apps/web/lib/runtime.ts';
import { GET, POST } from '../../../apps/web/app/api/[...path]/route.ts';
import { continuousScenario, conditionMet, resolveTarget } from '../src/index.ts';
import { setup } from './continuous-fixture.ts';

const globalRuntime = globalThis as typeof globalThis & { ensembleRuntime?: WebRuntime };
const post = (route: string, body: unknown = {}) => POST(new Request(`http://localhost/api/${route}`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ path: route.split('/') }) });
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('observable state did not arrive');
}
it('plays all three scenes through actual API handlers with ready human work, visible input and preserved history', async () => {
  const f = await setup(false);
  await f.pm.stop();
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-web-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore(), llm: f.llm, connector: f.connector, generateRevision: f.host.generateRevision });
  globalRuntime.ensembleRuntime = app;
  try {
    await app.state();
    expect((await post('scenario/start', { name: continuousScenario.key })).status).toBe(200);
    const originalId = app.meta.projectId;
    for (let i = 0; i < continuousScenario.steps.length; i++) {
      if (i === 4) {
        const events = await app.store.read({ projectId: originalId });
        const state = project(events);
        expect(['ready', 'reserved']).toContain([...state.tasks.values()].find(t => t.spec.assignee === 'owner')?.status);
        expect(conditionMet(continuousScenario.steps[i]!.waitFor!, events, app.meta.script!.anchors)).toBe(true);
        expect(resolveTarget(state, { assignee: 'owner' })).toBe('interview');
      }
      expect((await post('scenario/next')).status).toBe(202);
      await eventually(async () => app.meta.script!.step === i + 1 || !!app.meta.script!.stopped);
      expect(app.meta.script!.stopped).toBeUndefined();
      await app.pm.flush();
    }
    const state = await app.state();
    expect(state.scenario?.done).toBe(true);
    expect(state.project.title.length).toBeLessThanOrEqual(40);
    expect(state.project.title).not.toContain('시연용');
    expect(state.project.synthetic).toBe(true);
    expect(state.roadmap.planVersion).toBe(2);
    for (const step of continuousScenario.steps.filter(s => ['goal', 'availability', 'approvePlan'].includes(s.action ?? ''))) expect(state.messages.some(m => m.text === step.text)).toBe(true);
    const before = await app.store.read({ projectId: originalId });
    const conflict = await post('scenario/start', { name: continuousScenario.key });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'project_exists' } });
    expect(app.meta.projectId).toBe(originalId);
    expect((await post('scenario/start', { name: continuousScenario.key, confirmReplace: true })).status).toBe(200);
    expect(app.meta.archivedProjectIds).toContain(originalId);
    expect(await app.store.read({ projectId: originalId })).toEqual(before);
    expect((await app.state()).messages).toEqual([]);
    await post('scenario/next');
    await eventually(async () => app.meta.script!.step === 1);
    expect((await app.state()).messages.filter(m => m.authorId === 'owner')).toHaveLength(1);
  } finally { await app.pm.stop(); app.store.close(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); await rm(f.workspace, { recursive: true, force: true }); }
});

it('accepts two inputs while PM is blocked and processes them once in receipt order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-messages-'));
  let release!: () => void;
  const blocked = new Promise<void>(r => { release = r; });
  const seen: string[] = [];
  const llm: LlmProvider = { async complete(request) {
    const { facts } = JSON.parse(request.messages[0]!.content);
    if (request.forceTool === 'interpret_coordination') { await blocked; seen.push(facts.messageId); }
    const input = request.forceTool === 'interpret_coordination'
      ? { category: 'chat', summary: '일반 대화', ops: [], conflicts: [], conversation: { questionMessageId: null, waitingOnMemberIds: [], directedToPm: false }, factMentions: [] }
      : { whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: '다음 행동이 바뀌지 않음', openTopics: [], text: '', targetMemberIds: [], changesOpenQuestionAnswer: false, answerFactIds: [] };
    return { text: '', model: 'fake', responseId: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore(), llm });
  globalRuntime.ensembleRuntime = app;
  try {
    await app.state();
    const [first, second] = await Promise.all([post('messages', { authorId: 'owner', text: '첫 입력' }), post('messages', { authorId: 'designer', text: '다음 입력' })]);
    expect([first.status, second.status]).toEqual([202, 202]);
    const ids = [(await first.json() as { messageId: string }).messageId, (await second.json() as { messageId: string }).messageId];
    expect(seen).toEqual([]);
    expect((await app.store.read() as AnyEvent[]).filter(e => e.type === 'message_recorded').map(e => e.payload.messageId)).toEqual(ids);
    release(); await app.pm.flush();
    expect(seen).toEqual(ids);
    await app.pm.processRecordedMessage(ids[0]!);
    expect(seen).toEqual(ids);
    expect((await app.store.read() as AnyEvent[]).filter(e => e.type === 'pm_considered').map(e => e.payload.triggerId)).toEqual(ids);
    expect((await app.state()).messages.filter(m => m.kind === 'human').map(m => m.text)).toEqual(['첫 입력', '다음 입력']);
  } finally { release(); await app.pm.stop(); app.store.close(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); }
});

it('exposes a quiet condition stall at 60 seconds and supports retry then skip without inventing a result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-stall-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore() });
  globalRuntime.ensembleRuntime = app;
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await app.state();
    await post('scenario/start', { name: continuousScenario.key });
    app.meta.script!.step = 4;
    const start = Date.now();
    clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await post('scenario/next');
    await eventually(async () => (await app.state()).activity.kind === 'scenario_waiting');
    clock.mockReturnValue(start + 59_999);
    expect((await app.state()).activity.stalled).toBeUndefined();
    clock.mockReturnValue(start + 60_001);
    expect((await app.state()).activity.stalled).toMatchObject({ canRetry: true, canSkip: true });
    expect((await post('scenario/retry')).status).toBe(200);
    await eventually(async () => (await app.state()).activity.kind === 'scenario_waiting');
    expect((await app.state()).activity.stalled).toBeUndefined();
    clock.mockReturnValue(start + 120_002);
    const skips = await Promise.all([post('scenario/skip'), post('scenario/skip')]);
    expect(skips.map(r => r.status).sort()).toEqual([200, 409]);
    expect(app.meta.script!.step).toBe(5);
    expect(app.meta.script!.stopped).toBeUndefined();
    expect((await app.store.read()).some(e => e.type === 'result_submitted')).toBe(false);
  } finally { clock?.mockRestore(); await app.pm.stop(); app.store.close(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); }
});

it('serves text inline, HTML as download, and structured Korean errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ensemble-download-'));
  const app = new WebRuntime({ dataDir: dir, store: new MemoryLedgerStore() });
  globalRuntime.ensembleRuntime = app;
  try {
    await app.state();
    for (const name of ['notes.txt', 'notes.md', 'unsafe.html']) {
      await app.store.append([{ projectId: app.meta.projectId, targetProductId: 'test', actor: { kind: 'human', id: 'owner' }, type: 'attachment_recorded', payload: { attachmentId: name.replace('.', '-'), name, mimeType: 'text/html', uri: `data:text/html;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}` } }]);
      const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ path: ['attachments', name.replace('.', '-')] }) });
      expect(response.headers.get('Content-Type')).toBe(name.endsWith('html') ? 'application/octet-stream' : 'text/plain; charset=utf-8');
      expect(response.headers.get('Content-Disposition')).toMatch(name.endsWith('html') ? /^attachment;/ : /^inline;/);
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
    const bad = await post('messages', { authorId: 'owner', text: '' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: 'invalid_input', message: '메시지나 첨부를 입력해 주세요.' } });
  } finally { await app.pm.stop(); app.store.close(); delete globalRuntime.ensembleRuntime; await rm(dir, { recursive: true, force: true }); }
});
