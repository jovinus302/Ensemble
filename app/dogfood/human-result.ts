// 사람 몫 작업의 결과 제출. 사람이 쓰는 경로(runtime.message)로 먼저 보내고, PM이 그 메시지를 처리했다는 증거가
// 있는데도 의도한 작업의 결과로 인식하지 않았을 때만 taskId를 붙여 대체 제출한다(pm.postMessage).
// 제품의 HTTP 메시지 경로는 첨부의 taskId를 버리므로, 인식 여부는 모델 분류나 고정 라우팅에 달려 있다(G4).
// 대체 제출은 R3, 다른 작업으로 잘못 간 경우는 R15로 집계한다. 제품 원장에는 직접 쓰지 않는다.
import { project, type AnyEvent, type LedgerEvent } from '@ensemble/core';
import type { Upload } from '../apps/web/lib/runtime.ts';
import type { RoleContext } from './role-context.ts';
import { lastSeq } from './role-context.ts';

/** 제출할 파일. 내용은 UTF-8 텍스트다. */
export interface HumanFile {
  name: string;
  content: string;
  mimeType?: string;
}

export interface HumanResultInput {
  memberId: 'owner' | 'designer';
  /** 하네스 원장에 남길 행위자(예: 'member-worker', 'teammate-a'). 제품 원장에는 memberId 명의로 남는다. */
  actor: string;
  taskId: string;
  text: string;
  files: HumanFile[];
  firstSubmission: boolean;
}

export type Judgement =
  | { state: 'recognized'; resultId: string }
  | { state: 'misrouted'; to: string; kind: 'result' | 'recheck' }
  | { state: 'unrecognized' }
  | { state: 'waiting' };

export interface HumanSubmitOutcome {
  via: 'http' | 'fallback' | 'misrouted' | 'pending';
  recognized: boolean;
  messageId: string;
  resultId: string | null;
  misroutedTo?: string;
}

/** 대체 제출을 해도 되는 작업 상태. 이미 submitted·checked이면 result_submitted가 작업을 오염시킨다. */
const SUBSTITUTABLE = new Set(['reserved', 'running', 'revising', 'blocked']);
const POLL_MS = 500;
const PENDING_NOTE_CYCLES = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 메시지 하나가 어떻게 처리됐는지 제품 원장만으로 판정한다(순수 함수).
 * 처리 증거 = pm_considered의 triggerId가 messageId이거나, idempotencyKey가 processed:<id>이거나, considerationId가 superseded:<id>.
 * recognized: result:<messageId>가 의도한 작업의 결과. misrouted: 다른 작업의 결과(result) 또는 다른 작업의 재검토(recheck).
 * unrecognized: 처리됐는데 결과가 없음. waiting: 처리 증거도 결과도 아직 없음.
 */
export function judgeSubmission(events: readonly LedgerEvent[], messageId: string, intendedTaskId: string): Judgement {
  const typed = events as readonly AnyEvent[];
  const resultId = `result:${messageId}`;
  const submitted = typed.findLast((e) => e.type === 'result_submitted' && e.payload.resultId === resultId);
  if (submitted?.type === 'result_submitted') {
    if (submitted.payload.taskId === intendedTaskId) return { state: 'recognized', resultId };
    // 재검토 경로도 같은 resultId로 result_submitted를 남긴다. 담당자가 보낸 사람이 아니면 재검토다.
    const assignee = project(events).tasks.get(submitted.payload.taskId)?.spec.assignee;
    return { state: 'misrouted', to: submitted.payload.taskId, kind: assignee === submitted.actor.id ? 'result' : 'recheck' };
  }
  const reviewed = typed.findLast((e) => e.type === 'handoff_reviewed' && e.payload.taskId !== intendedTaskId
    && (e.payload.resultId === resultId || e.payload.evidence.includes(messageId)));
  if (reviewed?.type === 'handoff_reviewed') return { state: 'misrouted', to: reviewed.payload.taskId, kind: 'recheck' };
  const processed = typed.some((e) => e.type === 'pm_considered'
    && (e.payload.triggerId === messageId || e.idempotencyKey === `processed:${messageId}` || e.payload.considerationId === `superseded:${messageId}`));
  return processed ? { state: 'unrecognized' } : { state: 'waiting' };
}

function toUploads(files: readonly HumanFile[]): Upload[] {
  return files.map((f) => ({ name: f.name, mimeType: f.mimeType ?? 'text/markdown', contentBase64: Buffer.from(f.content, 'utf8').toString('base64') }));
}

interface Submission {
  memberId: string;
  actor: string;
  taskId: string;
  text: string;
  files: HumanFile[];
  firstSubmission: boolean;
  messageId: string;
  /** 처음 제출한 사이클(pending이면 그 사이클). */
  cycle: number;
}

async function record(ctx: RoleContext, sub: Submission, outcome: HumanSubmitOutcome, key: string): Promise<void> {
  await ctx.ledger.record('dogfood_human_task_submitted', {
    memberId: sub.memberId,
    actor: sub.actor,
    taskId: sub.taskId,
    // 확정 기록(pending 재확인)은 확정한 사이클로 남긴다.
    cycle: key.startsWith('human-submit-final:') ? ctx.cycle : sub.cycle,
    fileNames: sub.files.map((f) => f.name),
    via: outcome.via,
    httpMessageId: sub.messageId,
    resultId: outcome.resultId,
    recognized: outcome.recognized,
    firstSubmission: sub.firstSubmission,
    ...(outcome.misroutedTo === undefined ? {} : { misroutedTo: outcome.misroutedTo }),
  }, { key, actor: sub.actor });
}

async function note(ctx: RoleContext, sub: Submission, text: string, key?: string): Promise<void> {
  await ctx.ledger.record('dogfood_role_note', { role: 'human-result', memberId: sub.memberId, cycle: ctx.cycle, kind: 'info', text }, key === undefined ? { actor: sub.actor } : { key, actor: sub.actor });
}

/**
 * ③~⑤. 인식되면 http로 기록한다. 처리됐는데 인식되지 않았거나(unrecognized) 잘못 갔으면(misrouted)
 * 작업 상태를 다시 확인한 뒤 taskId를 붙여 대체 제출한다. waiting이면 undefined(호출자가 pending 처리).
 */
async function conclude(ctx: RoleContext, sub: Submission, verdict: Judgement, key: string): Promise<HumanSubmitOutcome | undefined> {
  if (verdict.state === 'waiting') return undefined;
  if (verdict.state === 'recognized') {
    const outcome: HumanSubmitOutcome = { via: 'http', recognized: true, messageId: sub.messageId, resultId: verdict.resultId };
    await record(ctx, sub, outcome, key);
    return outcome;
  }
  const misroutedTo = verdict.state === 'misrouted' ? verdict.to : undefined;
  const via = verdict.state === 'misrouted' ? 'misrouted' : 'fallback';
  const base = { via, recognized: false, messageId: sub.messageId, ...(misroutedTo === undefined ? {} : { misroutedTo }) } as const;
  // ④ 대체 직전에 상태를 다시 확인한다. result_submitted는 작업이 어떤 상태든 submitted로 되돌리기 때문이다.
  const before = await ctx.host.events();
  const status = project(before).tasks.get(sub.taskId)?.status;
  if (status === undefined || !SUBSTITUTABLE.has(status)) {
    await note(ctx, sub, `대체 제출을 생략했습니다: 작업이 이미 ${status ?? '없음'} 상태입니다(${via}).`);
    const outcome: HumanSubmitOutcome = { ...base, resultId: null };
    await record(ctx, sub, outcome, key);
    return outcome;
  }
  const seqBefore = lastSeq(before);
  const { runtime } = ctx.host;
  try {
    await runtime.run(() => runtime.pm.postMessage(sub.memberId, sub.text, sub.files.map((f) => ({
      name: f.name, mimeType: f.mimeType ?? 'text/markdown', content: f.content, taskId: sub.taskId,
    }))));
  } catch (error) {
    await note(ctx, sub, `대체 제출에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  const after = await ctx.host.events();
  const found = (after as readonly AnyEvent[]).findLast((e) => e.type === 'result_submitted' && e.seq > seqBefore
    && e.actor.id === sub.memberId && e.payload.taskId === sub.taskId);
  const outcome: HumanSubmitOutcome = { ...base, resultId: found?.type === 'result_submitted' ? found.payload.resultId : null };
  await record(ctx, sub, outcome, key);
  return outcome;
}

/**
 * 사람 몫 작업의 결과를 제출한다.
 * ① runtime.message(taskId 없는 첨부) ② humanResultWaitSeconds까지 500ms 간격으로 판정 ③ 인식·대기 초과(pending) 기록
 * ④ 인식되지 않으면 상태를 다시 확인한 뒤 대체 제출 ⑤ dogfood_human_task_submitted를 human-submit:<messageId> 키로 기록.
 * 요청처럼 읽히는 문구('만들어 주세요' 등)는 text에 넣지 않는다: 새 작업 요청으로 해석될 수 있다.
 */
export async function submitHumanResult(ctx: RoleContext, input: HumanResultInput): Promise<HumanSubmitOutcome> {
  const { messageId } = await ctx.host.runtime.message(input.memberId, input.text, toUploads(input.files));
  const sub: Submission = { ...input, messageId, cycle: ctx.cycle };
  const deadline = Date.now() + ctx.config.humanResultWaitSeconds * 1000;
  let verdict: Judgement;
  for (;;) {
    verdict = judgeSubmission(await ctx.host.events(), messageId, input.taskId);
    if (verdict.state !== 'waiting' || Date.now() >= deadline || ctx.signal.aborted) break;
    await sleep(POLL_MS);
  }
  const key = `human-submit:${messageId}`;
  const done = await conclude(ctx, sub, verdict, key);
  if (done) return done;
  const pending: HumanSubmitOutcome = { via: 'pending', recognized: false, messageId, resultId: null };
  await record(ctx, sub, pending, key);
  return pending;
}

/** 제품 원장에서 메시지의 본문과 첨부를 되살린다(pending 재확인 때 대체 제출에 쓴다). */
function messageFromLedger(events: readonly LedgerEvent[], messageId: string): { text: string; files: HumanFile[] } | undefined {
  const typed = events as readonly AnyEvent[];
  const message = typed.find((e) => e.type === 'message_recorded' && e.payload.messageId === messageId);
  if (message?.type !== 'message_recorded') return undefined;
  const files: HumanFile[] = [];
  for (const id of message.payload.attachmentIds) {
    const att = typed.find((e) => e.type === 'attachment_recorded' && e.payload.attachmentId === id);
    if (att?.type !== 'attachment_recorded') continue;
    const m = /^data:[^,]*;base64,(.*)$/s.exec(att.payload.uri);
    files.push({ name: att.payload.name, mimeType: att.payload.mimeType, content: m ? Buffer.from(m[1]!, 'base64').toString('utf8') : '' });
  }
  return { text: message.payload.text, files };
}

/**
 * pending으로 남은 제출을 다시 판정한다. 하네스 원장에서 via 'pending'이고 같은 httpMessageId로 확정 기록이
 * 없는 항목마다 judgeSubmission을 돌린다. 판정이 나면 ③~⑤를 적용하고 human-submit-final:<messageId> 키로 남긴다.
 * waiting이 3사이클 넘게 이어지면 info 노트를 한 번 남긴다.
 */
export async function reconcilePending(ctx: RoleContext): Promise<void> {
  const harness = await ctx.ledger.read();
  const final = new Set(harness.flatMap((e) => (e.idempotencyKey?.startsWith('human-submit-final:') ? [e.idempotencyKey.slice('human-submit-final:'.length)] : [])));
  for (const event of harness) {
    if (event.type !== 'dogfood_human_task_submitted') continue;
    const p = event.payload as { via: string; httpMessageId: string | null; memberId: string; actor: string; taskId: string; cycle: number; firstSubmission: boolean };
    if (p.via !== 'pending' || p.httpMessageId === null || final.has(p.httpMessageId)) continue;
    final.add(p.httpMessageId);
    const events = await ctx.host.events();
    const verdict = judgeSubmission(events, p.httpMessageId, p.taskId);
    const sub: Submission = { memberId: p.memberId, actor: p.actor, taskId: p.taskId, text: '', files: [], firstSubmission: p.firstSubmission, messageId: p.httpMessageId, cycle: p.cycle };
    if (verdict.state === 'waiting') {
      if (ctx.cycle - p.cycle > PENDING_NOTE_CYCLES) await note(ctx, sub, `제출 메시지 ${p.httpMessageId}가 ${ctx.cycle - p.cycle}사이클째 처리되지 않았습니다.`, `pending-stuck:${p.httpMessageId}`);
      continue;
    }
    const original = messageFromLedger(events, p.httpMessageId);
    if (original) { sub.text = original.text; sub.files = original.files; }
    await conclude(ctx, sub, verdict, `human-submit-final:${p.httpMessageId}`);
  }
}
