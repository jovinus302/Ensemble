import type { ChangeKind, TaskSpec } from './events.ts';
import type { ProjectState } from './projection.ts';
import { whoApproves } from './authority.ts';

export type PlanOp = ({ type: 'set_availability'; memberId: string; weeklyHours: number; weekStart?: string }
  | { type: 'exclude_scope'; taskId: string; item: string }
  | { type: 'limit_scope'; taskId: string; items: string[] }
  | { type: 'handoff_early'; taskId: string }
  | { type: 'reassign'; taskId: string; assignee: string }
  | { type: 'set_deadline'; date: string }
  | { type: 'change_goal'; text: string }) & { sourceMessageIds: string[] };

/** Models sometimes include the grammatical suffix in an item, rather than its name. */
export const scopeItem = (item: string): string => item.trim().replace(/(?:까지)+(?:만)?$/, '').trim();

/** Compare scope names, not a model's optional UI nouns or parenthetical elaboration. */
function excludedNames(item: string): string[] {
  const generic = new Set(['모의', '모형', '실제', '기존', '관련', '화면', '버튼', '기능', '흐름', '포함', '상호작용', '설계', '동작', '구현', '반응', '정리']);
  const phrases = item.replace(/[()]/g, ',').split(/,|(?:과|와|및)\s+/);
  const names = phrases.map(phrase => phrase.trim().split(/\s+/).filter(word => !generic.has(word)).join(' ').replace(/(?:은|는|을|를|만)$/, '').trim()).filter(Boolean);
  return [...new Set(names.length ? names : [item.trim()])];
}

/** Split at top-level commas only; scope names may carry their own parentheses. */
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
  }
  return [...parts, current.trim()];
}

const trailingGroup = /\s*\(((?:[^()]|\([^()]*\))*)\)$/;

/**
 * A title keeps every scope change in one trailing group: "(결제 제외, 요금제 비교·가입까지)".
 * Older titles stacked groups ("(결제 제외) (범위: 가입만)"); those are read back as marks too.
 */
function titleMarks(title: string): { base: string; marks: string[] } {
  const marks: string[] = [];
  let base = title;
  for (let group = trailingGroup.exec(base); group; group = trailingGroup.exec(base)) {
    const found: string[] = [];
    let pending = '';
    for (const part of topLevelParts(group[1]!)) {
      pending = pending ? `${pending}, ${part}` : part;
      const limit = /^범위:\s*(.+?)만$/.exec(pending);
      if (limit) { found.push(`${limit[1]!.split(/\s*·\s*/).join('·')}까지`); pending = ''; }
      else if (/(?:제외|까지)$/.test(pending)) { found.push(pending); pending = ''; }
    }
    if (pending || !found.length) break;
    marks.unshift(...found);
    base = base.slice(0, group.index);
  }
  return { base, marks: [...new Set(marks)] };
}

const withMarks = (base: string, marks: readonly string[]): string => marks.length ? `${base} (${marks.join(', ')})` : base;

/** Whether the title already marks the same excluded scope, however it was worded. */
function hasExclusionMark(base: string, marks: readonly string[], item: string): boolean {
  const wanted = excludedNames(item);
  // Scope names that contain one another ("결제" and "결제 모형") are the same scope for the title;
  // each exclusion still keeps its own "제외:" handoff condition.
  const same = (a: string, b: string) => a.includes(b) || b.includes(a);
  if (wanted.some(name => base.split(name).slice(1).some(after => /^\S*\s*제외/.test(after)))) return true;
  return marks.filter(mark => mark.endsWith('제외')).map(mark => mark.replace(/\s*제외$/, '')).some(named => named.trim() === item.trim()
    || excludedNames(named).some(name => wanted.some(other => same(name, other))));
}

/** "실제 결제 금지" agrees with a payment cut; only requirements to build the scope are removed. */
const prohibition = (text: string): boolean => /금지|없음|않(?:는다|음|아야|도록|고)|하지\s*말/.test(text);

function withoutScope(text: string, names: readonly string[]): string | undefined {
  const includesScope = (part: string) => names.some(name => part.includes(name));
  if (!includesScope(text)) return text;
  // A parenthesized flow is only one part of a condition. Keep its enclosing
  // artifact/format requirement even when one of the flow's steps is excluded.
  text = text.replace(/\(([^()]*)\)/g, (whole, inner: string) => {
    if (!includesScope(inner)) return whole;
    const remaining = withoutScope(inner, names);
    return remaining ? `(${remaining})` : '';
  });
  if (!includesScope(text)) return text;
  if (text.startsWith('범위:')) {
    const remaining = withoutScope(text.slice('범위:'.length).trim(), names);
    return remaining ? `범위: ${remaining}` : undefined;
  }
  // Object + prohibition + predicate are distinct clauses, not one comma list.
  // QA C1: "가입..., 모의 결제 버튼 동작을 실제 개인정보 수집·결제 없이 시연...".
  const objectWithout = /^(.*?[을를])\s+(실제\s+.+?)\s+없이\s+(.+)$/.exec(text);
  if (objectWithout) {
    const object = withoutScope(objectWithout[1]!, names);
    return [object, `${objectWithout[2]!} 없이`, objectWithout[3]!].filter(Boolean).join(' ');
  }
  // Keep prohibitions whole: removing a mock payment button must not erase the ban
  // on real payment, personal-data collection or external-service connections.
  const without = /^(.*?)\s+없이\s+(.+)$/.exec(text);
  if (without) {
    const allowed = withoutScope(without[2]!, names);
    return allowed ? `${without[1]!} 없이 ${allowed}` : `${without[1]!} 금지`;
  }
  let splitConjunction = false;
  const parts = text.split(/,\s*|·|→|\s+및\s+/).flatMap(part => {
    const pair = /^(.+?)(?:과|와)\s+(.+)$/.exec(part);
    // In "결제 승인과 취소", both actions belong to payment; don't retain "취소".
    if (pair && (!includesScope(pair[1]!) || /(?:화면|버튼|기능|흐름)$/.test(pair[1]!))) {
      splitConjunction = true;
      return [pair[1]!, pair[2]!];
    }
    return [part];
  });
  const dropped = (part: string) => includesScope(part) && !prohibition(part);
  const kept = parts.filter(part => !dropped(part));
  if (!kept.length) return undefined;
  // The last list item can carry the predicate shared by all preceding items.
  const last = parts.at(-1)!;
  const candidate = dropped(last) ?/([이가을를])\s+(.+)$/.exec(last) : null;
  const predicate = candidate && !includesScope(candidate[2]!) ? candidate : null;
  // Keep punctuation inside unaffected list items (오류·재입력, 시간 선택·예약 확인).
  let retained = text;
  for (const part of parts.filter(dropped)) retained = retained.replace(part, '');
  retained = retained.replace(/^[,·→\s]+|[,·→\s]+$/g, '').replace(/([,·→])\s*[,·→]/g, '$1');
  // Conjunction splitting needs reconstruction; comma/middle-dot lists retain their original joins.
  if (splitConjunction) retained = kept.join(', ');
  return `${retained}${predicate ? ` 항목${/[이가]/.test(predicate[1]!) ? '이' : '을'} ${predicate[2]}` : ''}`;
}

/** Accepted artifacts describe completed work. New reductions constrain remaining work. */
export function remainingScopeOps(state: ProjectState, ops: readonly PlanOp[]): PlanOp[] {
  const checked = (id: string) => state.tasks.get(id)?.status === 'checked' || state.tasks.get(id)?.blocked?.prevStatus === 'checked';
  const downstream = (id: string): string[] => {
    const seen = new Set<string>([id]);
    const visit = (parent: string): void => {
      for (const task of state.tasks.values()) if (task.spec.dependsOn.includes(parent) && !seen.has(task.spec.id)) { seen.add(task.spec.id); visit(task.spec.id); }
    };
    visit(id);
    return [...seen].filter(child => child !== id && !checked(child) && state.tasks.get(child)?.status !== 'cancelled');
  };
  const routed = ops.flatMap(op => {
    if (!('taskId' in op) || !checked(op.taskId)) return [op];
    if (op.type === 'handoff_early') return [];
    if (op.type === 'exclude_scope' || op.type === 'limit_scope') return downstream(op.taskId).map(taskId => ({ ...op, taskId }));
    return [op];
  });
  const result = new Map<string, PlanOp>();
  for (const op of routed) {
    const key = JSON.stringify(Object.entries(op).filter(([key]) => key !== 'sourceMessageIds').sort(([a], [b]) => a.localeCompare(b)));
    const existing = result.get(key);
    result.set(key, existing ? { ...existing, sourceMessageIds: [...new Set([...existing.sourceMessageIds, ...op.sourceMessageIds])] } : op);
  }
  return [...result.values()];
}

/** Only these operations can modify a plan. Input and unrelated fields are preserved. */
export function applyOps(plan: readonly TaskSpec[], ops: readonly PlanOp[]): TaskSpec[] {
  const tasks = structuredClone([...plan]);
  for (const op of ops) {
    if (!('taskId' in op)) continue;
    const task = tasks.find(t => t.id === op.taskId);
    if (!task) throw new Error(`Unknown task ${op.taskId}`);
    if (op.type === 'reassign') task.assignee = op.assignee;
    else {
      const condition = op.type === 'exclude_scope' ? `제외: ${op.item}` : op.type === 'limit_scope' ? `범위: ${op.items.map(scopeItem).join(', ')}만` : '초안 단계에서 인계 가능';
      const { base, marks } = titleMarks(task.title);
      const limits = marks.filter(mark => mark.endsWith('까지')), exclusions = marks.filter(mark => !limits.includes(mark));
      if (op.type === 'exclude_scope' && !task.handoffConditions.includes(condition) && !hasExclusionMark(base, marks, op.item)) exclusions.push(`${op.item} 제외`);
      if (op.type === 'exclude_scope') task.title = withMarks(base, [...exclusions, ...limits]);
      if (op.type === 'exclude_scope') {
        const names = excludedNames(op.item);
        task.handoffConditions = task.handoffConditions.flatMap(c => {
          const remaining = c.startsWith('제외:') ? c : withoutScope(c, names);
          return remaining ? [remaining] : [];
        });
        if (!task.handoffConditions.some(c => !c.startsWith('제외:'))) {
          const title = base.replace(/\([^)]*\)/g, '').trim();
          const remainingTitle = withoutScope(title, names) ?? '남은 작업';
          task.handoffConditions.unshift(`${remainingTitle}의 제외 범위를 뺀 결과물을 제출`);
        }
      }
      if (op.type === 'limit_scope') {
        const keptNames = op.items.map(scopeItem);
        // Only lists that explicitly mention a kept scope establish an enumeration.
        // Independent format/security/evidence conditions must survive unchanged.
        task.handoffConditions = task.handoffConditions.map(c => {
          if (c.startsWith('제외:') || !keptNames.some(name => c.includes(name))) return c;
          const parts = c.split(/,\s*|\s+및\s+/);
          const removed = parts.filter(p => !keptNames.some(name => p.includes(name)))
            .filter(p => !/금지|없이|개인정보|HTML|로컬|출처|근거|오류|재입력/.test(p))
            .map(p => p.replace(/(?:[을를이가])\s+.*$/, '').trim())
            .flatMap(p => p.split(/[·→]/)).map(p => p.replace(/\s*항목$/, '').trim()).filter(Boolean);
          return withoutScope(c, removed) ?? c;
        });
        task.title = withMarks(base, [...exclusions, `${keptNames.join('·')}까지`]);
        task.handoffConditions = task.handoffConditions.filter(c => !c.startsWith('범위:'));
      }
      if (!task.handoffConditions.includes(condition)) task.handoffConditions.push(condition);
    }
  }
  return tasks;
}

export function opAuthority(state: ProjectState, op: PlanOp): { kind: ChangeKind; personId?: string; allowed: boolean } {
  const kind: ChangeKind = op.type === 'set_availability' ? 'human_commitment'
    : (op.type === 'exclude_scope' || op.type === 'limit_scope') ? 'scope_reduce' : op.type === 'handoff_early' ? 'reorder'
    : op.type === 'set_deadline' ? 'deadline_change' : op.type === 'change_goal' ? 'goal_change'
    : state.members.get(op.assignee)?.kind === 'human' || state.members.get(state.plan?.tasks.find(t => t.id === op.taskId)?.assignee ?? '')?.kind === 'human' ? 'human_commitment' : 'reassign_agent';
  const affectedPerson = op.type === 'set_availability' ? op.memberId : op.type === 'reassign'
    ? state.members.get(op.assignee)?.kind === 'human' ? op.assignee : state.plan?.tasks.find(t => t.id === op.taskId)?.assignee : undefined;
  const authors = state.messages.filter(m => op.sourceMessageIds.includes(m.messageId)).map(m => m.authorId);
  if (!state.goal) return { kind, allowed: false };
  const approval = whoApproves({ kind, affectedPerson }, state.goal);
  const personId = ['scope_reduce', 'scope_add', 'deadline_change', 'goal_change'].includes(kind)
    ? state.goal.decider : approval.by === 'person' ? approval.personId : undefined;
  return { kind, personId, allowed: personId ? authors.includes(personId) : approval.by === 'pm' };
}
