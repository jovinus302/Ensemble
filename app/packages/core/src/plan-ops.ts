import type { ChangeKind, EventPayloads, Priority, TaskBrief, TaskRouting, TaskSpec } from './events.ts';
import type { ProjectState } from './projection.ts';
import { whoApproves } from './authority.ts';
import { PRIORITIES } from './work.ts';
import { routingProblems } from './routing.ts';

/** A new work item as the PM drafts it. `tempId` becomes the task id; later ops in the same batch may reference it. */
export interface TaskDraft {
  tempId: string; title: string; assignee: string; handoffConditions: string[]; dependsOn: string[];
  /** Metadata, not spec: the coordinator records these with `task_meta_set` (see `taskMetaFromOps`). */
  priority: Priority; routing: TaskRouting; brief: TaskBrief;
}
export type PlanOp = ({ type: 'set_availability'; memberId: string; weeklyHours: number; weekStart?: string }
  | { type: 'exclude_scope'; taskId: string; item: string }
  | { type: 'limit_scope'; taskId: string; items: string[] }
  | { type: 'handoff_early'; taskId: string }
  | { type: 'reassign'; taskId: string; assignee: string }
  | { type: 'set_deadline'; date: string }
  | { type: 'change_goal'; text: string }
  /** Top level = `scope_add`; with `parentId` = `split_task`. */
  | ({ type: 'create_task'; parentId?: string } & TaskDraft)
  /** Only while the target is waiting/ready with no result; running work gets a follow-up task instead. */
  | { type: 'split_task'; taskId: string; children: TaskDraft[] }
  /** Cancels the task's subtasks with it. */
  | { type: 'cancel_task'; taskId: string; reason: string }
  /** Metadata only: no plan version, just `task_meta_set`. */
  | { type: 'set_priority'; taskId: string; priority: Priority }) & { sourceMessageIds: string[] };

/**
 * Q1 default delegation for new projects: the PM may reorder, split approved work into agent
 * subtasks and move work between agents without asking. New scope still needs the decider.
 */
export const DEFAULT_PM_MAY_APPLY: ChangeKind[] = ['reorder', 'split_task', 'reassign_agent'];
/** A task and its subtasks: depth at most 2. */
export const MAX_TASK_DEPTH = 2;
/** The same task may change hands twice; a third reassignment is a loop and goes to a person. */
export const MAX_REASSIGNS = 2;

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

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Subtasks inherit the parent's dependencies, so splitting never lets a child start early. */
function draftSpec(draft: TaskDraft, parent?: TaskSpec): TaskSpec {
  return {
    id: draft.tempId, title: draft.title, baseTitle: draft.title, assignee: draft.assignee,
    dependsOn: unique([...(parent?.dependsOn ?? []), ...draft.dependsOn]), handoffConditions: [...draft.handoffConditions], exclusions: [], limits: [],
    ...(parent ? { parentId: parent.id } : {}),
  };
}

/** Only these operations can modify a plan. Input and unrelated fields are preserved. */
export function applyOps(plan: readonly TaskSpec[], ops: readonly PlanOp[]): TaskSpec[] {
  let tasks = structuredClone([...plan]);
  const find = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) throw new Error(`Unknown task ${id}`);
    return task;
  };
  const add = (draft: TaskDraft, parent?: TaskSpec) => {
    if (tasks.some(t => t.id === draft.tempId)) throw new Error(`Duplicate task ${draft.tempId}`);
    tasks.push(draftSpec(draft, parent));
  };
  for (const op of ops) {
    if (op.type === 'create_task') { add(op, op.parentId === undefined ? undefined : find(op.parentId)); continue; }
    if (!('taskId' in op)) continue;
    const task = find(op.taskId);
    if (op.type === 'reassign') task.assignee = op.assignee;
    else if (op.type === 'set_priority') continue;
    else if (op.type === 'split_task') for (const child of op.children) add(child, task);
    else if (op.type === 'cancel_task') {
      const removed = new Set([task.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const t of tasks) if (t.parentId !== undefined && removed.has(t.parentId) && !removed.has(t.id)) { removed.add(t.id); grew = true; }
      }
      tasks = tasks.filter(t => !removed.has(t.id));
    } else if (op.type === 'handoff_early') {
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

/** Structural problems of a whole plan: unknown links, depth, parent cycles and wait-for cycles. */
export function planStructureProblems(plan: readonly TaskSpec[]): string[] {
  const problems: string[] = [];
  const byId = new Map<string, TaskSpec>();
  for (const task of plan) {
    if (byId.has(task.id)) problems.push(`Duplicate task ${task.id}`);
    byId.set(task.id, task);
  }
  for (const task of plan) {
    for (const dep of task.dependsOn) if (!byId.has(dep)) problems.push(`Task ${task.id} depends on unknown task ${dep}`);
    if (task.parentId !== undefined && !byId.has(task.parentId)) problems.push(`Task ${task.id} has unknown parent ${task.parentId}`);
    const chain = new Set<string>([task.id]);
    let cyclic = false;
    for (let parent = task.parentId; parent !== undefined && byId.has(parent); parent = byId.get(parent)?.parentId) {
      if (chain.has(parent)) { cyclic = true; break; }
      chain.add(parent);
    }
    if (cyclic) problems.push(`Parent cycle at ${task.id}`);
    else if (chain.size > MAX_TASK_DEPTH) problems.push(`Task ${task.id} is nested ${chain.size} deep (max ${MAX_TASK_DEPTH})`);
  }
  // Wait-for graph: a task waits for its dependencies, a parent waits for its children.
  const waitsFor = new Map<string, string[]>(plan.map(task => [task.id, [...task.dependsOn]]));
  for (const task of plan) if (task.parentId !== undefined) waitsFor.get(task.parentId)?.push(task.id);
  const color = new Map<string, 'open' | 'done'>();
  const visit = (id: string): boolean => {
    if (color.get(id) === 'done') return false;
    if (color.get(id) === 'open') return true;
    color.set(id, 'open');
    const cyclic = (waitsFor.get(id) ?? []).some(next => byId.has(next) && visit(next));
    color.set(id, 'done');
    return cyclic;
  };
  for (const task of plan) if (!color.has(task.id) && visit(task.id)) problems.push(`Dependency cycle through ${task.id}`);
  return problems;
}

function draftProblems(state: ProjectState, draft: TaskDraft): string[] {
  const value = draft as Partial<TaskDraft>;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === 'string');
  if (typeof value.tempId !== 'string' || !value.tempId.trim()) return ['A new task needs an id'];
  const problems: string[] = [];
  const id = value.tempId;
  if (state.tasks.has(id)) problems.push(`Task id ${id} is already used`);
  if (typeof value.title !== 'string' || !value.title.trim()) problems.push(`Task ${id} needs a title`);
  if (typeof value.assignee !== 'string' || !state.members.has(value.assignee)) problems.push(`Task ${id} has unknown assignee ${String(value.assignee)}`);
  if (!strings(value.handoffConditions) || !strings(value.dependsOn)) problems.push(`Task ${id} needs handoff conditions and dependencies`);
  if (!PRIORITIES.includes(value.priority as Priority)) problems.push(`Task ${id} has unknown priority ${String(value.priority)}`);
  if (!value.routing || typeof value.routing !== 'object') problems.push(`Task ${id} needs a routing`);
  else if (typeof value.assignee === 'string' && state.members.has(value.assignee)) problems.push(...routingProblems(state, value.assignee, value.routing));
  const brief = value.brief;
  if (!brief || typeof brief.why !== 'string' || !strings(brief.sourceMessageIds) || !strings(brief.decisionIds) || !strings(brief.attachmentIds) || !strings(brief.constraints)) problems.push(`Task ${id} needs a brief`);
  else {
    // Ids must exist; only confirmed decisions count as decisions (§2.6). Attachments are not projected, so the caller checks them.
    for (const messageId of brief.sourceMessageIds) if (!state.messages.some(m => m.messageId === messageId)) problems.push(`Task ${id} brief cites unknown message ${messageId}`);
    for (const decisionId of brief.decisionIds) if (!state.decisions.has(decisionId)) problems.push(`Task ${id} brief cites unconfirmed decision ${decisionId}`);
  }
  return problems;
}

/**
 * Why an op cannot apply to `plan` in this state; empty means it can. Covers the work-item rules
 * (§2.3, §2.8): split preconditions, depth, `parentId`/`dependsOn` cycles, the reassignment cap,
 * and drafted ids/routing/brief. Field checks of the older ops stay with the caller's `validOp`.
 * `plan` defaults to the committed plan; pass the plan-so-far to validate a batch (`planOpsProblems`).
 */
export function planOpProblems(state: ProjectState, op: PlanOp, plan: readonly TaskSpec[] = state.plan?.tasks ?? []): string[] {
  const problems: string[] = [];
  const inPlan = (id: string) => plan.some(t => t.id === id);
  if ('taskId' in op && !inPlan(op.taskId)) return [`Unknown task ${op.taskId}`];
  // Splitting needs work that has not started; tasks drafted earlier in the batch qualify.
  const splittable = (id: string) => {
    const task = state.tasks.get(id);
    if (!task) return [];
    if (task.status !== 'waiting' && task.status !== 'ready') return [`Task ${id} is ${task.status}; only waiting or ready work can be split`];
    return task.results.length ? [`Task ${id} already has a result; add a follow-up task instead`] : [];
  };
  switch (op.type) {
    case 'create_task':
      problems.push(...draftProblems(state, op));
      if (op.parentId !== undefined) problems.push(...(inPlan(op.parentId) ? splittable(op.parentId) : [`Unknown parent ${op.parentId}`]));
      break;
    case 'split_task':
      if (!Array.isArray(op.children) || op.children.length === 0) return [`Splitting ${op.taskId} needs at least one subtask`];
      problems.push(...splittable(op.taskId), ...op.children.flatMap(child => draftProblems(state, child)));
      if (new Set(op.children.map(child => child.tempId)).size !== op.children.length) problems.push(`Subtasks of ${op.taskId} repeat an id`);
      break;
    case 'cancel_task':
      if (typeof op.reason !== 'string' || !op.reason.trim()) problems.push(`Cancelling ${op.taskId} needs a reason`);
      break;
    case 'set_priority':
      if (!PRIORITIES.includes(op.priority)) problems.push(`Unknown priority ${String(op.priority)}`);
      break;
    case 'reassign': {
      const current = plan.find(t => t.id === op.taskId)!;
      if (current.assignee !== op.assignee && (state.tasks.get(op.taskId)?.reassignCount ?? 0) >= MAX_REASSIGNS) problems.push(`Task ${op.taskId} was already reassigned ${MAX_REASSIGNS} times`);
      break;
    }
    default: break;
  }
  if (problems.length) return problems;
  let next: TaskSpec[];
  try { next = applyOps(plan, [op]); } catch (error) { return [(error as Error).message]; }
  // Only problems this op introduces: an older plan's oddities do not block new work.
  const before = new Set(planStructureProblems(plan));
  return planStructureProblems(next).filter(problem => !before.has(problem));
}

/** Validate ops in order, each against the plan the earlier ones produce. */
export function planOpsProblems(state: ProjectState, ops: readonly PlanOp[]): string[] {
  let plan: TaskSpec[] = [...(state.plan?.tasks ?? [])];
  const problems: string[] = [];
  for (const op of ops) {
    const found = planOpProblems(state, op, plan);
    if (found.length) problems.push(...found);
    else plan = applyOps(plan, [op]);
  }
  return problems;
}

/**
 * The `task_meta_set` payloads the coordinator writes in the same transaction as `plan_committed`:
 * origin, brief, routing and priority for each new task, and the priority of `set_priority`.
 */
export function taskMetaFromOps(ops: readonly PlanOp[], origin: { planVersion: number; createdBy: 'pm' | string; decisionRequestId?: string }): EventPayloads['task_meta_set'][] {
  const meta = (draft: TaskDraft, sourceMessageIds: string[], splitFrom?: string): EventPayloads['task_meta_set'] => ({
    taskId: draft.tempId, priority: draft.priority, routing: draft.routing, brief: draft.brief,
    origin: {
      createdBy: origin.createdBy, planVersion: origin.planVersion, sourceMessageIds: [...sourceMessageIds],
      ...(origin.decisionRequestId !== undefined ? { decisionRequestId: origin.decisionRequestId } : {}), ...(splitFrom !== undefined ? { splitFrom } : {}),
    },
  });
  return ops.flatMap(op => op.type === 'create_task' ? [meta(op, op.sourceMessageIds, op.parentId)]
    : op.type === 'split_task' ? op.children.map(child => meta(child, op.sourceMessageIds, op.taskId))
    : op.type === 'set_priority' ? [{ taskId: op.taskId, priority: op.priority }] : []);
}

type Requirement = { kind: ChangeKind; affectedPerson?: string };
function requirements(state: ProjectState, op: PlanOp): Requirement[] {
  const human = (id: string) => state.members.get(id)?.kind === 'human';
  // Work drafted onto a person is their commitment (Q2: they accept it themselves).
  const commitments = (drafts: readonly TaskDraft[]): Requirement[] =>
    unique(drafts.map(d => d.assignee).filter(human)).map(affectedPerson => ({ kind: 'human_commitment' as const, affectedPerson }));
  switch (op.type) {
    case 'create_task': return [{ kind: op.parentId === undefined ? 'scope_add' : 'split_task' }, ...commitments([op])];
    case 'split_task': return [{ kind: 'split_task' }, ...commitments(op.children)];
    case 'cancel_task': return [{ kind: 'scope_reduce' }];
    case 'set_priority': return [{ kind: 'reorder' }];
    default: break;
  }
  const kind: ChangeKind = op.type === 'set_availability' ? 'human_commitment'
    : (op.type === 'exclude_scope' || op.type === 'limit_scope') ? 'scope_reduce' : op.type === 'handoff_early' ? 'reorder'
    : op.type === 'set_deadline' ? 'deadline_change' : op.type === 'change_goal' ? 'goal_change'
    : state.members.get(op.assignee)?.kind === 'human' || state.members.get(state.plan?.tasks.find(t => t.id === op.taskId)?.assignee ?? '')?.kind === 'human' ? 'human_commitment' : 'reassign_agent';
  const affectedPerson = op.type === 'set_availability' ? op.memberId : op.type === 'reassign'
    ? state.members.get(op.assignee)?.kind === 'human' ? op.assignee : state.plan?.tasks.find(t => t.id === op.taskId)?.assignee : undefined;
  return [{ kind, affectedPerson }];
}

/**
 * Whether the op's source messages carry the authority it needs. An op may need several approvals
 * (new scope put on a person needs the decider and that person); the first one missing is
 * reported, so its `personId` is whom to ask. When all hold, the last requirement is reported.
 */
export function opAuthority(state: ProjectState, op: PlanOp): { kind: ChangeKind; personId?: string; allowed: boolean } {
  const required = requirements(state, op);
  const authors = state.messages.filter(m => op.sourceMessageIds.includes(m.messageId)).map(m => m.authorId);
  const goal = state.goal;
  if (!goal) return { kind: required[0]!.kind, allowed: false };
  const assessed = required.map(({ kind, affectedPerson }) => {
    const approval = whoApproves({ kind, affectedPerson }, goal);
    const personId = ['scope_reduce', 'scope_add', 'deadline_change', 'goal_change'].includes(kind)
      ? goal.decider : approval.by === 'person' ? approval.personId : undefined;
    return { kind, personId, allowed: personId ? authors.includes(personId) : approval.by === 'pm' };
  });
  return assessed.find(a => !a.allowed) ?? assessed.at(-1)!;
}
