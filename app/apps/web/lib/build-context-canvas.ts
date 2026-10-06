// 작업 흐름 B 소유: WORK CONTEXT 캔버스·분기·요약·단계·LOG. 화면은 이 결과(VmWorkContext의 캔버스 부분)만 보고 그린다.
import { CONTEXT_ISSUE_STATUSES, type AnyEvent, type ContextItem, type ContextItemStatus, type ContextLayer, type ProjectState, type WorkContextState } from '@ensemble/core';
import { buildContextLog } from './context-log';
import type { VmContextBranch, VmContextEdge, VmContextItem, VmContextLogLine, VmContextSummaryChip, VmContextTone } from './work-context-view-model';

export type NameOf = (memberId: string) => string;

export const LAYER_LABEL: Record<ContextLayer, string> = { intent: '[의도]', decision: '[결정]', feature: '[기능]', screen: '[화면]', metric: '[지표]', contribution: '[참여]' };
export const STATUS_VIEW: Record<ContextItemStatus, { label?: string; tone: VmContextTone }> = {
  stated: { tone: 'ok' }, conflict: { label: '충돌', tone: 'conflict' }, violation: { label: '위반', tone: 'violation' },
  undecided: { label: '미정', tone: 'undecided' }, missing: { label: '누락', tone: 'missing' }, filled: { label: '누락 보완', tone: 'ok' },
  merged: { label: '통합', tone: 'ok' }, branch: { label: '분기', tone: 'branch' }, confirmed: { label: '확정', tone: 'ok' },
  verify_pending: { label: '검증 예정', tone: 'info' }, kept: { label: '유지', tone: 'ok' }, added: { label: '추가', tone: 'changed' },
  updated: { label: '갱신', tone: 'changed' }, stale: { label: '낡음', tone: 'stale' }, excluded: { label: '제외', tone: 'excluded' },
};
/** 확정 뒤 펼친 흐름(결정 → 기능 → 화면 → 지표)의 상태. 캔버스 요약에서 이 순서로 센다. */
const FLOW_STATUSES: readonly ContextItemStatus[] = ['confirmed', 'kept', 'added', 'updated', 'stale', 'excluded', 'verify_pending'];

/** 출처 머리글자: PM은 "E"(Ensemble), Agent는 첫 단어 두 글자("ST", "UI"), 사람은 이름 첫 글자. */
function sourceInitial(name: string, kind: VmContextItem['source']['kind']): string {
  if (kind === 'pm') return 'E';
  if (kind === 'agent') return Array.from(name.trim().split(/\s+/)[0] ?? '').slice(0, 2).join('').toUpperCase() || '?';
  return Array.from(name.trim())[0] ?? '?';
}

export function contextItemView(item: ContextItem, state: ProjectState, name: NameOf): VmContextItem {
  const member = state.members.get(item.sourceMemberId);
  const kind = item.sourceMemberId === 'pm' ? 'pm' as const : member?.source === 'pool' ? 'pool' as const : member?.kind ?? 'human';
  const sourceName = name(item.sourceMemberId);
  const view = STATUS_VIEW[item.status];
  return { id: item.itemId, ...(item.key ? { key: item.key } : {}), layer: item.layer, layerLabel: LAYER_LABEL[item.layer], title: item.title, status: item.status,
    ...(view.label ? { statusLabel: view.label } : {}), tone: view.tone, ...(item.note ? { note: item.note } : {}),
    source: { name: sourceName, initial: sourceInitial(sourceName, kind), kind } };
}

export function contextBranchView(wc: WorkContextState, itemId: string, name: NameOf): VmContextBranch | undefined {
  const branch = wc.branches.get(itemId);
  if (!branch) return undefined;
  const key = wc.items.get(itemId)?.key;
  return { itemId, ...(key ? { key } : {}), question: branch.question,
    options: branch.options.map(o => ({ optionId: o.optionId, title: o.title, gains: o.gains, risks: o.risks, chosen: branch.resolved?.optionId === o.optionId, previewing: branch.preview?.optionId === o.optionId })),
    ...(branch.resolved ? { decidedByName: name(branch.resolved.decidedBy) } : {}), evidenceNames: (branch.resolved?.evidenceMemberIds ?? []).map(name),
    ...(branch.preview ? { previewEffects: branch.preview.effects } : {}) };
}

/** 캔버스 머리 단계("Proposal v1 · 확정 → 제작 도구 전달 → 제작 완료", 변경을 다루는 중이면 "Pages v1.0 · 상세 조율"). 확정 전에는 없다. */
function stageLabel(wc: WorkContextState): string | undefined {
  const confirmed = [...wc.proposals.values()].filter(p => p.status === 'confirmed').at(-1);
  if (!confirmed) return undefined;
  if (wc.changeSets.size) {
    const build = [...wc.builds.values()].at(-1);
    const app = (build?.previewId && wc.previews.get(build.previewId)?.preview.spec.appName) || wc.session.title;
    return `${app} v${build?.version ?? wc.version} · 상세 조율`;
  }
  const steps = [`Proposal v${confirmed.proposal.version} · 확정`];
  const handoffs = [...wc.handoffs.values()];
  if (handoffs.length) steps.push('제작 도구 전달');
  if (handoffs.length && handoffs.every(h => h.status === 'done')) steps.push('제작 완료');
  return steps.join(' → ');
}

function summaryChips(state: ProjectState, visible: ContextItem[], edgeCount: number): VmContextSummaryChip[] {
  const wc = state.workContext!;
  const summary: VmContextSummaryChip[] = [{ label: '연결', count: edgeCount, tone: 'ok' }];
  const count = (status: ContextItemStatus) => visible.filter(i => i.status === status).length;
  for (const status of CONTEXT_ISSUE_STATUSES) if (count(status)) summary.push({ label: STATUS_VIEW[status].label!, count: count(status), tone: STATUS_VIEW[status].tone });
  if ([...wc.proposals.values()].some(p => p.status === 'confirmed')) {
    // 펼친 뒤에는 흐름의 상태 수가 범례를 겸한다(확정 · 추가 · 제외 · 낡음 …).
    for (const status of FLOW_STATUSES) if (count(status)) summary.push({ label: STATUS_VIEW[status].label!, count: count(status), tone: STATUS_VIEW[status].tone });
    return summary;
  }
  const branches = [...wc.branches.values()].filter(b => visible.some(i => i.itemId === b.itemId));
  if (branches.length) summary.push({ label: '분기', count: branches.length, tone: 'branch' });
  for (const b of branches) {
    const key = branches.length > 1 ? `${wc.items.get(b.itemId)?.key ?? ''} ` : '';
    if (b.resolved) summary.push({ label: `${key}${b.resolved.optionId} 선택`, tone: 'ok' });
    if (b.preview) summary.push({ label: `${key}${b.preview.optionId} 예상`, tone: 'info' });
  }
  const joined = [...state.members.values()].filter(m => m.source === 'pool').length;
  if (joined) summary.push({ label: 'pool 합류', count: joined, tone: 'info' });
  const proposal = [...wc.proposals.values()].at(-1);
  if (proposal) summary.push({ label: `Proposal v${proposal.proposal.version} 생성`, tone: 'ok' });
  return summary;
}

export interface ContextCanvasView {
  versionLabel: string; stageLabel?: string; summary: VmContextSummaryChip[];
  items: VmContextItem[]; edges: VmContextEdge[]; branches: VmContextBranch[]; log: VmContextLogLine[];
}
/** events는 LOG의 시각에만 쓴다. 넘기지 않으면 LOG만 빈다. */
export function buildContextCanvas(state: ProjectState, name: NameOf, events: readonly AnyEvent[] = []): ContextCanvasView {
  const wc = state.workContext!;
  const visible = [...wc.items.values()].filter(i => !i.supersededBy);
  const ids = new Set(visible.map(i => i.itemId));
  const edges = [...wc.edges.values()].filter(e => (ids.has(e.from) || e.from.startsWith('tool:')) && (ids.has(e.to) || e.to.startsWith('tool:')));
  const open = [...wc.changeSets.values()].find(c => c.status === 'proposed');
  const stage = stageLabel(wc);
  return {
    versionLabel: open ? `v${open.change.fromVersion} → v${open.change.toVersion}` : `v${wc.version}`,
    ...(stage ? { stageLabel: stage } : {}),
    summary: summaryChips(state, visible, edges.length),
    items: visible.map(i => contextItemView(i, state, name)),
    edges: edges.map(e => ({ id: e.edgeId, from: e.from, to: e.to, kind: e.kind, ...(e.stale ? { stale: true } : {}) })),
    branches: [...wc.branches.keys()].flatMap(id => ids.has(id) ? contextBranchView(wc, id, name) ?? [] : []),
    log: buildContextLog(events, state, name),
  };
}
