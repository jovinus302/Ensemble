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
  const generic = new Set(['모의', '실제', '기존', '관련', '화면', '버튼', '기능', '흐름', '포함']);
  const phrases = item.replace(/[()]/g, ',').split(/,|(?:과|와|및)\s+/);
  const names = phrases.map(phrase => phrase.trim().split(/\s+/).filter(word => !generic.has(word)).join(' ').replace(/(?:은|는|을|를|만)$/, '').trim()).filter(Boolean);
  return [...new Set(names.length ? names : [item.trim()])];
}

/** Whether the title already carries a "(… 제외)" mark for the same scope, however it was worded. */
function hasExclusionMark(title: string, item: string): boolean {
  const key = (text: string) => excludedNames(text).sort().join('|');
  const wanted = key(item);
  return [...title.matchAll(/\(((?:[^()]|\([^()]*\))*?)\s*제외\)/g)].some(match => match[1]!.trim() === item.trim() || key(match[1]!) === wanted);
}

function withoutScope(text: string, names: readonly string[]): string | undefined {
  const includesScope = (part: string) => names.some(name => part.includes(name));
  if (!includesScope(text)) return text;
  if (text.startsWith('범위:')) {
    const remaining = withoutScope(text.slice('범위:'.length).trim(), names);
    return remaining ? `범위: ${remaining}` : undefined;
  }
  // Keep prohibitions separate from the allowed items: removing a mock payment button
  // must not erase the ban on personal-data collection or external-service connections.
  const without = /^(.*?)\s+없이\s+(.+)$/.exec(text);
  if (without) {
    const forbidden = withoutScope(without[1]!, names), allowed = withoutScope(without[2]!, names);
    if (forbidden && allowed) return `${forbidden} 없이 ${allowed}`;
    if (forbidden) return `${forbidden} 금지`;
    return allowed;
  }
  const parts = text.split(/,\s*|\s+및\s+/).flatMap(part => {
    const pair = /^(.+?)(?:과|와)\s+(.+)$/.exec(part);
    // In "결제 승인과 취소", both actions belong to payment; don't retain "취소".
    return pair && (!includesScope(pair[1]!) || /(?:화면|버튼|기능|흐름)$/.test(pair[1]!)) ? [pair[1]!, pair[2]!] : [part];
  });
  const kept = parts.filter(part => !includesScope(part));
  if (!kept.length) return undefined;
  // The last list item can carry the predicate shared by all preceding items.
  const last = parts.at(-1)!;
  const candidate = includesScope(last) ? /([이가을를])\s+(.+)$/.exec(last) : null;
  const predicate = candidate && !includesScope(candidate[2]!) ? candidate : null;
  return `${kept.join(', ')}${predicate ? ` 항목${/[이가]/.test(predicate[1]!) ? '이' : '을'} ${predicate[2]}` : ''}`;
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
      if (op.type === 'exclude_scope' && !task.handoffConditions.includes(condition) && !hasExclusionMark(task.title, op.item)) task.title += ` (${op.item} 제외)`;
      if (op.type === 'exclude_scope') {
        const names = excludedNames(op.item);
        task.handoffConditions = task.handoffConditions.flatMap(c => {
          const remaining = c.startsWith('제외:') ? c : withoutScope(c, names);
          return remaining ? [remaining] : [];
        });
        if (!task.handoffConditions.some(c => !c.startsWith('제외:'))) {
          const title = task.title.replace(/\([^)]*\)/g, '').trim();
          const remainingTitle = withoutScope(title, names) ?? '남은 작업';
          task.handoffConditions.unshift(`${remainingTitle}의 제외 범위를 뺀 결과물을 제출`);
        }
      }
      if (op.type === 'limit_scope') {
        task.title = `${op.items.map(scopeItem).join(' · ')} — 범위 한정`;
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
