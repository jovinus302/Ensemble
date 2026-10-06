// 작업 흐름 B 소유: WORK CONTEXT LOG. 원장 이벤트를 차례로 읽어 덱 문장 형식("10:45 누락 · …")의 줄을 만든다(최신이 위).
// 같은 분(minute)에 일어난 일은 한 묶음으로 보고, 묶음 안에서 같은 종류·대상은 한 줄로 합친다.
// 제목은 그 이벤트 시점의 것을 쓴다(흡수된 항목도 LOG에는 옛 이름으로 남는다). 내부 id는 문장에 넣지 않는다.
import type { AnyEvent, AppPreviewSpec, BranchOption, ContextItem, ContextItemStatus, ProjectState, ProductionToolId, WorkContextEventPayloads } from '@ensemble/core';
import { LAYER_LABEL, STATUS_VIEW, type NameOf } from './build-context-canvas';
import type { VmContextLogLine } from './work-context-view-model';

type P<K extends keyof WorkContextEventPayloads> = WorkContextEventPayloads[K];

interface Line { id: string; at: string; kindLabel: string; text: () => string; dropped?: boolean }

/** 펼침·변경 묶음 줄이 따로 설명하는 상태들(같은 묶음 안에서는 상태별 줄을 지운다). */
const PROPOSAL_STATUSES: readonly ContextItemStatus[] = ['confirmed', 'verify_pending'];
const CHANGE_STATUSES: readonly ContextItemStatus[] = ['kept', 'added', 'updated', 'stale', 'excluded'];
const CHANGE_MARK = { added: 'new', excluded: 'off', updated: '갱신' } as const;
const CHANGE_KIND = { added: '추가', excluded: '제외', updated: '갱신' } as const;

/** "D1 생성 = 9시 자동", 키가 없으면 "[기능] 4종 매일 동시 생성". */
export function itemLabel(item: Pick<ContextItem, 'key' | 'layer' | 'title'>): string {
  return item.key ? `${item.key} ${item.title}` : `${LAYER_LABEL[item.layer]} ${item.title}`;
}
const layerName = (item: ContextItem) => LAYER_LABEL[item.layer].replace(/[[\]]/g, '');
const keyOrTitle = (item: ContextItem | undefined) => item ? item.key ?? item.title : '';

/** "D1 D2 · F1–F4 · S1 S2 · V1 V2": 레이어별로 묶고, 같은 글자의 연속 번호 3개 이상은 범위로 줄인다. */
export function keyGroups(items: ContextItem[]): string {
  const groups: ContextItem[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0]!.layer === item.layer) last.push(item); else groups.push([item]);
  }
  return groups.map(group => {
    const parts: string[] = [];
    let run: { prefix: string; from: number; to: number }[] = [];
    const flush = () => {
      for (const r of run.length >= 3 ? [run] : run.map(x => [x])) parts.push(r.length >= 3 ? `${r[0]!.prefix}${r[0]!.from}–${r[0]!.prefix}${r.at(-1)!.to}` : `${r[0]!.prefix}${r[0]!.from}`);
      run = [];
    };
    for (const item of group) {
      const m = item.key ? /^([A-Za-z]+)(\d+)$/.exec(item.key) : null;
      if (!m) { flush(); parts.push(item.key ?? item.title); continue; }
      const prefix = m[1]!, n = Number(m[2]);
      const prev = run.at(-1);
      if (prev && (prev.prefix !== prefix || prev.to + 1 !== n)) flush();
      run.push({ prefix, from: n, to: n });
    }
    flush();
    return parts.join(' ');
  }).join(' · ');
}

export function buildContextLog(events: readonly AnyEvent[], state: ProjectState, name: NameOf): VmContextLogLine[] {
  const wc = state.workContext;
  if (!wc || events.length === 0) return [];
  const isHuman = (id: string) => state.members.get(id)?.kind === 'human';
  const toolName = (toolId: ProductionToolId) => wc.tools.get(toolId)?.name ?? '제작 도구';
  // 그 시점의 기록(재생). 투영과 같이, 없는 대상을 가리키는 이벤트는 LOG에도 남기지 않는다.
  const items = new Map<string, ContextItem>();
  const branches = new Map<string, { options: BranchOption[]; resolved?: string; preview?: string }>();
  const proposals = new Map<string, { version: number; status: 'generated' | 'confirmed' }>();
  const handoffs = new Map<string, ProductionToolId>();
  const previews = new Map<string, AppPreviewSpec>();
  const changeSets = new Map<string, { from: string; to: string; open: boolean }>();
  const messages = new Map<string, { authorId: string; at: string }>();
  const invited = new Map<string, { candidateId: string; memberId: string }[]>();
  const joined = new Set<string>();
  const conflictEdgeEnds = new Set<string>();
  for (const e of events) if (e.type === 'context_edge_upserted' && e.payload.edge.kind === 'conflicts') { conflictEdgeEnds.add(e.payload.edge.from); conflictEdgeEnds.add(e.payload.edge.to); }

  const lines: Line[] = [];
  let beat = '', beatLines = new Map<string, Line>(), beatStaleEdges = 0;
  let beatResolved: { itemId: string; optionId: string } | undefined, beatCleared: { itemId: string; optionId: string; line: Line } | undefined;
  const confirmLines = new Map<string, { line: Line; expanded?: string }>();
  let current: AnyEvent;
  /** 이 묶음의 kind·대상 줄. 없으면 만든다. */
  const line = (kind: string, key: string, kindLabel: string, text: () => string, at = current.at): Line => {
    const k = `${kind}:${key}`;
    let found = beatLines.get(k);
    if (!found) { found = { id: `${current.id}:${kind}`, at, kindLabel, text }; beatLines.set(k, found); lines.push(found); }
    return found;
  };
  const dropStatusLines = (statuses: readonly ContextItemStatus[]) => { for (const s of statuses) { const l = beatLines.get(`status:${s}:all`); if (l) l.dropped = true; } };
  const lists = new Map<Line, string[]>();
  const listLine = (kind: string, key: string, kindLabel: string, render: (list: string[]) => string, entry: string) => {
    const l: Line = line(kind, key, kindLabel, () => render(lists.get(l)!));
    if (!lists.has(l)) lists.set(l, []);
    lists.get(l)!.push(entry);
  };
  // 흡수(통합·분기): 대상 줄에 흡수된 항목의 옛 이름을 모은다.
  const absorbedOf = new Map<string, string[]>();
  const absorbed = (targetId: string) => { let a = absorbedOf.get(`${beat}:${targetId}`); if (!a) { a = []; absorbedOf.set(`${beat}:${targetId}`, a); } return a; };
  const branchLine = (target: ContextItem) => {
    const subject = itemLabel(target), from = absorbed(target.itemId), branch = () => branches.get(target.itemId);
    return line('branch', target.itemId, '분기', () => {
      const options = branch()?.options ?? [];
      return `${subject}${from.length ? ` ← ${from.join(' · ')}` : ''}${options.length ? ` — ${options.map(o => `${o.optionId} ${o.title}`).join(' · ')}` : ''}`;
    });
  };
  const mergeLine = (target: ContextItem) => {
    const subject = itemLabel(target), from = absorbed(target.itemId);
    return line('merge', target.itemId, '통합', () => from.length ? `${subject} ← ${from.join(' · ')}` : subject);
  };

  let started = false;
  for (const e of events) {
    current = e;
    if (e.type === 'message_recorded') messages.set(e.payload.messageId, { authorId: e.payload.authorId, at: e.at });
    if (e.type === 'member_joined' && e.payload.source === 'pool') joined.add(e.payload.memberId);
    if (e.type === 'context_session_started') { started = true; continue; }
    if (!started) continue;
    const minute = e.at.slice(0, 16);
    if (minute !== beat) { beat = minute; beatLines = new Map(); beatStaleEdges = 0; beatResolved = undefined; beatCleared = undefined; }

    switch (e.type) {
      case 'context_item_upserted': {
        const next = e.payload.item, prev = items.get(next.itemId);
        items.set(next.itemId, next);
        if (next.supersededBy) {
          const target = items.get(next.supersededBy);
          if (!target || prev?.supersededBy === next.supersededBy) break;
          absorbed(target.itemId).push(itemLabel(prev ?? next));
          if (target.status === 'branch') branchLine(target); else mergeLine(target);
          break;
        }
        if (prev && prev.status === next.status && !prev.supersededBy) break;
        const label = itemLabel(next);
        switch (next.status) {
          case 'stated': break;
          case 'conflict': if (!conflictEdgeEnds.has(next.itemId)) line('conflict', next.itemId, '충돌', () => `${label} — ${next.note ?? '같은 단계에 서로 다른 전제'}`); break;
          case 'violation': line('violation', next.itemId, '위반', () => `${label} → ${next.note ?? '한도 초과'}`); break;
          case 'undecided': line('undecided', next.itemId, '미정', () => next.note ? `${label} — ${next.note}` : label); break;
          case 'missing': listLine('missing', 'all', '누락', list => `대화에는 없지만 이 맥락에 꼭 필요한 항목 ${list.length} — ${list.join(' · ')}`, next.title); break;
          case 'filled': listLine('filled', 'all', '누락 보완', list => list.join(' · '), label); break;
          case 'merged': mergeLine(next); break;
          case 'branch': branchLine(next); break;
          default: listLine(`status:${next.status}`, 'all', STATUS_VIEW[next.status].label ?? next.status, list => list.join(' · '), label);
        }
        break;
      }
      case 'context_edge_upserted': {
        const { edge } = e.payload;
        if (edge.stale) beatStaleEdges++;
        const from = items.get(edge.from), to = items.get(edge.to);
        if (edge.kind !== 'conflicts' || !from || !to) break;
        const where = from.layer === to.layer ? `같은 ${layerName(from)} 단계에 서로 다른 전제` : '서로 다른 전제';
        line('conflict', edge.edgeId, '충돌', () => `${itemLabel(from)} ↔ ${itemLabel(to)} — ${where}`);
        break;
      }
      case 'context_branch_opened': {
        const target = items.get(e.payload.itemId);
        if (!target) break;
        branches.set(target.itemId, { options: e.payload.options });
        branchLine(target);
        break;
      }
      case 'context_branch_previewed': {
        const { itemId, optionId, effects } = e.payload;
        const option = branches.get(itemId)?.options.find(o => o.optionId === optionId);
        if (!option) break;
        branches.get(itemId)!.preview = optionId;
        line('preview', `${itemId}:${optionId}`, '검토', () => `${optionId}(${option.title}) 적용 시 예상 — ${effects.join(' · ')}`);
        break;
      }
      case 'context_branch_preview_cleared': {
        const { itemId, optionId } = e.payload, branch = branches.get(itemId);
        if (branch?.preview !== optionId) break;
        delete branch.preview;
        beatCleared = { itemId, optionId, line: line('preview-cleared', `${itemId}:${optionId}`, '검토', () => `${optionId} 예상 경로 제거`) };
        break;
      }
      case 'context_branch_resolved': {
        const p: P<'context_branch_resolved'> = e.payload;
        const branch = branches.get(p.itemId), option = branch?.options.find(o => o.optionId === p.optionId);
        if (!branch || !option || !isHuman(p.decidedBy)) break;
        branch.resolved = p.optionId;
        beatResolved = { itemId: p.itemId, optionId: p.optionId };
        // 사람이 정한 순간: 결정권자 본인의 발언 시각.
        const said = p.sourceMessageIds.map(id => messages.get(id)).find(m => m?.authorId === p.decidedBy);
        const subject = keyOrTitle(items.get(p.itemId)), evidence = p.evidenceMemberIds.map(name);
        line('resolve', p.itemId, '선택', () => `${subject} = ${p.optionId}(${option.title}) — ${evidence.length ? `근거: ${evidence.join(' · ')} · ` : ''}확정: ${name(p.decidedBy)}`, said?.at ?? e.at);
        break;
      }
      case 'pool_search_recorded': {
        const p: P<'pool_search_recorded'> = e.payload;
        const subject = keyOrTitle(items.get(p.forItemId)) || '분기';
        const invites = invited.get(p.searchId) ?? []; invited.set(p.searchId, invites);
        line('pool', p.searchId, '호출', () => {
          if (!invites.length) return `${subject} 결정 근거 부족 → 인력 pool 후보 ${p.candidateIds.length}명`;
          const names = invites.map(i => { const c = wc.pool.candidates.get(i.candidateId); return c ? `${c.displayName}(${c.role})` : name(i.memberId); });
          return `${subject} 결정 근거 부족 → 인력 pool ${names.join(' · ')} 호출${invites.every(i => joined.has(i.memberId)) ? ' · 합류' : ''}`;
        });
        break;
      }
      case 'pool_member_invited': {
        if (!wc.pool.candidates.has(e.payload.candidateId)) break;
        const list = invited.get(e.payload.searchId) ?? []; invited.set(e.payload.searchId, list);
        list.push({ candidateId: e.payload.candidateId, memberId: e.payload.memberId });
        break;
      }
      case 'proposal_generated': {
        const p: P<'proposal_generated'> = e.payload;
        proposals.set(p.proposalId, { version: p.version, status: 'generated' });
        const decisions = p.decisionItemIds.flatMap(id => items.has(id) ? [keyOrTitle(items.get(id))] : []);
        const opened = beatResolved ? `${beatResolved.optionId} 확정 → 제안 가능 · ` : '';
        line('proposal', p.proposalId, '생성', () => `${opened}Proposal v${p.version} ← ${decisions.join(' · ')} + 구성 ${p.inputItemIds.length}개 연결`);
        break;
      }
      case 'proposal_confirmed': {
        const p: P<'proposal_confirmed'> = e.payload, proposal = proposals.get(p.proposalId);
        if (!proposal || !isHuman(p.confirmedBy)) break;
        proposal.status = 'confirmed';
        let walked = '';
        if (beatCleared) {
          const kept = branches.get(beatCleared.itemId)?.resolved;
          walked = `${kept ? `${kept} 유지 · ` : ''}${beatCleared.optionId} 예상 경로 제거 · `;
          beatCleared.line.dropped = true;
        }
        const entry: { line: Line; expanded?: string } = {
          line: line('confirm', p.proposalId, '확정', () => `${walked}Proposal v${proposal.version}${entry.expanded ? ` → ${entry.expanded} 로 펼침` : ''} · 맥락 v${p.contextVersion}`),
        };
        confirmLines.set(p.proposalId, entry);
        dropStatusLines(PROPOSAL_STATUSES);
        break;
      }
      case 'proposal_expanded': {
        const proposal = proposals.get(e.payload.proposalId);
        if (!proposal) break;
        const expanded = keyGroups(e.payload.itemIds.flatMap(id => items.get(id) ?? []));
        const confirm = confirmLines.get(e.payload.proposalId);
        if (confirm) confirm.expanded = expanded;
        else line('expand', e.payload.proposalId, '펼침', () => `Proposal v${proposal.version} → ${expanded} 로 펼침`);
        dropStatusLines(PROPOSAL_STATUSES);
        break;
      }
      case 'tool_handoff_sent': {
        const p: P<'tool_handoff_sent'> = e.payload;
        if (!wc.tools.has(p.toolId)) break;
        handoffs.set(p.handoffId, p.toolId);
        listLine(p.round > 1 ? 'resend' : 'handoff', String(p.round), p.round > 1 ? '재전달' : '전달', list => list.join(' · '), `${p.title} → ${toolName(p.toolId)}`);
        break;
      }
      case 'preview_rendered': previews.set(e.payload.previewId, e.payload.spec); break;
      case 'build_produced': {
        const p: P<'build_produced'> = e.payload;
        const tools = [...new Set(p.handoffIds.flatMap(id => handoffs.get(id) ?? []))];
        const app = (p.previewId && previews.get(p.previewId)?.appName) || wc.session.title;
        const others = tools.filter(t => t !== 'dev-tools').map(toolName);
        const how = tools.includes('dev-tools') && others.length ? `${others.join(' · ')} 결과 → ${toolName('dev-tools')}에서 통합` : tools.map(toolName).join(' · ');
        line('build', p.buildId, '빌드 완료', () => `${how ? `${how} — ` : ''}${app} v${p.version}`);
        break;
      }
      case 'context_change_proposed': {
        const p: P<'context_change_proposed'> = e.payload;
        changeSets.set(p.changeSetId, { from: p.fromVersion, to: p.toVersion, open: true });
        const kinds = [...new Set(p.changes.map(c => c.change))].map(c => CHANGE_KIND[c]);
        const changes = p.changes.flatMap(c => { const item = items.get(c.itemId); return item ? [`${item.key ? `${item.key} ` : ''}${item.title}(${CHANGE_MARK[c.change]})`] : []; });
        const staleEdges = beatStaleEdges, staleItems = p.staleItemIds.flatMap(id => items.has(id) ? [keyOrTitle(items.get(id))] : []);
        const unaffected = p.unaffectedItemIds.flatMap(id => items.get(id)?.key ?? []);
        line('change', p.changeSetId, kinds.join(' · ') || '변경', () => `${changes.join(', ')}${staleEdges ? ` → 연결 ${staleEdges}개 낡음` : staleItems.length ? ` → ${staleItems.join(' · ')} 낡음` : ''}${unaffected.length ? ` · ${unaffected.join(' ')} 영향 없음` : ''}`);
        dropStatusLines(CHANGE_STATUSES);
        break;
      }
      case 'context_change_resolved': {
        const p: P<'context_change_resolved'> = e.payload, set = changeSets.get(p.changeSetId);
        if (!set?.open || !isHuman(p.by)) break;
        set.open = false;
        const applied = p.outcome === 'applied';
        line('change-resolved', p.changeSetId, applied ? '적용' : '되돌림', () => `v${set.from} → v${set.to} 변경 ${applied ? '적용' : '되돌림'} — ${name(p.by)}`);
        break;
      }
      default: break;
    }
  }
  return lines.filter(l => !l.dropped).reverse().map(l => ({ id: l.id, at: l.at, kindLabel: l.kindLabel, text: l.text() }));
}
