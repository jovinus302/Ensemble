import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { sceneEvents, SCENE_NOW } from '@ensemble/scenarios';
import { buildViewModel } from '../../../apps/web/lib/build-view-model.ts';
import { ProjectManager } from '../src/pm.ts';

it('builds actor-specific cards, evidence, attachment URLs and calculated roadmap from the ledger', async () => {
  const store = new MemoryLedgerStore(), context = { projectId: 'web', targetProductId: 'web' };
  const base = { ...context, actor: { kind: 'system' as const, id: 'pm' } };
  await store.append([
    ...sceneEvents(2, context),
    { ...base, type: 'plan_proposed', payload: { proposalId: 'p', version: 1, forMemberId: 'owner', tasks: [], estimates: [], reason: 'Review' } },
    { ...base, type: 'authority_requested', payload: { requestId: 'a', personId: 'designer', changeKinds: ['human_commitment'], text: 'Hours?' } },
    { ...base, type: 'attachment_recorded', payload: { attachmentId: 'file', name: 'flow.md', mimeType: 'text/markdown', uri: 'data:text/markdown;base64,YQ==' } },
    { ...base, type: 'message_recorded', payload: { messageId: 'm', authorId: 'designer', text: 'Draft', attachmentIds: ['file'] } },
    { ...base, type: 'pm_considered', payload: { considerationId: 'c', triggerId: 'm', whoseAction: 'owner', alreadyKnows: 'no', evidence: ['m'], decision: 'speak', reason: 'Approval needed', openTopics: [] } },
    { ...base, type: 'pm_spoke', payload: { considerationId: 'c', messageId: 'speech', text: 'Review', kind: 'ask' } },
  ]);
  const events = await store.read();
  const owner = buildViewModel(events, { me: 'owner', mode: 'scenario', busy: false, now: SCENE_NOW });
  const designer = buildViewModel(events, { me: 'designer', mode: 'scenario', busy: false, now: SCENE_NOW });
  expect(owner.cards.map(c => c.id)).toEqual(['p']);
  expect(designer.cards.map(c => c.id)).toEqual(['a']);
  expect(owner.roadmap.forecast?.ok).toBe(true);
  expect(owner.roadmap.tasks.find(t => t.id === 'prototype')?.startDay).toBeGreaterThan(0);
  expect(owner.messages.find(m => m.id === 'm')?.attachments[0]?.url).toBe('/api/attachments/file');
  expect(owner.messages.find(m => m.id === 'speech')?.pm).toMatchObject({ reason: 'Approval needed', evidence: ['m'] });
  await store.append([{ ...base, type: 'plan_decided', payload: { proposalId: 'p', memberId: 'owner', approved: false } }]);
  expect(buildViewModel(await store.read(), { me: 'owner', mode: 'free', busy: false }).cards).toHaveLength(0);
});

it('records uploaded binary bytes without a UTF-8 round trip', async () => {
  const store = new MemoryLedgerStore(), context = { projectId: 'binary', targetProductId: 'web' };
  await store.append(sceneEvents(2, context));
  const pm = new ProjectManager({ ...context, store, model: 'fake',
    connector: { async startSession() { return { threadId: 'fake', workspace: '/fake' }; }, async startTask() { return 'fake'; }, async sendUpdate() { return { sent: false, reason: 'fake' }; }, onEvent() { return () => {}; }, async stop() {} },
    llm: { async complete(request) {
      const input = request.forceTool === 'route_message' ? { kind: 'chat' } : request.forceTool === 'interpret_coordination' ? { category: 'chat', summary: '', ops: [], conflicts: [] } : { whoseAction: null, alreadyKnows: 'yes', evidence: [], decision: 'silent', reason: 'No action', openTopics: [], text: '' };
      return { text: '', model: 'fake', responseId: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
    } },
  });
  const bytes = Buffer.from([0, 255, 128, 1]);
  await pm.postMessage('owner', 'Binary attachment', [{ name: 'test.bin', mimeType: 'application/octet-stream', content: bytes.toString('utf8'), contentBase64: bytes.toString('base64') }]);
  const attachment = (await store.read()).find(e => e.type === 'attachment_recorded')!.payload as { uri: string };
  expect(Buffer.from(attachment.uri.split(',')[1]!, 'base64')).toEqual(bytes);
  await pm.stop();
});
