// 작업 흐름 C 소유: 채팅 카드·인력 pool·Proposal·제작 도구 전달·변경 묶음·모바일 미리보기.
// 카드는 id만 담고(ContextCard), 여기서 지금 원장 상태로 풀어 준다. 그래서 같은 채팅 카드의 진행 라벨이 제자리에서 바뀐다.
import { currentPreview, type ContextCard, type PreviewState, type ProjectState, type ToolHandoffStatus } from '@ensemble/core';
import { contextBranchView, contextItemView, STATUS_VIEW, type NameOf } from './build-context-canvas';
import type { VmAppPreview, VmChangeSet, VmContextCard, VmPoolCandidate, VmProposal, VmToolHandoff } from './work-context-view-model';

const HANDOFF_LABEL: Record<ToolHandoffStatus, string> = { delivered: '전달됨', in_progress: '제작 중', done: '제작 완료' };
const DEV_LABEL: Record<ToolHandoffStatus, string> = { delivered: '전달됨', in_progress: '통합 빌드 중', done: '빌드 완료' };
/** 2회차 이후 전달은 "재전달"(변경분만 다시 넘김). 진행이 시작되면 회차와 상관없이 같은 라벨이다. */
const handoffLabel = (toolId: string, status: ToolHandoffStatus, round: number) =>
  status === 'delivered' && round > 1 ? '재전달' : (toolId === 'dev-tools' ? DEV_LABEL : HANDOFF_LABEL)[status];

export interface ContextCardsView {
  preview?: VmAppPreview; comparePreview?: VmAppPreview; handoffs: VmToolHandoff[]; proposal?: VmProposal; changeSet?: VmChangeSet;
  pool: { candidates: VmPoolCandidate[]; joinedCount: number };
  /** messageId → 그 메시지에 붙은 카드. */
  cardFor(messageId: string): VmContextCard | undefined;
}

export function buildContextCards(state: ProjectState, name: NameOf, me: string): ContextCardsView {
  const wc = state.workContext!;
  const previewView = (p: PreviewState | undefined): VmAppPreview | undefined => p && { previewId: p.preview.previewId, source: p.preview.source, label: p.preview.label, ...(p.preview.caption ? { caption: p.preview.caption } : {}), spec: p.preview.spec };
  const handoff = (id: string): VmToolHandoff[] => {
    const h = wc.handoffs.get(id);
    if (!h) return [];
    const tool = wc.tools.get(h.handoff.toolId), owner = tool ? name(tool.ownerMemberId) : '';
    return [{ id, toolId: h.handoff.toolId, toolName: tool?.name ?? h.handoff.toolId, ownerName: owner, ownerInitial: Array.from(owner)[0] ?? '?', title: h.handoff.title, round: h.handoff.round,
      status: h.status, statusLabel: handoffLabel(h.handoff.toolId, h.status, h.handoff.round), ...(h.note ? { note: h.note } : {}) }];
  };
  const joined = new Set([...state.members.values()].flatMap(m => m.source === 'pool' && m.candidateId ? [m.candidateId] : []));
  const candidates = (ids: string[]): VmPoolCandidate[] => ids.flatMap(id => {
    const c = wc.pool.candidates.get(id);
    return c ? [{ candidateId: id, name: c.displayName, initial: Array.from(c.displayName)[0] ?? '?', role: c.role, note: c.note, available: c.availability === 'available', invited: wc.pool.invited.has(id), joined: joined.has(id) }] : [];
  });
  const proposalView = (id: string): VmProposal | undefined => {
    const p = wc.proposals.get(id);
    if (!p) return undefined;
    // 사람이 고른 분기는 항목이 아직 "분기"여도 고른 선택지로 보인다("… (B)" · 확정). 확정 뒤에는 항목 제목·상태를 그대로 쓴다.
    const decisions = p.proposal.decisionItemIds.flatMap(itemId => {
      const item = wc.items.get(itemId);
      if (!item) return [];
      const branch = wc.branches.get(itemId), chosen = item.status === 'branch' && branch?.resolved ? branch.options.find(o => o.optionId === branch.resolved!.optionId) : undefined;
      return [{ ...(item.key ? { key: item.key } : {}), title: chosen ? `${chosen.title} (${chosen.optionId})` : item.title, statusLabel: chosen ? '확정' : STATUS_VIEW[item.status].label ?? '' }];
    });
    return { id, version: p.proposal.version, title: p.proposal.title, status: p.status, decisions, screens: p.proposal.screens,
      filledTitles: p.proposal.filledItemIds.flatMap(itemId => wc.items.get(itemId)?.title ?? []), inputCount: p.proposal.inputItemIds.length };
  };
  const changeView = (id: string): VmChangeSet | undefined => {
    const c = wc.changeSets.get(id);
    if (!c) return undefined;
    const item = (itemId: string) => wc.items.get(itemId);
    return { id, fromVersion: c.change.fromVersion, toVersion: c.change.toVersion, status: c.status,
      changes: c.change.changes.map(x => ({ ...(item(x.itemId)?.key ? { key: item(x.itemId)!.key } : {}), title: item(x.itemId)?.title ?? '', change: x.change })),
      staleTitles: c.change.staleItemIds.flatMap(itemId => item(itemId)?.title ?? []), unaffectedKeys: c.change.unaffectedItemIds.flatMap(itemId => item(itemId)?.key ?? []),
      canResolve: c.status === 'proposed' && state.goal?.decider === me };
  };
  const resolve = (card: ContextCard): VmContextCard | undefined => {
    switch (card.kind) {
      case 'branch_options': { const branch = contextBranchView(wc, card.itemId, name); return branch && { kind: card.kind, branch }; }
      case 'branch_preview': { const branch = contextBranchView(wc, card.itemId, name); return branch && { kind: card.kind, branch, optionId: card.optionId }; }
      case 'pm_steps': {
        const search = card.searchId ? wc.pool.searches.get(card.searchId) : undefined, proposal = card.proposalId ? proposalView(card.proposalId) : undefined;
        return { kind: card.kind, label: card.label, steps: card.steps, ...(search ? { candidates: candidates(search.candidateIds) } : {}), ...(proposal ? { proposal } : {}) };
      }
      case 'pool_candidates': { const search = wc.pool.searches.get(card.searchId); return search && { kind: card.kind, candidates: candidates(search.candidateIds) }; }
      case 'proposal': { const proposal = proposalView(card.proposalId); return proposal && { kind: card.kind, proposal }; }
      case 'expansion': {
        const p = wc.proposals.get(card.proposalId);
        return p && { kind: card.kind, items: p.expandedItemIds.flatMap(id => { const item = wc.items.get(id); return item ? [contextItemView(item, state, name)] : []; }) };
      }
      case 'tool_handoffs': return { kind: card.kind, handoffs: card.handoffIds.flatMap(handoff) };
      case 'build': { const build = wc.builds.get(card.buildId); return build && { kind: card.kind, version: build.version, handoffs: build.handoffIds.flatMap(handoff) }; }
      case 'change_set': { const changeSet = changeView(card.changeSetId); return changeSet && { kind: card.kind, changeSet }; }
    }
  };
  const latestProposal = [...wc.proposals.keys()].at(-1), latestChange = [...wc.changeSets.keys()].at(-1);
  const branchPreview = currentPreview(wc, 'branch');
  const main = [...wc.previews.values()].filter(p => !p.withdrawn && p.preview.source !== 'branch').sort((a, b) => b.seq - a.seq)[0];
  const proposal = latestProposal ? proposalView(latestProposal) : undefined, changeSet = latestChange ? changeView(latestChange) : undefined;
  const preview = previewView(main), comparePreview = previewView(branchPreview);
  return {
    ...(preview ? { preview } : {}), ...(comparePreview ? { comparePreview } : {}),
    handoffs: [...wc.handoffs.keys()].flatMap(handoff),
    ...(proposal ? { proposal } : {}), ...(changeSet ? { changeSet } : {}),
    pool: { candidates: candidates([...wc.pool.candidates.keys()]), joinedCount: joined.size },
    cardFor: messageId => { const card = wc.cards.get(messageId); return card ? resolve(card) : undefined; },
  };
}
