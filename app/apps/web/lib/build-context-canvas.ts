// 작업 흐름 B 소유: WORK CONTEXT 캔버스·분기·요약·LOG. 기반 커밋은 최소 구현이다(LOG·stageLabel은 B가 채운다).
import { CONTEXT_ISSUE_STATUSES, type ContextItem, type ContextItemStatus, type ContextLayer, type ProjectState, type WorkContextState } from '@ensemble/core';
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

export function contextItemView(item: ContextItem, state: ProjectState, name: NameOf): VmContextItem {
  const member = state.members.get(item.sourceMemberId);
  const kind = item.sourceMemberId === 'pm' ? 'pm' as const : member?.source === 'pool' ? 'pool' as const : member?.kind ?? 'human';
  const sourceName = name(item.sourceMemberId);
  const view = STATUS_VIEW[item.status];
  return { id: item.itemId, ...(item.key ? { key: item.key } : {}), layer: item.layer, layerLabel: LAYER_LABEL[item.layer], title: item.title, status: item.status,
    ...(view.label ? { statusLabel: view.label } : {}), tone: view.tone, ...(item.note ? { note: item.note } : {}),
    source: { name: sourceName, initial: kind === 'pm' ? 'E' : Array.from(sourceName.trim())[0] ?? '?', kind } };
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

export interface ContextCanvasView {
  versionLabel: string; stageLabel?: string; summary: VmContextSummaryChip[];
  items: VmContextItem[]; edges: VmContextEdge[]; branches: VmContextBranch[]; log: VmContextLogLine[];
}
export function buildContextCanvas(state: ProjectState, name: NameOf): ContextCanvasView {
  const wc = state.workContext!;
  const visible = [...wc.items.values()].filter(i => !i.supersededBy);
  const ids = new Set(visible.map(i => i.itemId));
  const edges = [...wc.edges.values()].filter(e => (ids.has(e.from) || e.from.startsWith('tool:')) && (ids.has(e.to) || e.to.startsWith('tool:')));
  const summary: VmContextSummaryChip[] = [{ label: '연결', count: edges.length, tone: 'ok' }];
  for (const status of CONTEXT_ISSUE_STATUSES) {
    const count = visible.filter(i => i.status === status).length;
    if (count) summary.push({ label: STATUS_VIEW[status].label!, count, tone: STATUS_VIEW[status].tone });
  }
  const open = [...wc.changeSets.values()].find(c => c.status === 'proposed');
  return {
    versionLabel: open ? `v${open.change.fromVersion} → v${open.change.toVersion}` : `v${wc.version}`,
    summary,
    items: visible.map(i => contextItemView(i, state, name)),
    edges: edges.map(e => ({ id: e.edgeId, from: e.from, to: e.to, kind: e.kind, ...(e.stale ? { stale: true } : {}) })),
    branches: [...wc.branches.keys()].flatMap(id => contextBranchView(wc, id, name) ?? []),
    log: [],
  };
}
