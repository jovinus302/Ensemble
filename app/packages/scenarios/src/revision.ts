import { project, type AnyEvent } from '@ensemble/core';
import type { LlmProvider } from '@ensemble/llm';
import type { ScriptedStep } from './index.ts';
import { resolveTarget, type ScriptHost, type ScriptProgress } from './script.ts';

type Material = { name: string; mimeType: string; content: string };
/** This allowlist is the entire model input: no ledger or PM reasoning. */
export interface RevisionInput {
  title: string;
  handoffConditions: string[];
  request: string;
  previous: Material[];
  draft?: Material[];
  /** Accepted predecessor artifacts, visible to the human whose document is being revised. */
  sources?: Material[];
}
export type RevisionGenerator = (input: RevisionInput) => Promise<string>;
export function createRevisionGenerator(llm: LlmProvider, model: string): RevisionGenerator {
  return async input => {
    const request = { model, maxTokens: 12000,
      system: '당신은 시연용 가상 사람입니다. PM의 보완 요청에 따라 직전 자료를 보완해 새 자료 전체를 반환하세요. draft가 있으면 첫 보완 초안으로 사용하세요. sources는 확인된 선행 작업 자료입니다. 근거 연결을 요청받으면 sources 안의 구체적인 문장과 파일명을 인용하여 설계 결정에 연결하세요. sources의 가상 자료 표시와 확인 한계를 유지하세요. 기존 내용을 보존하고 요청된 부족 부분만 가상의 구체적인 자료로 짧게 보완하세요. 요청하지 않은 주장이나 기능을 늘리지 마세요. 실제 조사나 실제 고객 증거라고 주장하지 마세요. 자료 본문만 출력하세요.',
      messages: [{ role: 'user' as const, content: JSON.stringify(input) }],
    };
    let response = await llm.complete(request);
    if (response.stopReason === 'max_tokens') response = await llm.complete({ ...request,
      system: `${request.system}\n직전 응답이 출력 한도를 넘었습니다. 중복 설명과 장황한 문장을 줄여 더 짧게 다시 작성하세요. 필수 화면·근거·보완 요청과 기존 자료의 중요한 내용은 빠뜨리지 마세요. 완결된 전체 문서만 반환하세요.`,
    });
    if (response.stopReason === 'max_tokens' || !response.text.trim()) throw new Error('보완 자료 생성 응답이 비었거나 잘렸습니다');
    return response.text.trim();
  };
}

export async function respondToRevision(host: ScriptHost, step: ScriptedStep, progress: ScriptProgress) {
  if (!step.target || step.target.assignee !== step.as) throw new Error('보완 대상은 발언자 본인의 작업이어야 합니다');
  let events = await host.read() as AnyEvent[];
  const initial = project(events);
  // A checked submission needs no revision; retain the exact submitted task when it is no longer active.
  const last = events.findLast(e => e.type === 'attachment_recorded' && e.actor.id === step.as && e.payload.taskId);
  let taskId: string;
  try { taskId = resolveTarget(initial, step.target); }
  catch (error) {
    if (step.target.pick === 'next' || last?.type !== 'attachment_recorded' || initial.tasks.get(last.payload.taskId!)?.status !== 'checked') throw error;
    taskId = last.payload.taskId!;
  }
  while (true) {
    events = await host.read() as AnyEvent[];
    const task = project(events).tasks.get(taskId)!;
    if (task.status === 'checked') return;
    if (task.status !== 'revising') throw new Error(`보완 판단이 없습니다: ${task.spec.title} (${task.status})`);
    const revision = events.findLast(e => e.type === 'revision_requested' && e.payload.taskId === taskId);
    if (revision?.type !== 'revision_requested') throw new Error('보완 요청을 찾지 못했습니다');
    const speech = events.find(e => e.type === 'pm_spoke' && e.payload.considerationId === `handoff-notice:${revision.payload.resultId}`);
    if (speech?.type !== 'pm_spoke') throw new Error('채널에 게시된 PM 보완 요청을 찾지 못했습니다');
    const count = progress.revisions?.[taskId] ?? 0;
    if (count >= 2) throw new Error(`보완 2회 후 미충족: ${task.spec.title}\n${speech.payload.text}`);
    if (!host.generateRevision) throw new Error('보완 자료 생성기가 없습니다');
    const submission = events.findLast(e => e.type === 'result_submitted' && e.payload.taskId === taskId);
    const ids = submission?.type === 'result_submitted' ? submission.payload.artifactIds : [];
    const previous = events.flatMap(e => {
      if (e.type !== 'attachment_recorded' || !ids.includes(e.payload.attachmentId)) return [];
      const match = /^data:[^,]*;base64,(.*)$/s.exec(e.payload.uri);
      if (!match) throw new Error('보완할 첨부 자료를 읽지 못했습니다');
      return [{ name: e.payload.name, mimeType: e.payload.mimeType, content: Buffer.from(match[1]!, 'base64').toString('utf8') }];
    });
    if (!previous.length) throw new Error('보완할 직전 첨부가 없습니다');
    const current = project(events);
    const sourceIds = task.spec.dependsOn.flatMap(id => {
      const upstream = current.tasks.get(id);
      if (upstream?.status !== 'checked' || !upstream.checkedResultId) return [];
      const accepted = events.find(e => e.type === 'result_submitted' && e.payload.resultId === upstream.checkedResultId);
      return accepted?.type === 'result_submitted' ? accepted.payload.artifactIds : [];
    });
    const sources = events.flatMap(e => {
      if (e.type !== 'attachment_recorded' || !sourceIds.includes(e.payload.attachmentId)) return [];
      const match = /^data:[^,]*;base64,(.*)$/s.exec(e.payload.uri);
      return match ? [{ name: e.payload.name, mimeType: e.payload.mimeType, content: Buffer.from(match[1]!, 'base64').toString('utf8') }] : [];
    });
    const input: RevisionInput = { title: task.spec.title, handoffConditions: [...task.spec.handoffConditions], request: speech.payload.text, previous,
      ...(count === 0 && step.attachments ? { draft: step.attachments.map(a => ({ ...a })) } : {}), ...(sources.length ? { sources } : {}) };
    const content = `시연용 가상 자료 — 보완 ${count + 1}회차\n\n${await host.generateRevision(input)}`;
    (progress.revisions ??= {})[taskId] = count + 1;
    (progress.revisionHistory ??= []).push({ taskId, round: count + 1, request: input.request, content });
    await host.pm.postMessage(step.as, `요청하신 부분을 보완했습니다 (${count + 1}회차).`, [{ name: `revision-${count + 1}-${previous[0]!.name}`, mimeType: 'text/markdown', content, taskId }]);
  }
}
