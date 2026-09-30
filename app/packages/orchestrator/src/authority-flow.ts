import { project, opAuthority, type AnyEvent, type EventContext, type EventPayloads, type PlanOp } from '@ensemble/core';
import type { LedgerStore } from '@ensemble/store';
import { Coordinator, validOp } from './coordination.ts';
import { planningNotice } from './planning.ts';
import type { PmPost } from './pm.ts';

/** Human card answers are ledger facts; interpretation is unnecessary. The Coordinator still
 * validates authority and applies the exact same operations, notifications and steer path.
 * The PM queue serializes answers; the coordinator transaction guards concurrent ledger changes.
 */
export async function decideAuthority(options: { store: LedgerStore; context: EventContext; coordinator: Coordinator }, requestId: string, memberId: string, granted: boolean): Promise<PmPost[]> {
  const events = await options.store.read({ projectId: options.context.projectId }) as AnyEvent[];
  const original = events.find(e => e.type === 'authority_requested' && e.payload.requestId === requestId);
  if (!original || original.type !== 'authority_requested') throw new Error('해당 승인 요청을 찾지 못했습니다.');
  const state = project(events), request = original.payload;
  if (request.personId !== memberId || state.members.get(memberId)?.kind !== 'human') throw new Error('승인을 요청받은 사람만 결정할 수 있습니다.');
  if (!state.pendingAuthority.has(requestId)) return [];
  const key = `authority-answer:${requestId}`;
  if (!granted) {
    const text = '변경을 승인하지 않았습니다. 다른 방법을 함께 정해 주세요.';
    const tx = await options.store.transaction(options.context.projectId, current => {
      const latest = project(current);
      if (!latest.pendingAuthority.has(requestId)) return { append: [], result: false };
      return { append: [
        { ...options.context, actor: { kind: 'human', id: memberId }, type: 'authority_granted', idempotencyKey: key, payload: { requestId, personId: memberId, granted: false } },
        ...planningNotice(options.context, key, memberId, text, [...new Set([...latest.openTopics, request.text])]),
      ], result: true };
    });
    return tx.result ? [{ text, kind: 'ask' }] : [];
  }
  if (!state.plan || !state.goal) throw new Error('계획을 확정한 뒤 변경을 승인해 주세요.');
  let operation: Record<string, unknown>;
  try { operation = Object.fromEntries(JSON.parse(request.operationKey ?? '')); }
  catch { throw new Error('승인 요청에 변경 내용이 올바르게 기록되지 않았습니다.'); }
  const messageId = key;
  const op = { ...operation, sourceMessageIds: [messageId] } as PlanOp;
  const withAnswer = structuredClone(state);
  withAnswer.messages.push({ messageId, authorId: memberId, text: request.text, seq: state.lastSeq + 1 });
  if (!validOp(op, withAnswer) || !opAuthority(withAnswer, op).allowed) throw new Error('요청한 변경이 유효하지 않거나 승인 권한이 바뀌었습니다.');
  await options.store.append([{ ...options.context, actor: { kind: 'human', id: memberId }, type: 'message_recorded', idempotencyKey: `${key}:message`, payload: { messageId, authorId: memberId, text: `승인: ${request.text}`, attachmentIds: [] } }]);
  return (await options.coordinator.onConfirmedOperations(messageId, [op], requestId)).posts;
}
