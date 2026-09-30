import { expect, it } from 'vitest';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, type AnyEvent, type TaskSpec } from '@ensemble/core';
import { ProjectManager } from '@ensemble/orchestrator';
import type { SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import type { LlmProvider } from '@ensemble/llm';
import { advanceScript, continuousScenario, sceneEvents, SCENE_NOW, type ScriptProgress } from '../src/index.ts';

class Connector implements SessionConnector {
  handlers = new Set<(event: SessionEvent) => void>();
  starts: TaskInstructionsInput[] = [];
  updates: UpdateInstructionsInput[] = [];
  async startSession(id: string) { return { threadId: id, workspace: '/fake' }; }
  async startTask(_id: string, input: TaskInstructionsInput) { this.starts.push(input); return `turn:${input.taskId}`; }
  async sendUpdate(agentId: string, input: UpdateInstructionsInput) {
    this.updates.push(input);
    setTimeout(() => {
      const event: SessionEvent = { type: 'report', agentId, taskId: this.starts[0]!.taskId, threadId: agentId, turnId: `turn:${this.starts[0]!.taskId}`, itemId: 'ack', index: 0,
        report: { type: 'acknowledge_update', updateId: input.updateId, planVersion: input.toVersion, applied: input.change, dropped: input.drop } };
      for (const handler of this.handlers) handler(event);
    }, 0);
    return { sent: true as const };
  }
  onEvent(handler: (event: SessionEvent) => void) { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  async stop() {}
}
async function setup(reverse: boolean, missing?: string) {
  const ctx = { projectId: 'continuous', targetProductId: 'test' }, store = new MemoryLedgerStore();
  await store.append(sceneEvents(1, ctx).filter(e => !['plan_committed', 'estimate_updated', 'availability_updated'].includes(e.type)));
  const ids = reverse ? ['task-3', 'task-1', 'task-2'] : ['task-1', 'task-2', 'task-3'];
  const tasks: TaskSpec[] = [
    { id: ids[0]!, title: '인터뷰', assignee: 'owner', dependsOn: [], handoffConditions: ['고객 인터뷰 결과'] },
    { id: ids[1]!, title: '흐름 초안', assignee: missing === 'designer' ? 'owner' : 'designer', dependsOn: [ids[0]!], handoffConditions: ['가입 흐름', '오류 흐름'] },
    { id: ids[2]!, title: '프로토타입', assignee: missing === 'prototype-agent' ? 'owner' : 'prototype-agent', dependsOn: [ids[1]!], handoffConditions: ['가입', '결제'] },
  ];
  // Agent roles are required by the real plan validator.
  await store.append([{ ...ctx, actor: { kind: 'system', id: 'test' }, type: 'member_joined', payload: { memberId: 'prototype-agent', kind: 'agent', displayName: 'Builder', role: 'build' } }]);
  let stage = 0;
  const llm: LlmProvider = { async complete(request) {
    let input: Record<string, unknown>;
    if (request.forceTool === 'outline_plan') input = { tasks: tasks.map(t => t.title) };
    else if (request.forceTool === 'propose_plan') input = { reason: 'Interview then design then prototype', tasks: tasks.map(t => ({ ...t, role: t.assignee === 'prototype-agent' ? 'build' : 'human', hours: { min: 2, max: 4 } })) };
    else if (request.forceTool === 'record_handoff_review') {
      const content = request.messages[0]!.content, file = /### 파일: ([^\n]+)/.exec(content)![1]!;
      const interview = content.includes('고객 인터뷰 결과');
      const complete = content.includes('오류 흐름: 오류 안내');
      input = { conditions: interview ? [{ index: 1, met: true, file, quote: '고객 인터뷰 결과' }] : [{ index: 1, met: true, file, quote: '가입 흐름' }, complete ? { index: 2, met: true, file, quote: '오류 흐름' } : { index: 2, met: false, missing: '오류 흐름 필요' }], decisionConflicts: [] };
    } else if (request.forceTool === 'interpret_coordination') {
      const { facts } = JSON.parse(request.messages[0]!.content);
      input = { conversation: { questionMessageId: stage === 0 || stage === 1 ? facts.messageId : null, waitingOnMemberIds: stage === 0 ? ['owner'] : [], directedToPm: stage === 1 }, factMentions: [], category: stage === 1 ? 'question' : 'scope', summary: '결제 제외', conflicts: [], ops: stage === 0 ? [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: [facts.messageId] }] : stage === 3 ? [{ type: 'exclude_scope', taskId: ids[2], item: '결제', sourceMessageIds: [facts.messageId] }] : [] };
    } else if (request.forceTool === 'judge_coordination') {
      const { facts } = JSON.parse(request.messages[0]!.content);
      input = { targetMemberIds: ['owner'], changesOpenQuestionAnswer: false, answerFactIds: stage === 1 ? ['forecast:current'] : [], whoseAction: stage === 0 || stage === 2 ? null : '담당자', alreadyKnows: 'no', evidence: stage === 1 ? ['forecast:current'] : [`msg:${facts.messageId}`], decision: stage === 0 || stage === 2 ? 'silent' : 'speak', reason: 'test judgement', openTopics: [], text: stage === 1 ? '현재 예측을 확인했습니다.' : '결제 제외를 반영했습니다.' };
      stage++;
    } else throw new Error(`Unexpected fake LLM call: ${request.forceTool}`);
    return { text: '', model: 'fake', responseId: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  const connector = new Connector();
  const pm = new ProjectManager({ ...ctx, store, connector, llm, model: 'fake', clock: () => SCENE_NOW });
  const stops: string[] = [], progress: ScriptProgress = { step: 0, anchors: {} };
  const host = { pm, read: () => store.read(), recordStop: async (reason: string) => { stops.push(reason); } };
  return { store, pm, connector, progress, host, stops, ids };
}
it.each([false, true])('runs scenes 1–3 on the drafted plan with alternate ID mapping %s', async reverse => {
  const f = await setup(reverse);
  try {
    const steps = continuousScenario.steps.map(s => ({ ...s, ...(s.waitFor ? { waitFor: { ...s.waitFor, timeoutMs: 1000 } } : {}) }));
    while (f.progress.step < steps.length) {
      if (reverse && f.progress.step === 3) {
        const proposal = [...project(await f.store.read()).pendingPlans.values()][0]!;
        await f.pm.decidePlan(proposal.proposalId, 'owner', true);
      }
      await advanceScript(f.host, steps, f.progress, { ...continuousScenario.completion, timeoutMs: 1000 });
    }
    await f.pm.flush();
    const events = await f.store.read() as AnyEvent[], state = project(events);
    expect(f.stops).toEqual([]);
    expect(state.plan?.version).toBe(2);
    expect(state.plan?.tasks.map(t => t.id)).toEqual(f.ids);
    expect(state.availability.get('owner')).toBe(10);
    expect(state.availability.get('designer')).toBe(5);
    expect(f.connector.starts.map(t => t.taskId)).toEqual([f.ids[2]]);
    expect(f.connector.updates).toHaveLength(1);
    expect(events.filter(e => e.type === 'result_submitted').map(e => e.payload.taskId)).toEqual([f.ids[0], f.ids[1], f.ids[1]]);
    expect(events.filter(e => e.type === 'plan_committed')).toHaveLength(2);
    expect(events.filter(e => e.type === 'revision_requested')).toHaveLength(1);
    expect(events.some(e => e.type === 'update_acknowledged')).toBe(true);
  } finally { await f.pm.stop(); }
});
it.each(['designer', 'prototype-agent'])('stops with evidence when drafted plan lacks %s', async missing => {
  const f = await setup(false, missing);
  try {
    for (let i = 0; i < 3; i++) await advanceScript(f.host, continuousScenario.steps, f.progress);
    await expect(advanceScript(f.host, continuousScenario.steps, f.progress)).rejects.toThrow(`lacks required tasks for ${missing}`);
    expect(f.stops).toHaveLength(1);
    expect(project(await f.store.read()).plan).toBeUndefined();
    expect(f.connector.starts).toEqual([]);
  } finally { await f.pm.stop(); }
});



