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

/** Normalization only removes UI nouns; never inspect or rewrite acceptance prose. */
function scopeKey(item: string): string {
  return [...new Set(excludedNames(item).map(name => name.replace(/\s+/g, '')))].sort().join('|');
}
function uniqueScope(items: readonly string[]): string[] {
  const seen = new Set<string>();
  return items.map(scopeItem).filter(item => {
    const key = scopeKey(item);
    if (!item || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
/** Read older title annotations once, then use explicit metadata as the source of truth. */
function updateScope(task: TaskSpec): void {
  const legacy = titleMarks(task.title);
  task.baseTitle ??= legacy.base;
  // Stored items are names only: a seeded "…까지" or "… 제외" would otherwise be doubled in the title.
  task.exclusions = uniqueScope((task.exclusions ?? legacy.marks.filter(mark => mark.endsWith('제외'))).map(mark => mark.replace(/\s*제외$/, '')));
  task.limits = uniqueScope(task.limits ?? legacy.marks.filter(mark => mark.endsWith('까지')).flatMap(mark => scopeItem(mark).split(/\s*·\s*/)));
  const displayBase = task.baseTitle.replace(/\s*\(([^()]*)\s+포함\)/g, (group, list: string) => {
    const parts = list.split(/\s*[·,]\s*/);
    const kept = parts.filter(part => !task.exclusions!.some(item => excludedNames(item).some(name => part.replace(/\s+/g, '').includes(name.replace(/\s+/g, '')))));
    return kept.length === parts.length ? group : kept.length ? ` (${kept.join('·')} 포함)` : '';
  });
  task.title = withMarks(displayBase, [
    ...task.exclusions.map(item => `${item} 제외`),
    ...(task.limits.length ? [`${task.limits.join('·')}까지`] : []),
  ]);
}

export function scopeMentions(text: string, items: readonly string[]): boolean {
  return items.some(item => excludedNames(item).some(name => text.replace(/\s+/g, '').includes(name.replace(/\s+/g, ''))));
}

/** Route reductions to remaining work, or the last affected completed output for explicit reopening. */
export function remainingScopeOps(state: ProjectState, ops: readonly PlanOp[], outputText: ReadonlyMap<string, string> = new Map()): PlanOp[] {
  const checked = (id: string) => state.tasks.get(id)?.status === 'checked' || state.tasks.get(id)?.blocked?.prevStatus === 'checked';
  const downstream = (id: string): string[] => {
    const seen = new Set<string>([id]);
    const visit = (parent: string): void => {
      for (const task of state.tasks.values()) if (task.spec.dependsOn.includes(parent) && !seen.has(task.spec.id)) { seen.add(task.spec.id); visit(task.spec.id); }
    };
    visit(id);
    return [...seen].filter(child => child !== id && state.tasks.get(child)?.status !== 'cancelled');
  };
  const routed = ops.flatMap(op => {
    if (!('taskId' in op) || !checked(op.taskId)) return [op];
    if (op.type === 'handoff_early') return [];
    if (op.type === 'exclude_scope' || op.type === 'limit_scope') {
      const descendants = downstream(op.taskId);
      const remaining = descendants.filter(id => !checked(id));
      if (remaining.length) return remaining.map(taskId => ({ ...op, taskId }));
      const items = op.type === 'exclude_scope' ? [op.item] : op.items;
      const affected = [op.taskId, ...descendants].filter(id => {
        const spec = state.tasks.get(id)?.spec;
        return spec && scopeMentions([spec.baseTitle ?? spec.title, ...spec.handoffConditions, outputText.get(id) ?? ''].join(' '), items);
      });
      const terminal = affected.filter(id => !downstream(id).some(child => affected.includes(child)));
      return (terminal.length ? terminal : [op.taskId]).map(taskId => ({ ...op, taskId }));
    }
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
    else if (op.type === 'handoff_early') {
      if (!task.handoffConditions.includes('초안 단계에서 인계 가능')) task.handoffConditions.push('초안 단계에서 인계 가능');
    } else {
      updateScope(task);
      if (op.type === 'exclude_scope') task.exclusions = uniqueScope([...task.exclusions!, op.item]);
      if (op.type === 'limit_scope') task.limits = uniqueScope([...task.limits!, ...op.items]);
      updateScope(task);
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
