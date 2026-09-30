import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryLedgerStore } from '@ensemble/store';
import { project, type AnyEvent, type TaskSpec } from '@ensemble/core';
import { ProjectManager } from '@ensemble/orchestrator';
import type { SessionConnector, SessionEvent, TaskInstructionsInput, UpdateInstructionsInput } from '@ensemble/agents';
import type { LlmProvider } from '@ensemble/llm';
import { advanceScript, continuousScenario, sceneEvents, SCENE_NOW, type ScriptProgress, type RevisionInput } from '../src/index.ts';

export class Connector implements SessionConnector {
  constructor(readonly workspace: string) {}
  handlers = new Set<(event: SessionEvent) => void>();
  starts: TaskInstructionsInput[] = [];
  updates: UpdateInstructionsInput[] = [];
  async startSession(id: string) { return { threadId: id, workspace: this.workspace }; }
  async startTask(agentId: string, input: TaskInstructionsInput) {
    this.starts.push(input);
    if (agentId === 'research-agent') setTimeout(() => {
      for (const handler of this.handlers) handler({ type: 'report', agentId, taskId: input.taskId, threadId: agentId,
        turnId: `turn:${input.taskId}`, itemId: 'research', index: 0,
        report: { type: 'result_report', taskId: input.taskId, planVersion: 1, summary: '조사 완료', files: [{ path: 'research.md', description: '조사 결과' }] } });
    }, 0);
    return `turn:${input.taskId}`;
  }
  async sendUpdate(agentId: string, input: UpdateInstructionsInput) {
    this.updates.push(input);
    setTimeout(() => {
      const event: SessionEvent = { type: 'report', agentId, taskId: this.starts.find(t => t.taskId === 'prototype')!.taskId, threadId: agentId, turnId: `turn:${this.starts.find(t => t.taskId === 'prototype')!.taskId}`, itemId: 'ack', index: 0,
        report: { type: 'acknowledge_update', updateId: input.updateId, planVersion: input.toVersion, applied: input.change, dropped: input.drop } };
      for (const handler of this.handlers) handler(event);
    }, 0);
    return { sent: true as const };
  }
  onEvent(handler: (event: SessionEvent) => void) { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  async stop() {}
}
export async function setup(reverse: boolean, missing?: string, rejectForever = false) {
  const ctx = { projectId: 'continuous', targetProductId: 'test' }, store = new MemoryLedgerStore();
  await store.append(sceneEvents(1, ctx).filter(e => !['plan_committed', 'estimate_updated', 'availability_updated'].includes(e.type) && !(e.type === 'member_joined' && (e.payload as { memberId: string }).memberId === missing)));
  const ids = ['research', 'interview', 'flow', 'prototype'];
  const tasks: TaskSpec[] = [
    { id: 'research', title: '조사', assignee: 'research-agent', dependsOn: [], handoffConditions: ['조사 결과'] },
    { id: 'interview', title: '인터뷰', assignee: 'owner', dependsOn: [], handoffConditions: [reverse ? '개인별 가격 수용 이유' : '개인별 예약 빈도'] },
    { id: 'flow', title: '흐름 초안', assignee: 'designer', dependsOn: ['research', 'interview'], handoffConditions: ['가입 흐름', '오류 흐름'] },
    { id: 'prototype', title: '프로토타입', assignee: 'prototype-agent', dependsOn: ['flow'], handoffConditions: ['가입', '결제'] },
  ];
  for (const id of ['research-agent', 'prototype-agent'].filter(id => id !== missing)) await store.append([{ ...ctx, actor: { kind: 'system', id: 'test' }, type: 'member_joined', payload: { memberId: id, kind: 'agent', displayName: id, role: id } }]);
  let stage = 0;
  const llm: LlmProvider = { async complete(request) {
    let input: Record<string, unknown>;
    if (request.forceTool === 'propose_plan') { stage = 0; input = { tasks: (reverse ? [...tasks].reverse() : tasks).map(t => ({ templateKey: t.id, title: t.title, handoffConditions: t.handoffConditions, hours: { min: 2, max: 4 } })) }; }
    else if (request.forceTool === 'record_handoff_review') {
      const content = request.messages[0]!.content, file = /### 파일: ([^\n]+)/.exec(content)![1]!;
      const interview = content.startsWith('taskId: interview ');
      const complete = content.includes('오류 흐름: 오류 안내');
      const wanted = tasks[1]!.handoffConditions[0]!;
      input = { conditions: content.startsWith('taskId: research ') ? [{ index: 1, met: true, file, quote: '조사 보고서' }] : interview ? [{ index: 1, met: !rejectForever && content.includes(`보완 내용: ${wanted}`), file, quote: `보완 내용: ${wanted}`, missing: `${wanted} 필요` }] : [{ index: 1, met: true, file, quote: '가입 흐름' }, complete ? { index: 2, met: true, file, quote: '오류 흐름' } : { index: 2, met: false, missing: '오류 흐름 필요' }], decisionConflicts: [] };
    } else if (request.forceTool === 'interpret_coordination') {
      const { facts } = JSON.parse(request.messages[0]!.content);
      input = { conversation: { questionMessageId: stage === 0 || stage === 1 ? facts.messageId : null, waitingOnMemberIds: stage === 0 ? ['owner'] : [], directedToPm: stage === 1 }, factMentions: [], category: stage === 1 ? 'question' : 'scope', summary: '결제 제외', conflicts: [], ops: stage === 0 ? [{ type: 'set_availability', memberId: 'designer', weeklyHours: 5, sourceMessageIds: [facts.messageId] }] : stage === 3 ? [{ type: 'exclude_scope', taskId: 'prototype', item: '결제', sourceMessageIds: [facts.messageId] }] : [] };
    } else if (request.forceTool === 'judge_coordination') {
      const { facts } = JSON.parse(request.messages[0]!.content);
      input = { targetMemberIds: ['owner'], changesOpenQuestionAnswer: false, answerFactIds: stage === 1 ? ['forecast:current'] : [], whoseAction: stage === 0 || stage === 2 ? null : '담당자', alreadyKnows: 'no', evidence: stage === 1 ? ['forecast:current'] : [`msg:${facts.messageId}`], decision: stage === 0 || stage === 2 ? 'silent' : 'speak', reason: 'test judgement', openTopics: [], text: stage === 1 ? '현재 예측을 확인했습니다.' : '결제 제외를 반영했습니다.' };
      stage++;
    } else throw new Error(`Unexpected fake LLM call: ${request.forceTool}`);
    return { text: '', model: 'fake', responseId: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [{ name: request.forceTool!, input }] };
  } };
  const workspace = await mkdtemp(path.join(tmpdir(), 'ensemble-template-'));
  await writeFile(path.join(workspace, 'research.md'), '조사 보고서');
  const connector = new Connector(workspace);
  const pm = new ProjectManager({ ...ctx, store, connector, llm, model: 'fake', clock: () => SCENE_NOW });
  const stops: string[] = [], progress: ScriptProgress = { step: 0, anchors: {} };
  const inputs: RevisionInput[] = [];
  const host = { pm, read: () => store.read(), recordStop: async (reason: string) => { stops.push(reason); }, generateRevision: async (input: RevisionInput) => {
    inputs.push(input);
    return (input.draft ?? input.previous).map(a => a.content).join('\n') + `\n보완 내용: ${input.handoffConditions.join('; ')}`;
  } };
  return { store, pm, connector, progress, host, stops, ids, workspace, inputs, llm };
}
